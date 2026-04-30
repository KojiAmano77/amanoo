#!/bin/bash
set -e

PROJECT_DIR="/home/koji/fastapi_nginx_project"
LOG_FILE="$PROJECT_DIR/ssl-renew.log"

cd "$PROJECT_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting SSL renewal check..." >> "$LOG_FILE"

docker compose run --rm certbot renew --quiet 2>> "$LOG_FILE"

docker exec team_activity_nginx nginx -s reload 2>> "$LOG_FILE"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done." >> "$LOG_FILE"
