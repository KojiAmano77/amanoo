#!/bin/bash
# 活動記録マップのデータベースをバックアップする。
#   - mysqldump を gzip 圧縮して backups/ に日付付きで保存
#   - KEEP_DAYS 日より古いバックアップを削除
# パスワードは MySQL コンテナ内の環境変数を使うため、このスクリプトには書かない。
#
# 使い方:  ./backup-db.sh [保存先フォルダ]   （省略時はこのスクリプトと同じ場所の backups/）
# cron 例: 30 2 * * * /home/ubuntu/fastapi_nginx_project/deploy/oracle/backup-db.sh
set -euo pipefail

MYSQL_CONTAINER="team_activity_mysql"
KEEP_DAYS=14
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="${1:-$SCRIPT_DIR/backups}"
LOG="$BACKUP_DIR/backup.log"

mkdir -p "$BACKUP_DIR"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

FILE="$BACKUP_DIR/activity_$(date '+%Y%m%d_%H%M%S').sql.gz"
TMP="$FILE.tmp"

# 途中で失敗した書きかけファイルを残さない
trap 'rm -f "$TMP"' EXIT

if ! docker exec "$MYSQL_CONTAINER" sh -c \
    'exec mysqldump --single-transaction --no-tablespaces -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' \
    2>>"$LOG" | gzip > "$TMP"; then
    log "ERROR: mysqldump に失敗しました"
    exit 1
fi

# 壊れた・中身のないバックアップを成功扱いにしない
# （grep -q だと途中で読むのをやめて gunzip が中断扱いになるため、-c で最後まで読む）
if ! gzip -t "$TMP" 2>>"$LOG" || ! gunzip -c "$TMP" | grep -c "CREATE TABLE" >/dev/null; then
    log "ERROR: バックアップの内容を確認できませんでした"
    exit 1
fi

mv "$TMP" "$FILE"
log "バックアップ完了: $(basename "$FILE") ($(du -h "$FILE" | cut -f1))"

find "$BACKUP_DIR" -name 'activity_*.sql.gz' -mtime +"$KEEP_DAYS" -delete
