#!/bin/bash

# SSL証明書取得・設定スクリプト
# ConoHa VPS での初回セットアップ用

echo "=== ConoHa VPS SSL セットアップスクリプト ==="

# 必要なディレクトリを作成
mkdir -p certbot/conf
mkdir -p certbot/www

# Dockerコンテナを起動（SSL証明書なしでHTTPのみ）
echo "1. 初回起動（HTTP）でLet's Encrypt認証を準備..."

# 一時的なnginx設定（HTTPSなし）を作成
cat > nginx/nginx-temp.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;
    
    server {
        listen 80;
        server_name amanoo.f5.si;
        
        # Let's Encrypt用のacme-challenge
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        # 他のリクエストは一時的にFastAPIに転送
        location / {
            proxy_pass http://fastapi:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
EOF

# 一時設定でコンテナ起動
echo "2. 一時設定でコンテナを起動..."
docker-compose down
cp nginx/nginx-temp.conf nginx/nginx.conf
docker-compose up -d mysql fastapi nginx

# 少し待つ
sleep 10

# SSL証明書を取得
echo "3. SSL証明書を取得..."
docker-compose run --rm certbot certonly --webroot \
    -w /var/www/certbot \
    --email your-email@example.com \
    -d amanoo.f5.si \
    --agree-tos \
    --no-eff-email

# 元のnginx設定に戻す
echo "4. 本番用nginx設定に切り替え..."
git checkout nginx/nginx.conf
docker-compose restart nginx

# 証明書の自動更新設定
echo "5. 証明書の自動更新を設定..."
cat > renew-ssl.sh << 'EOF'
#!/bin/bash
docker-compose run --rm certbot renew
docker-compose restart nginx
EOF
chmod +x renew-ssl.sh

# crontabに追加する設定を表示
echo "6. 以下のコマンドでcronに自動更新を追加してください:"
echo "crontab -e"
echo "# 以下の行を追加:"
echo "0 12 * * * /path/to/your/project/renew-ssl.sh"

echo "=== セットアップ完了 ==="
echo "https://amanoo.f5.si/dashboard でアクセスできるはずです"