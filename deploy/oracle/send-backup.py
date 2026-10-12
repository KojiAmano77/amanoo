"""最新のDBバックアップを管理者宛てにメール添付で送る（サーバー外への退避）。

無料サーバーが突然止まったり消えたりしても復元できるようにするためのもの。
backup-db.sh が作った /backups/activity_*.sql.gz のうち最新の1つを送る。

アプリのコンテナ内で実行する（SMTP設定は .env のものを使う）:
    docker exec activity_app python /opt/send-backup.py
cron 例（毎週月曜 3:00）:
    0 3 * * 1 docker exec activity_app python /opt/send-backup.py >> /home/ubuntu/fastapi_nginx_project/deploy/oracle/backups/backup.log 2>&1

注意: バックアップには利用者のメールアドレス等が含まれる。送信先は管理者（ADMIN_EMAIL）のみ。
"""
import asyncio
import glob
import os
import sys
from datetime import datetime
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

sys.path.insert(0, "/app")

import aiosmtplib
from email_service import ADMIN_EMAIL, FROM_EMAIL, SMTP_PASSWORD, SMTP_PORT, SMTP_SERVER, SMTP_USERNAME

BACKUP_GLOB = "/backups/activity_*.sql.gz"
MAX_ATTACH_BYTES = 20 * 1024 * 1024  # Gmailの添付上限(25MB)に余裕を持たせる
MAX_AGE_HOURS = 48                   # これより古いものしか無ければ、バックアップが止まっているとみなす


async def send(subject: str, body: str, attachment_path: str = None) -> None:
    message = MIMEMultipart()
    message["Subject"] = subject
    message["From"] = FROM_EMAIL
    message["To"] = ADMIN_EMAIL
    message.attach(MIMEText(body, "plain", "utf-8"))

    if attachment_path:
        with open(attachment_path, "rb") as f:
            part = MIMEApplication(f.read(), _subtype="gzip")
        part.add_header("Content-Disposition", "attachment", filename=os.path.basename(attachment_path))
        message.attach(part)

    await aiosmtplib.send(
        message,
        hostname=SMTP_SERVER,
        port=SMTP_PORT,
        start_tls=True,
        username=SMTP_USERNAME,
        password=SMTP_PASSWORD,
    )


def main() -> int:
    files = sorted(glob.glob(BACKUP_GLOB), key=os.path.getmtime)
    if not files:
        asyncio.run(send("【活動記録マップ】⚠ バックアップが見つかりません",
                         "バックアップファイルが1つもありません。backup-db.sh と cron の設定を確認してください。"))
        print("ERROR: バックアップファイルがありません")
        return 1

    latest = files[-1]
    size = os.path.getsize(latest)
    age_hours = (datetime.now().timestamp() - os.path.getmtime(latest)) / 3600
    name = os.path.basename(latest)

    if age_hours > MAX_AGE_HOURS:
        asyncio.run(send("【活動記録マップ】⚠ バックアップが更新されていません",
                         f"最新のバックアップは {name}（約{age_hours:.0f}時間前）です。\n"
                         "backup-db.sh が毎日動いているか確認してください。古いものですが添付します。",
                         latest if size <= MAX_ATTACH_BYTES else None))
        print(f"WARNING: 最新のバックアップが古い ({name})")
        return 1

    if size > MAX_ATTACH_BYTES:
        asyncio.run(send("【活動記録マップ】⚠ バックアップが大きすぎて添付できません",
                         f"{name} は {size / 1024 / 1024:.1f}MB あり、メールに添付できませんでした。\n"
                         "サーバーから直接ダウンロードするか、別の退避方法を検討してください。"))
        print(f"WARNING: 添付できないサイズ ({name}, {size} bytes)")
        return 1

    asyncio.run(send(f"【活動記録マップ】DBバックアップ {name}",
                     f"活動記録マップのデータベースのバックアップです（{size / 1024 / 1024:.1f}MB）。\n"
                     "復元方法は deploy/oracle/README.md の「バックアップからの復元」を参照してください。",
                     latest))
    print(f"バックアップを送信しました: {name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
