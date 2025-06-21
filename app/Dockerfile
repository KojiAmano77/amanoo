FROM tiangolo/uvicorn-gunicorn-fastapi:python3.9

# 必要なシステムパッケージ（ffmpegなど）をインストール
USER root
RUN apt-get update && \
    apt-get install -y ffmpeg git && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# koji ユーザーに切り替え
# USER koji

# 作業ディレクトリの設定
WORKDIR /app

# 先に requirements.txt をコピーして依存パッケージをインストール
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# アプリケーションコードを後からコピー
COPY ./ /app

# 起動コマンド（FastAPIアプリ）
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
