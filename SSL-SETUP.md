# SSL証明書設定ガイド

## 本番環境でのLet's Encrypt証明書取得手順

### 前提条件
1. ドメイン `amanoo.f5.si` がサーバーのIPアドレスに正しく設定されている
2. ポート80, 443がファイアウォールで開放されている
3. Dockerとdocker-composeがインストールされている

### 手順

#### 1. 初回証明書取得

```bash
# サービスを停止
docker-compose down

# HTTP専用設定でnginxを一時起動（証明書検証のため）
# nginx/nginx.confを一時的にHTTP専用に変更

# certbotコンテナで証明書取得
docker-compose run --rm certbot certonly \
  --webroot \
  --webroot-path /var/www/certbot \
  --email koji.amano.g@gmail.com \
  --agree-tos \
  --no-eff-email \
  -d amanoo.f5.si

# nginx設定をHTTPS対応に戻す
# 本ファイルの設定をそのまま使用

# サービス再起動
docker-compose up -d
```

#### 2. 証明書の自動更新設定

crontabに以下を追加：

```bash
# 毎月1日午前2時に証明書更新をチェック
0 2 1 * * cd /path/to/fastapi_nginx_project && docker-compose run --rm certbot renew && docker-compose exec nginx nginx -s reload
```

#### 3. 本番環境での設定確認

```bash
# SSL証明書の確認
openssl x509 -in ./certbot/conf/live/amanoo.f5.si/cert.pem -text -noout

# nginx設定のテスト
docker-compose exec nginx nginx -t

# SSL接続テスト
curl -I https://amanoo.f5.si
```

## 開発環境設定

開発環境では自己署名証明書を使用：

```bash
# 自己署名証明書の生成
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/privkey.pem \
  -out nginx/ssl/fullchain.pem \
  -subj "/C=JP/ST=Aichi/L=Okazaki/O=Development/CN=localhost"

# nginx設定で自己署名証明書を使用するよう変更
# ssl_certificate /etc/nginx/ssl/fullchain.pem;
# ssl_certificate_key /etc/nginx/ssl/privkey.pem;
```

## セキュリティ考慮事項

1. **証明書の権限管理**: 証明書ファイルは適切な権限で保護する
2. **定期更新**: Let's Encrypt証明書は90日で期限切れになるため自動更新を設定
3. **HSTS設定**: ブラウザにHTTPS接続を強制するため設定済み
4. **セキュリティヘッダー**: XSS保護、コンテンツタイプ検証等を設定済み

## トラブルシューティング

### 証明書取得エラー
- ドメインのDNS設定を確認
- ファイアウォール設定を確認
- 既存の証明書を削除: `rm -rf ./certbot/conf/live/amanoo.f5.si`

### nginx起動エラー
- 設定ファイルの構文確認: `nginx -t`
- 証明書ファイルの存在確認
- ポートの競合確認

### 接続エラー
- SSL証明書の有効期限確認
- 中間証明書の設定確認
- ブラウザキャッシュのクリア