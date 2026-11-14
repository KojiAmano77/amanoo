#!/bin/bash
# SSL証明書自動更新スクリプト
# 対象: sanseitoaichi12.f5.si
# 更新方式: webroot（nginx を止めずに更新する。2026-11-01 に standalone 方式から変更）
#   - certbot が /home/koji/certbot-www に確認用ファイルを置き、nginx がそれを
#     http://sanseitoaichi12.f5.si/.well-known/acme-challenge/ で配信する
#     （設定は /home/koji/main-nginx/nginx.conf と docker-compose.yml）
#   - 実際に更新されたときだけ nginx に設定を読み直させる（サイトは止まらない）
# cron: 毎日 3:00 と 15:00 に実行（certbot は期限30日未満のときのみ実際に更新）
#
# 以前の standalone 方式は nginx を毎回止めて 80 番を空けていたため、
# 止めた間に他のプロセスが 80 番を使うと nginx が起動できず、サイトが止まることがあった（2026-11-01）

set -uo pipefail

LOG="/home/koji/fastapi_nginx_project/ssl-renew.log"
NGINX_CONTAINER="main_nginx"
WEBROOT="/home/koji/certbot-www"

TIMESTAMP() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(TIMESTAMP)] $*" >> "$LOG"; }

log "=== SSL証明書更新チェック開始（webroot方式） ==="

mkdir -p "$WEBROOT"

log "certbot renew 実行中..."
RENEW_OUTPUT=$(docker run --rm \
    -v /home/koji/letsencrypt:/etc/letsencrypt \
    -v "$WEBROOT":/var/www/certbot \
    certbot/certbot:latest renew \
    --cert-name sanseitoaichi12.f5.si \
    --webroot -w /var/www/certbot \
    --non-interactive \
    2>&1)
RENEW_EXIT=$?
echo "$RENEW_OUTPUT" >> "$LOG"

if [ $RENEW_EXIT -ne 0 ]; then
    log "WARNING: certbot renew がエラーを返しました (exit=$RENEW_EXIT)"
fi

if echo "$RENEW_OUTPUT" | grep -q "Certificate not yet due for renewal"; then
    log "結果: 更新不要（期限まで余裕あり）"
elif echo "$RENEW_OUTPUT" | grep -q "Successfully renewed"; then
    # 新しい証明書を読み込ませる（reload なので接続中の利用者にも影響しない）
    log "nginx 設定リロード中..."
    if docker exec "$NGINX_CONTAINER" nginx -s reload >> "$LOG" 2>&1; then
        log "結果: ✅ 証明書を更新し、nginx に反映しました"
    else
        log "ERROR: 証明書は更新しましたが nginx のリロードに失敗しました（docker exec $NGINX_CONTAINER nginx -s reload を手動で実行してください）"
    fi
else
    log "結果: certbot 出力を確認してください"
fi

log "=== 完了 ==="
echo "" >> "$LOG"
