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
# 報告画面で最初にチェックを入れておく投稿先ルーム（お試し中はテスト用ルームを指定する）
CHATWORK_REPORT_ROOM_ID = os.getenv("CHATWORK_REPORT_ROOM_ID", "").strip()
# 報告画面で選べる投稿先（GASの roomId2〜4 と同じ）。
# guide=True のルームにだけ案内（CHATWORK_GUIDE_FOOTER）を付ける（GASの GUIDE_ROOM_IDS と同じ。支部外の方もいるチャットには出さない）
# admin_only=True のルームは、管理者アカウントにだけ表示し、管理者だけが投稿できる
REPORT_ROOMS = [
    {"id": "284847688", "name": "参政党愛知第１２支部チャット", "guide": True, "admin_only": False},
    {"id": "446130978", "name": "活動報告-藤本和美（岡崎幸田県議）チャット", "guide": False, "admin_only": False},
    {"id": "420318628", "name": "テスト用チャット", "guide": False, "admin_only": True},
]
# 本文末尾に付ける案内（任意。Chatworkの囲み枠記法。改行は \n と書ける）
CHATWORK_GUIDE_FOOTER = os.getenv("CHATWORK_GUIDE_FOOTER", "").replace("\\n", "\n")
GEOAPIFY_API_KEY = os.getenv("GEOAPIFY_API_KEY", "").strip()

UPLOAD_INTERVAL_SEC = 1    # 画像を連続投稿する際の間隔（1ルームあたり10秒間に10回までの制限対策）
RETRY_WAIT_SEC = 11        # 投稿制限(429)に当たった際の再試行までの待ち時間
MAX_ATTEMPTS = 3
HTTP_TIMEOUT_SEC = 30
MAX_MAP_POINTS = 1000      # 軌跡画像に使う点数の上限（多い場合は間引く）
# 軌跡画像の待ち時間（秒）。ふだんは3〜8秒で返るが、Geoapify側がまれに30秒以上止まることがある。
# 1回目で返らなければ、もう一度だけ頼み直す（nginx の proxy_read_timeout 内に収まる合計にする）
MAP_TIMEOUTS_SEC = (30, 45)

Image = Tuple[str, bytes]  # (ファイル名, JPEGバイト列)


def _sleep(seconds: float):
    # テストで待ち時間をなくせるよう関数を分けている
    time.sleep(seconds)


def _request(url: str, data: Optional[bytes], headers: dict, timeout: Optional[float] = None) -> Tuple[int, bytes]:
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout or HTTP_TIMEOUT_SEC) as res:
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
    data = json.dumps(payload).encode("utf-8")
    for attempt, timeout in enumerate(MAP_TIMEOUTS_SEC, start=1):
        started = time.time()
        try:
            status, body = _request(
                f"https://maps.geoapify.com/v1/staticmap?apiKey={GEOAPIFY_API_KEY}",
                data, {"Content-Type": "application/json"}, timeout=timeout,
            )
        except Exception as e:
            # 応答待ちの打ち切り・接続エラーは、Geoapify側の一時的な不調のことが多いので頼み直す
            print(f"軌跡地図生成エラー（{attempt}回目・{time.time() - started:.0f}秒）: {e}")
            continue
        if status == 200:
            if attempt > 1:
                print(f"軌跡地図生成: {attempt}回目で成功（{time.time() - started:.0f}秒）")
            return body
        print(f"軌跡地図生成エラー（{attempt}回目）: HTTP {status} {body[:200]!r}")
        if status < 500 and status != 429:
            return None  # キーの誤り・内容の誤りは頼み直しても同じなのでやめる
    return None


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


def _allowed_rooms(is_admin: bool) -> list:
    return [r for r in REPORT_ROOMS if is_admin or not r["admin_only"]]


def report_rooms(is_admin: bool = False) -> list:
    """報告画面に出す投稿先の一覧（管理者以外には admin_only のルームを出さない）。
    default は最初からチェックを入れておくかどうか"""
    return [{"id": r["id"], "name": r["name"], "default": r["id"] == CHATWORK_REPORT_ROOM_ID}
            for r in _allowed_rooms(is_admin)]


def _room(room_id: str) -> Optional[dict]:
    return next((r for r in REPORT_ROOMS if r["id"] == room_id), None)


def post_report(message: str, images: List[Image], room_id: Optional[str] = None) -> dict:
    """本文と画像を1つのルームに投稿する。
    1枚目：本文＋画像、2枚目以降：画像だけ。画像がすべて失敗しても本文だけは投稿する。
    戻り値: {"posted": bool, "images_posted": int, "skipped_reason": str|None}
    """
    room_id = room_id or CHATWORK_REPORT_ROOM_ID
    if not CHATWORK_TOKEN or not room_id:
        return {"posted": False, "images_posted": 0, "skipped_reason": "Chatworkの設定（トークン・ルームID）がありません"}

    room = _room(room_id)
    if CHATWORK_GUIDE_FOOTER and room and room["guide"]:
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


def post_report_to_rooms(message: str, images: List[Image], room_ids: List[str], is_admin: bool = False) -> dict:
    """選ばれた投稿先それぞれに post_report する。一覧にないルームID・管理者以外が選んだ admin_only のルームは無視する。
    戻り値: {"posted": 1つでも投稿できたか, "rooms": [{"id","name","posted","images_posted","skipped_reason"}],
             "skipped_reason": str|None}
    """
    rooms = [r for r in _allowed_rooms(is_admin) if r["id"] in set(room_ids or [])]
    if not rooms:
        return {"posted": False, "rooms": [], "skipped_reason": "投稿先が選ばれていません"}
    results = []
    for room in rooms:
        try:
            result = post_report(message, images, room["id"])
        except Exception as e:
            print(f"Chatwork投稿エラー（{room['name']}）: {e}")
            result = {"posted": False, "images_posted": 0, "skipped_reason": "投稿中にエラーが発生しました"}
        results.append({"id": room["id"], "name": room["name"], **result})
    return {"posted": any(r["posted"] for r in results), "rooms": results,
            "skipped_reason": next((r["skipped_reason"] for r in results if r["skipped_reason"]), None)}
