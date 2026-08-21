#!/bin/bash
# SSL証明書自動更新スクリプト
# 対象: sanseitoaichi12.f5.si
# 更新方式: standalone（port 80 を一時開放）
# cron: 毎日 3:00 と 15:00 に実行（certbot は期限30日未満のときのみ実際に更新）

set -uo pipefail

LOG="/home/koji/fastapi_nginx_project/ssl-renew.log"
NGINX_CONTAINER="main_nginx"
RECEIPT_NETWORK="receipt_input_receipt_network"
ACTIVITY_NETWORK="fastapi_nginx_project_activity_network"

TIMESTAMP() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(TIMESTAMP)] $*" >> "$LOG"; }

log "=== SSL証明書更新チェック開始 ==="

# main_nginx を停止して port 80 を開放
log "main_nginx 停止中..."
if ! docker stop "$NGINX_CONTAINER" >> "$LOG" 2>&1; then
    log "ERROR: main_nginx の停止に失敗しました"
    exit 1
fi
log "main_nginx 停止完了"

# certbot で sanseitoaichi12.f5.si のみ更新
# （www.amanooo.top は DNS 障害のためスキップ）
log "certbot renew 実行中..."
RENEW_OUTPUT=$(docker run --rm \
    -v /tmp/letsencrypt:/etc/letsencrypt \
    -p 80:80 \
    certbot/certbot:latest renew \
    --cert-name sanseitoaichi12.f5.si \
    --standalone \
    --non-interactive \
    2>&1)
RENEW_EXIT=$?

echo "$RENEW_OUTPUT" >> "$LOG"

if [ $RENEW_EXIT -ne 0 ]; then
    log "WARNING: certbot renew がエラーを返しました (exit=$RENEW_EXIT)"
else
    log "certbot renew 完了"
fi

# main_nginx を再起動（更新成功・失敗に関わらず必ず起動）
log "main_nginx 起動中..."
if ! docker start "$NGINX_CONTAINER" >> "$LOG" 2>&1; then
    log "ERROR: main_nginx の起動に失敗しました"
    exit 1
fi

# Docker ネットワーク再接続（stop/start でネットワークが切れる場合の対策）
sleep 1
docker network connect "$RECEIPT_NETWORK" "$NGINX_CONTAINER" >> "$LOG" 2>&1 || true
docker network connect "$ACTIVITY_NETWORK" "$NGINX_CONTAINER" >> "$LOG" 2>&1 || true
log "main_nginx 起動完了"

# nginx に更新済み証明書をリロード
sleep 5
log "nginx 設定リロード中..."
if docker exec "$NGINX_CONTAINER" nginx -s reload >> "$LOG" 2>&1; then
    log "nginx リロード完了"
else
    log "WARNING: nginx リロード失敗（リトライ中）"
    sleep 5
    docker exec "$NGINX_CONTAINER" nginx -s reload >> "$LOG" 2>&1 && log "nginx リロード完了（リトライ成功）"
fi

# 更新結果のサマリー
if echo "$RENEW_OUTPUT" | grep -q "Certificate not yet due for renewal"; then
    log "結果: 更新不要（期限まで余裕あり）"
elif echo "$RENEW_OUTPUT" | grep -q "Successfully renewed"; then
    log "結果: ✅ 証明書を更新しました"
else
    log "結果: certbot 出力を確認してください"
fi

log "=== 完了 ==="
echo "" >> "$LOG"
