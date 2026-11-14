FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
# pip 自体の脆弱性修正を取り込むため、先に pip を最新にする（pip 26.1 以降は Python 3.10 以上が必要）
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt

COPY ./ /app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
