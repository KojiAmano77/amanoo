"""活動記録マップからの報告を、Googleフォームの回答シートにも1行残す。

スプレッドシート側に置いたGASのWebアプリ（deploy/gas/map-report-to-sheet.gs）に送る。
GAS側は1行目の見出し（＝フォームの質問タイトル）で列を探すので、ここでは質問タイトルをキーにして値を渡す。
同期関数なので、FastAPIからは run_in_threadpool 経由で呼ぶ。
"""
import json
import os
import urllib.error
import urllib.request

from dotenv import load_dotenv

from activity_report import BILLS, ActivityReport, _to_int, is_posting, parse_date

load_dotenv()

SHEET_WEBAPP_URL = os.getenv("SHEET_WEBAPP_URL", "").strip()
SHEET_WEBAPP_SECRET = os.getenv("SHEET_WEBAPP_SECRET", "").strip()
HTTP_TIMEOUT_SEC = 30

# ビラの種類（activity_report.BILLS のキー）→ フォームの質問タイトル（最新GASの buildPostingDetail と同じ）
FORM_BILL_TITLES = {
    "ito": "伊藤議員 市政報告ビラのポスティング枚数",
    "kanda": "神田議員 市政報告ビラのポスティング枚数",
    "fujimoto": "藤本議員 後援会通信のポスティング枚数",
    "sanseito": "参政党ビラのポスティング枚数",
}


def build_row_values(report: ActivityReport, poster: str) -> dict:
    """フォームの質問タイトル → 値。未入力の項目は空欄にする（フォームの未回答と同じ見た目）。
    活動種類ごとに、フォームのその活動のセクションの質問タイトルに入れる（GASの buildMessage と同じ対応）"""
    d = parse_date(report.date)
    values = {
        "報告元": "活動記録マップ",
        "活動種類": report.activity_type,
        "投稿者": poster,
        "参加者（投稿者以外）": report.participants.strip(),
        "参加人数合計": report.total_people or "",
        "日付": f"{d.year}/{d.month:02d}/{d.day:02d}",
        "開始時刻": report.start_time,
        "終了時刻": report.end_time,
    }
    if not is_posting(report):
        values["活動エリア"] = report.area.strip()
        values["活動報告（街宣車活動）"] = report.report_text.strip()
        return values

    values.update({
        "ポスティングエリア（住所等）": report.area.strip(),
        "小学校学区": report.school.strip(),
        "ビラ手渡し枚数": _to_int(report.tewatashi) or "",
        "活動報告（ポスティング）": report.report_text.strip(),
    })
    for key, _label in BILLS:
        count = _to_int(report.bills.get(key))
        values[FORM_BILL_TITLES[key]] = count or ""
    return values


def append_report(values: dict) -> dict:
    """戻り値: {"saved": bool, "row": int|None, "unmatched": [...], "skipped_reason": str|None}"""
    if not SHEET_WEBAPP_URL or not SHEET_WEBAPP_SECRET:
        return {"saved": False, "row": None, "unmatched": [], "skipped_reason": "スプレッドシートの設定がありません"}

    data = json.dumps({"secret": SHEET_WEBAPP_SECRET, "values": values}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(SHEET_WEBAPP_URL, data=data,
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        # GASのWebアプリは結果を別URLへのリダイレクトで返す。urllib が自動で追いかける
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SEC) as res:
            result = json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, ValueError, OSError) as e:
        print(f"スプレッドシート書き込みエラー: {e}")
        return {"saved": False, "row": None, "unmatched": [], "skipped_reason": "スプレッドシートに接続できませんでした"}

    if not result.get("ok"):
        print(f"スプレッドシート書き込みエラー: {result.get('error')}"
              + (f" シートの見出し: {result['headers']}" if result.get("headers") else ""))
        return {"saved": False, "row": None, "unmatched": [], "skipped_reason": result.get("error") or "書き込みに失敗しました"}

    unmatched = result.get("unmatched") or []
    if unmatched:
        # フォームの質問タイトルが変わった可能性がある
        print(f"スプレッドシートに見出しが見つからない項目: {unmatched}")
    return {"saved": True, "row": result.get("row"), "unmatched": unmatched, "skipped_reason": None}
