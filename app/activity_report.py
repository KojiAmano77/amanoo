"""歩行ログ付きの活動報告（ポスティング・街宣車活動）：入力内容の検証、Chatwork本文・メモ・GPXの組み立て

GASの buildMessage（ポスティング・街宣車活動）/ buildPostingDetail / postActivityToWebApp のメモ組み立てを移したもの。
プレビューAPIと投稿APIで同じ関数を使い、画面に出した本文と実際の投稿がずれないようにする。
"""
from datetime import datetime, timezone
from typing import List, Optional
from xml.sax.saxutils import escape

from pydantic import BaseModel, Field

WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"]

# 配布ビラの種類（キー → 表示名）。GASの BILLS と同じ並び
BILLS = [
    ("ito", "伊藤議員 市政報告"),
    ("kanda", "神田議員 市政報告"),
    ("fujimoto", "藤本議員 後援会通信"),
    ("sanseito", "参政党ビラ"),
]

# 活動記録マップから報告できる活動種類（歩行ログ・走行ログを取る活動）
REPORT_ACTIVITY_TYPES = ["ポスティング", "街宣車活動"]

MAX_SEGMENTS = 50
MAX_POINTS = 50000


class ActivityReport(BaseModel):
    activity_type: str = "ポスティング"        # REPORT_ACTIVITY_TYPES のどれか
    date: str                                  # YYYY-MM-DD
    start_time: str = ""                       # HH:MM
    end_time: str = ""                         # HH:MM
    participants: str = ""                     # 参加者（投稿者以外）
    total_people: Optional[int] = None         # 参加人数合計
    bills: dict = Field(default_factory=dict)  # ポスティングのみ：{"ito": 50, ...}
    tewatashi: Optional[int] = None            # ポスティングのみ：手渡し枚数
    area: str = ""                             # 活動エリア（ポスティングエリア・街宣車の活動エリア）
    school: str = ""                           # ポスティングのみ：小学校学区
    report_text: str = ""                      # 活動報告（自由記述）
    room_ids: List[str] = Field(default_factory=list)  # Chatworkの投稿先ルームID（chatwork_service.REPORT_ROOMS の中から選ぶ）
    # [[[lon, lat, 時刻(ミリ秒, 任意)], ...], ...]
    segments: List[List[List[float]]] = Field(default_factory=list)


def _to_int(value) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def parse_date(date_str: str) -> datetime:
    return datetime.strptime(date_str.strip(), "%Y-%m-%d")


def format_japanese_date(date_str: str) -> str:
    """2026-02-27 → 2026/2/27(金)"""
    d = parse_date(date_str)
    return f"{d.year}/{d.month}/{d.day}({WEEKDAYS[d.weekday()]})"


def posting_detail(report: ActivityReport):
    """戻り値: ("伊藤議員 市政報告：50枚  参政党ビラ：20枚", 70)"""
    distributed = [(label, _to_int(report.bills.get(key))) for key, label in BILLS]
    distributed = [(label, n) for label, n in distributed if n > 0]
    total = sum(n for _, n in distributed)
    detail = "  ".join(f"{label}：{n}枚" for label, n in distributed)
    return detail, total


def is_posting(report: ActivityReport) -> bool:
    return report.activity_type == "ポスティング"


def build_message(report: ActivityReport, poster: str) -> str:
    participant_line = ""
    if report.participants.strip():
        people = f"（計{report.total_people}人）" if report.total_people else ""
        participant_line = f"参加者：{report.participants.strip()}{people}\n"

    header = (
        f"🍊{report.activity_type} 活動報告🍊\n"
        f"投稿者：{poster}\n"
        f"{participant_line}"
        f"活動日：{format_japanese_date(report.date)}\n"
        f"活動時間：{report.start_time}～{report.end_time}"
    )

    if not is_posting(report):
        # 街宣車活動（GASの buildMessage と同じ形）
        return (
            f"{header}\n"
            f"活動場所：{report.area.strip()}\n"
            f"{report.report_text.strip()}\n"
        )

    detail, total = posting_detail(report)
    tewatashi = _to_int(report.tewatashi)
    tewatashi_part = f"（内手渡し：{tewatashi}枚）" if tewatashi else ""
    if total > 0:
        result_line = f"{detail}  合計{total}枚 {tewatashi_part}".strip()
    else:
        result_line = f"（枚数未記入）{tewatashi_part}".strip()

    return (
        f"{header}\n"
        f"活動場所：{report.area.strip()} {report.school.strip()}\n"
        f"活動結果：{result_line}\n"
        f"{report.report_text.strip()}\n"
    )


def build_memo(report: ActivityReport) -> str:
    if not is_posting(report):
        return ""
    detail, total = posting_detail(report)
    return f"{detail} 計{total}枚" if total > 0 else ""


def clean_segments(segments: List[List[List[float]]]) -> List[List[List[float]]]:
    """座標の範囲チェックをして、2点以上あるセグメントだけ残す（時刻は3番目の要素として保持）"""
    cleaned = []
    count = 0
    for seg in segments[:MAX_SEGMENTS]:
        pts = []
        for p in seg:
            if len(p) < 2:
                continue
            lon, lat = float(p[0]), float(p[1])
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                continue
            pts.append([lon, lat] + ([float(p[2])] if len(p) > 2 else []))
            count += 1
            if count >= MAX_POINTS:
                break
        if len(pts) >= 2:
            cleaned.append(pts)
        if count >= MAX_POINTS:
            break
    return cleaned


def lonlat_only(segments: List[List[List[float]]]) -> List[List[List[float]]]:
    return [[[p[0], p[1]] for p in seg] for seg in segments]


def build_gpx(segments: List[List[List[float]]], name: str) -> str:
    """記録した点からGPXを作る（既存のGPX保存・ダウンロードと互換を保つため）"""
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="活動記録マップ" xmlns="http://www.topografix.com/GPX/1/1">',
        f"<trk><name>{escape(name)}</name>",
    ]
    for seg in segments:
        lines.append("<trkseg>")
        for p in seg:
            time_tag = ""
            if len(p) > 2:
                t = datetime.fromtimestamp(p[2] / 1000, tz=timezone.utc)
                time_tag = f"<time>{t.strftime('%Y-%m-%dT%H:%M:%SZ')}</time>"
            lines.append(f'<trkpt lat="{p[1]:.7f}" lon="{p[0]:.7f}">{time_tag}</trkpt>')
        lines.append("</trkseg>")
    lines.append("</trk></gpx>")
    return "\n".join(lines)
