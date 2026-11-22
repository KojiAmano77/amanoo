"""Chatwork投稿・Geoapify軌跡画像生成（GASの postToChatwork / generateTrackMapImage をPythonに移したもの）

追加ライブラリを増やさないよう、HTTP通信は標準ライブラリ(urllib)で行う。
すべて同期関数なので、FastAPIからは run_in_threadpool 経由で呼ぶ。
"""
import json
import os
import time
import uuid
import urllib.error
import urllib.parse
import urllib.request
from typing import List, Optional, Tuple

from dotenv import load_dotenv

load_dotenv()

CHATWORK_API_BASE = "https://api.chatwork.com/v2/rooms"
CHATWORK_TOKEN = os.getenv("CHATWORK_TOKEN", "").strip()
# 活動報告の投稿先ルーム（お試し中はテスト用ルームを指定する）
CHATWORK_REPORT_ROOM_ID = os.getenv("CHATWORK_REPORT_ROOM_ID", "").strip()
# 本文末尾に付ける案内（任意。Chatworkの囲み枠記法。改行は \n と書ける）
CHATWORK_GUIDE_FOOTER = os.getenv("CHATWORK_GUIDE_FOOTER", "").replace("\\n", "\n")
GEOAPIFY_API_KEY = os.getenv("GEOAPIFY_API_KEY", "").strip()

UPLOAD_INTERVAL_SEC = 1    # 画像を連続投稿する際の間隔（1ルームあたり10秒間に10回までの制限対策）
RETRY_WAIT_SEC = 11        # 投稿制限(429)に当たった際の再試行までの待ち時間
MAX_ATTEMPTS = 3
HTTP_TIMEOUT_SEC = 30
MAX_MAP_POINTS = 1000      # 軌跡画像に使う点数の上限（多い場合は間引く）

Image = Tuple[str, bytes]  # (ファイル名, JPEGバイト列)


def _sleep(seconds: float):
    # テストで待ち時間をなくせるよう関数を分けている
    time.sleep(seconds)


def _request(url: str, data: Optional[bytes], headers: dict) -> Tuple[int, bytes]:
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SEC) as res:
            return res.status, res.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def generate_track_map_image(segments: List[List[List[float]]]) -> Optional[bytes]:
    """軌跡付きの静的地図画像（JPEG）を作る。失敗時・キー未設定時は None"""
    if not GEOAPIFY_API_KEY:
        print("軌跡地図生成スキップ: GEOAPIFY_API_KEY 未設定")
        return None
    segments = [seg for seg in segments if len(seg) >= 2]
    total = sum(len(seg) for seg in segments)
    if not segments:
        return None

    # 点が多い場合は間引く（各セグメントの終点は必ず残す）
    step = max(1, -(-total // MAX_MAP_POINTS))
    sampled = [[p for i, p in enumerate(seg) if i % step == 0 or i == len(seg) - 1] for seg in segments]

    payload = {
        "width": 600,
        "height": 400,
        "style": "osm-carto",
        "geometries": [
            {
                "type": "polyline",
                "linecolor": "#ff6600",
                "linewidth": 5,
                "value": [{"lon": float(p[0]), "lat": float(p[1])} for p in seg],
            }
            for seg in sampled
        ],
    }
    try:
        status, body = _request(
            f"https://maps.geoapify.com/v1/staticmap?apiKey={GEOAPIFY_API_KEY}",
            json.dumps(payload).encode("utf-8"),
            {"Content-Type": "application/json"},
        )
    except Exception as e:
        print(f"軌跡地図生成エラー: {e}")
        return None
    if status != 200:
        print(f"軌跡地図生成エラー: HTTP {status} {body[:200]!r}")
        return None
    return body


def _multipart(fields: dict, file_name: str, file_bytes: bytes) -> Tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = []
    for key, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode("utf-8")
        )
    parts.append(
        (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_name}"\r\n'
         "Content-Type: image/jpeg\r\n\r\n").encode("utf-8")
    )
    parts.append(file_bytes)
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


def _post_message(room_id: str, message: str) -> bool:
    data = urllib.parse.urlencode({"body": message}).encode("utf-8")
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            status, body = _request(
                f"{CHATWORK_API_BASE}/{room_id}/messages", data,
                {"X-ChatWorkToken": CHATWORK_TOKEN, "Content-Type": "application/x-www-form-urlencoded"},
            )
        except Exception as e:
            print(f"Chatwork本文投稿エラー: {e}")
            return False
        if status == 200:
            return True
        if status == 429 and attempt < MAX_ATTEMPTS:
            _sleep(RETRY_WAIT_SEC)
            continue
        print(f"Chatwork本文投稿エラー: HTTP {status} {body[:200]!r}")
        return False
    return False


def _upload_file(room_id: str, message: str, image: Image) -> bool:
    name, content = image
    fields = {"message": message} if message else {}
    data, content_type = _multipart(fields, name, content)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            status, body = _request(
                f"{CHATWORK_API_BASE}/{room_id}/files", data,
                {"X-ChatWorkToken": CHATWORK_TOKEN, "Content-Type": content_type},
            )
        except Exception as e:
            print(f"Chatwork画像投稿エラー({name}): {e}")
            return False
        if status == 200:
            return True
        if status == 429 and attempt < MAX_ATTEMPTS:
            _sleep(RETRY_WAIT_SEC)
            continue
        print(f"Chatwork画像投稿エラー({name}): HTTP {status} {body[:200]!r}")
        return False
    return False


def post_report(message: str, images: List[Image], room_id: Optional[str] = None) -> dict:
    """本文と画像をChatworkに投稿する。
    1枚目：本文＋画像、2枚目以降：画像だけ。画像がすべて失敗しても本文だけは投稿する。
    戻り値: {"posted": bool, "images_posted": int, "skipped_reason": str|None}
    """
    room_id = room_id or CHATWORK_REPORT_ROOM_ID
    if not CHATWORK_TOKEN or not room_id:
        return {"posted": False, "images_posted": 0, "skipped_reason": "Chatworkの設定（トークン・ルームID）がありません"}

    if CHATWORK_GUIDE_FOOTER:
        message = message + CHATWORK_GUIDE_FOOTER

    pending = message
    images_posted = 0
    for i, image in enumerate(images):
        if i > 0:
            _sleep(UPLOAD_INTERVAL_SEC)
        if _upload_file(room_id, pending, image):
            images_posted += 1
            pending = ""

    posted = not pending
    if pending:
        posted = _post_message(room_id, pending)
    return {"posted": posted, "images_posted": images_posted, "skipped_reason": None}
