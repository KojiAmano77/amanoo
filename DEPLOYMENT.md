# ConoHa VPS デプロイメントガイド

## 前提条件
- ConoHa VPSサーバーが準備済み
- ドメイン `amanoo.f5.si` のDNS設定が完了
- Docker & Docker Compose がインストール済み

## 初回デプロイ手順

### 1. サーバーにファイルをアップロード
```bash
# プロジェクトファイルをサーバーにアップロード
scp -r . user@your-server-ip:/opt/amanoo/
```

### 2. 環境設定
```bash
cd /opt/amanoo

# 本番環境用の.envファイルを作成
cp .env.production .env

# .envファイルを編集（特にSECRET_KEYを変更）
nano .env
```

### 3. SSL証明書の取得とサービス起動
```bash
# セットアップスクリプトを実行
chmod +x setup-ssl.sh
./setup-ssl.sh
```

### 4. 手動でSSL証明書を取得する場合
```bash
# 1. 必要なディレクトリを作成
mkdir -p certbot/conf certbot/www

# 2. 一時的にHTTPのみでサービス起動
docker-compose up -d mysql fastapi

# 3. 一時的なnginx設定を作成
cat > nginx/nginx-http.conf << 'EOF'
events {
    worker_connections 1024;
}
http {
    server {
        listen 80;
        server_name amanoo.f5.si;
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        location / {
            proxy_pass http://fastapi:8000;
            proxy_set_header Host $host;
        }
    }
}
EOF

# 4. nginx起動
docker run --rm -d \
  --name temp-nginx \
  -p 80:80 \
  -v $(pwd)/nginx/nginx-http.conf:/etc/nginx/nginx.conf:ro \
  -v $(pwd)/certbot/www:/var/www/certbot:ro \
  --network amanoo_app-network \
  nginx:alpine

# 5. SSL証明書取得
docker run --rm \
  -v $(pwd)/certbot/conf:/etc/letsencrypt \
  -v $(pwd)/certbot/www:/var/www/certbot \
  certbot/certbot certonly --webroot \
  -w /var/www/certbot \
  --email your-email@example.com \
  -d amanoo.f5.si \
  --agree-tos

# 6. 一時nginxを停止してフルサービス起動
docker stop temp-nginx
docker-compose up -d
```

### 5. サービス確認
```bash
# サービス状態確認
docker-compose ps

# ログ確認
docker-compose logs -f nginx
docker-compose logs -f fastapi
```

## アクセスURL
- **メインサービス**: https://amanoo.f5.si/dashboard
- **ログインページ**: https://amanoo.f5.si/（自動的にダッシュボードにリダイレクト）

## 証明書の自動更新設定

### crontabに追加
```bash
crontab -e

# 以下を追加（毎日12時に実行）
0 12 * * * /opt/amanoo/renew-ssl.sh
```

### 更新スクリプト
```bash
#!/bin/bash
cd /opt/amanoo
docker-compose run --rm certbot renew
docker-compose restart nginx
```

## トラブルシューティング

### SSL証明書エラー
```bash
# 証明書ファイルの確認
ls -la certbot/conf/live/amanoo.f5.si/

# 証明書の詳細確認
openssl x509 -in certbot/conf/live/amanoo.f5.si/fullchain.pem -text -noout
```

### nginxエラー
```bash
# nginx設定テスト
docker-compose exec nginx nginx -t

# nginxログ確認
docker-compose logs nginx
```

### データベース接続エラー
```bash
# MySQL接続テスト
docker-compose exec mysql mysql -u app_user -p team_activities

# FastAPIログ確認
docker-compose logs fastapi
```

## セキュリティ設定

### ファイアウォール
```bash
# 必要なポートのみ開放
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable
```

### 定期バックアップ
```bash
# データベースバックアップスクリプト例
#!/bin/bash
docker-compose exec mysql mysqldump -u app_user -p team_activities > backup_$(date +%Y%m%d).sql
```

## 環境変数一覧

### .env ファイル設定項目
```
DATABASE_URL=mysql+pymysql://app_user:app_password@mysql:3306/team_activities
SECRET_KEY=本番環境用の長いランダム文字列
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30
ENVIRONMENT=production
```

## 監視とログ

### ログローテーション
```bash
# Docker logsのローテーション設定
echo '{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}' > /etc/docker/daemon.json
systemctl restart docker
```

### ヘルスチェック
```bash
# サービス稼働確認
curl -f https://amanoo.f5.si/dashboard || echo "Service down"
```