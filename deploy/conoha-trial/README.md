# ConoHa お試し版（歩行ログ記録＋Chatwork報告）の立ち上げ手順

本番は Oracle（sanseitoaichi12.f5.si）。この手順は ConoHa（160.251.173.105）だけで行う。
お試し用ドメインは `dev.sanseitoaichi12.f5.si`（DDNS Now で 2026-11-22 に設定済み）。

## 1. お試し用ドメイン（DDNS Now）
1. DDNS Now で新しいサブドメインを取得する。
2. IPアドレスを `160.251.173.105` に設定する。
3. 反映されたか確認する: `dig +short dev.sanseitoaichi12.f5.si` → `160.251.173.105` と出ればOK。

## 2. 本番DBを ConoHa にコピーする
Oracle 側（PCから ssh）:
```bash
cd ~/fastapi_nginx_project/deploy/oracle && ./backup-db.sh   # backups/activity_YYYYMMDD_HHMMSS.sql.gz ができる
```
PC で ConoHa に転送し、ConoHa で取り込む:
```bash
# ConoHa 上で。念のため今の ConoHa の DB を退避してから入れ替える
docker exec team_activity_mysql sh -c 'exec mysqldump --single-transaction --no-tablespaces -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' | gzip > ~/conoha_db_before_trial.sql.gz
gunzip -c ~/activity_YYYYMMDD_HHMMSS.sql.gz | docker exec -i team_activity_mysql sh -c 'exec mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"'
```

## 3. `.env`（ConoHa の /home/koji/fastapi_nginx_project/.env）
- **メール誤送信の防止**: `SMTP_USERNAME=` と `SMTP_PASSWORD=` を空にする。
  メール内のリンクは本番URLのままなので、お試し版からはメールを送らない。
- 次の4行を追加する。トークンとキーは、GAS のスクリプトプロパティにある値をそのまま使う。
```
CHATWORK_TOKEN=（GASのCHATWORK_TOKEN）
CHATWORK_REPORT_ROOM_ID=420318628
GEOAPIFY_API_KEY=（GASのGEOAPIFY_API_KEY）
CHATWORK_GUIDE_FOOTER=
```
`420318628` は GAS の「テスト用チャット」。本番ルームには投稿されない。

## 4. nginx と証明書
1. `/home/koji/main-nginx/nginx.conf` をバックアップする（`cp nginx.conf nginx.conf.bak.$(date +%Y%m%d)`）。
2. `nginx-trial.conf` の **【A】ポート80ブロックだけ** を、`http { … }` の中に貼り付ける。
3. nginx に設定を読み込ませる:
```bash
docker exec main_nginx nginx -t && docker exec main_nginx nginx -s reload
```
4. 証明書を取得する（webroot 方式。nginx は止めない）:
```bash
docker run --rm -v /home/koji/letsencrypt:/etc/letsencrypt -v /home/koji/certbot-www:/var/www/certbot \
  certbot/certbot:latest certonly --webroot -w /var/www/certbot -d dev.sanseitoaichi12.f5.si \
  --email (管理者メール) --agree-tos --no-eff-email
```
5. 続いて **【B】443ブロック** も貼り付け、手順3と同じコマンドで再度読み込ませる。

証明書の有効期限は90日（2月下旬まで）。ConoHa の契約終了（2027-02-10）までもつので、自動更新の設定はしない。

## 5. アプリを起動する
```bash
cd /home/koji/fastapi_nginx_project
docker compose up -d --build fastapi
docker logs --tail 20 activity_app      # 「Database tables created successfully!」が出ればOK
docker network connect fastapi_nginx_project_activity_network main_nginx 2>/dev/null || true
```
`https://dev.sanseitoaichi12.f5.si/` を開いてログインできれば完了。

## 6. 片付け（お試し終了時）
```bash
docker stop activity_app
```
- nginx.conf はバックアップから戻す。
- コードを戻すときは git で今回のコミット前に戻す。
