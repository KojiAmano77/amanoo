from fastapi import FastAPI, Request, UploadFile, Form, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from dotenv import load_dotenv
import os
import csv
import tempfile
from datetime import datetime
import re

app = FastAPI()

# .envからOPENAI_API_KEY読み込み
load_dotenv()
api_key = os.getenv("OPENAI_API_KEY")
if not api_key:
    raise ValueError("OPENAI_API_KEY is not set")

client = OpenAI(api_key=api_key)

# 円換算用定数
JPY_PER_USD = 155  # 任意に調整
GPT_COST_PER_TOKEN = 0.0015 / 1000  # gpt-3.5-turbo 入力 $0.0015/1K tokens
WHISPER_COST_PER_MIN_USD = 0.006

@app.get("/favicon.ico")
async def favicon():
    return FileResponse("frontend/favicon.ico")

@app.post("/whisper")
async def whisper_endpoint(file: UploadFile = File(...)):
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp:
        temp.write(await file.read())
        temp_path = temp.name

    # Whisperで文字起こし
    response = client.audio.transcriptions.create(
        model="whisper-1",
        file=open(temp_path, "rb"),
        response_format="text"
    )
    text = response.strip()

    # Whisperコスト計算（15秒固定）
    duration_sec = 15.0
    whisper_cost_usd = (duration_sec / 60) * WHISPER_COST_PER_MIN_USD
    whisper_cost_jpy = round(whisper_cost_usd * JPY_PER_USD, 2)

    return {
        "text": text,
        "whisper_cost_jpy": whisper_cost_jpy,
        "duration_sec": duration_sec
    }

@app.post("/chat")
async def chat_with_gpt(message: str = Form(...)):
    # 今日の日付を "yyyy-MM-dd" 形式で取得
    today_str = datetime.now().strftime("%Y-%m-%d")
    this_year_str = datetime.now().strftime("%Y")
    # 勘定科目の候補（必要に応じて編集可能）
    accounts = [
        "接待交際費", "租税公課", "外注工賃", "減価償却費", "繰延資産の償却費", "貸倒金",
        "地代家賃", "利子割引料", "荷造運賃", "水道光熱費", "旅費交通費",
        "通信費", "広告宣伝費", "損害保険料", "修繕費",
        "消耗品費", "新聞図書費", "固定資産の損失", "雑費"
    ]

    # 目的の候補
    purposes = [
        "打ち合わせ", "差入れ", "在庫補充", "ガソリン代として"
    ]

    account_list = "\n".join([f"- {item}" for item in accounts])
    purpose_list = "\n".join([f"- {item}" for item in purposes])

    prompt = f"""
以下の文は人がレシートを読み上げた音声内容です。
この文章から次の8つの情報を正確に抜き出してください：

1. 購入日（例: 2025-05-01）
2. 店名（例: セブンイレブン）※省略されてない正式名称で
3. 品名（品名が食料品の場合は"飲食代"と入力してください）
4. 個数（不明な場合は"1"としてください）
5. 単位（"個"、"式"、"人" の中から最も適切なもの。どれにも当てはまらない場合は "式"）
6. 金額（税込）（例: 1200）
7. 勘定科目（下記リストから最も適切なものを1つ。食料品や飲食店での出費は「接待交際費」）
8. 目的（下記リストから最も適切なものを1つ。選択に迷う場合は"打ち合わせ"と入力して）

【勘定科目候補】：
{account_list}

【目的の候補】：
{purpose_list}

出力は以下のJSON形式で返してください：
- "購入日"は必ず"yyyy-MM-dd"の形式にして下さい。
  - 西暦年が不明な場合は {this_year_str} 年とみなして下さい。
  - 日付全体が不明な場合は "{today_str}" を設定して下さい。
- "金額"はカンマやピリオドを含まない形の文字列で表現してください。

{{
"購入日": "yyyy-MM-dd",
"店名": "○○○○",
"品名": "(食品名の場合は'飲食代'と入力)",
"個数": "(例：1)",
"単位": "(式,個,人の中から1つ。選択に迷う場合は'式'を選択してください)",
"金額": "○○○",
"勘定科目": "（上記の中から1つ）",
"目的": "（上記の中から1つ）"
}}

もし情報が見つからない場合は空文字にしてください。

音声内容:
{message}
"""
    response = client.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=[{"role": "user", "content": prompt}],
    )

    content = response.choices[0].message.content
    usage = response.usage
    total_tokens = usage.prompt_tokens + usage.completion_tokens
    gpt_cost_usd = total_tokens * GPT_COST_PER_TOKEN
    gpt_cost_jpy = round(gpt_cost_usd * JPY_PER_USD, 2)

    return {
        "content": content,
        "gpt_cost_jpy": gpt_cost_jpy
    }

@app.post("/save-data")
async def save_data(request: Request):
    try:
        data = await request.json()
        purchase_date = data.get("purchaseDate", "")
        store_name = data.get("storeName", "")
        item_name = data.get("itemName", "")
        item_quantity = data.get("itemQuantity", "")
        item_quantity = item_quantity.translate(str.maketrans("０１２３４５６７８９", "0123456789"))# ✅ 1. 全角 → 半角に変換
        item_quantity = item_quantity.replace(",", "")# ✅ 2. カンマ削除
        if not re.fullmatch(r"[1-9][0-9]*", item_quantity):# ✅ 3. 数字でない or 0 の場合は "1" にする
            item_quantity = "1"
        item_unit = data.get("itemUnit", "")
        total_amount = data.get("totalAmount", "")
        category = data.get("category", "")
        purpose = data.get("purpose", "")

        os.makedirs("../data", exist_ok=True)
        file_path = "../data/receipts.csv"
        write_header = not os.path.exists(file_path)

        with open(file_path, mode="a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            if write_header:
                writer.writerow(["勘定科目", "購入日", "店名", "品名", "個数", "単位", "税込み合計", "目的"])
            writer.writerow([category, purchase_date, store_name, item_name, item_quantity, item_unit, total_amount, purpose])

        return JSONResponse(content={"status": "ok"})
    except Exception as e:
        return JSONResponse(content={"status": "error", "message": str(e)}, status_code=500)

@app.get("/latest-receipts")
def get_latest_receipts():
    try:
        with open("../data/receipts.csv", "r", encoding="utf-8") as f:
            reader = list(csv.reader(f))
            headers = reader[0]
            rows = reader[1:]
            latest = rows[-3:][::-1]  # 最新3件を新しい順に
            return {"headers": headers, "rows": latest}
    except FileNotFoundError:
        return {"headers": [], "rows": []}

@app.get("/download-csv")
async def download_csv():
    file_path = "../data/receipts.csv"
    if os.path.exists(file_path):
        return FileResponse(path=file_path, filename="receipts.csv", media_type="text/csv")
    else:
        return JSONResponse(content={"error": "ファイルが存在しません。"}, status_code=404)

# ✅ 最後に静的ファイルをマウント（index.html を自動返却）
frontend_path = os.path.join(os.path.dirname(__file__), "frontend")
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")
