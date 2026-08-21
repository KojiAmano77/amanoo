import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", SMTP_USERNAME)

async def send_password_reset_email(to_email: str, reset_token: str):
    """パスワードリセット用のメールを送信"""
    reset_url = f"https://amanoo.f5.si/reset-password?token={reset_token}"
    
    subject = "パスワードリセットのご案内"
    
    html_content = f"""
    <html>
      <body>
        <h2>パスワードリセットのご案内</h2>
        <p>パスワードのリセットが要求されました。</p>
        <p>下記のリンクをクリックして、新しいパスワードを設定してください：</p>
        <p><a href="{reset_url}">パスワードをリセットする</a></p>
        <p>このリンクは24時間有効です。</p>
        <p>もしこのリクエストに心当たりがない場合は、このメールを無視してください。</p>
        <hr>
        <p>愛知第12支部活動記録マップ</p>
      </body>
    </html>
    """
    
    text_content = f"""
    パスワードリセットのご案内
    
    パスワードのリセットが要求されました。
    下記のURLにアクセスして、新しいパスワードを設定してください：
    
    {reset_url}
    
    このリンクは24時間有効です。
    もしこのリクエストに心当たりがない場合は、このメールを無視してください。
    
    愛知第12支部活動記録マップ
    """
    
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = FROM_EMAIL
    message["To"] = to_email
    
    text_part = MIMEText(text_content, "plain", "utf-8")
    html_part = MIMEText(html_content, "html", "utf-8")
    
    message.attach(text_part)
    message.attach(html_part)
    
    try:
        await aiosmtplib.send(
            message,
            hostname=SMTP_SERVER,
            port=SMTP_PORT,
            start_tls=True,
            username=SMTP_USERNAME,
            password=SMTP_PASSWORD,
        )
        return True
    except Exception as e:
        print(f"メール送信エラー: {e}")
        return False

async def send_password_changed_email(to_email: str):
    """パスワード変更完了通知メールを送信"""
    subject = "パスワード変更完了のお知らせ"
    
    html_content = f"""
    <html>
      <body>
        <h2>パスワード変更完了</h2>
        <p>お客様のアカウントのパスワードが正常に変更されました。</p>
        <p>変更日時: {datetime.now().strftime('%Y年%m月%d日 %H:%M')}</p>
        <p>もしこの変更にお心当たりがない場合は、すぐにサポートまでご連絡ください。</p>
        <hr>
        <p>愛知第12支部活動記録マップ</p>
      </body>
    </html>
    """
    
    text_content = f"""
    パスワード変更完了
    
    お客様のアカウントのパスワードが正常に変更されました。
    変更日時: {datetime.now().strftime('%Y年%m月%d日 %H:%M')}
    
    もしこの変更にお心当たりがない場合は、すぐにサポートまでご連絡ください。
    
    愛知第12支部活動記録マップ
    """
    
    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = FROM_EMAIL
    message["To"] = to_email
    
    text_part = MIMEText(text_content, "plain", "utf-8")
    html_part = MIMEText(html_content, "html", "utf-8")
    
    message.attach(text_part)
    message.attach(html_part)
    
    try:
        await aiosmtplib.send(
            message,
            hostname=SMTP_SERVER,
            port=SMTP_PORT,
            start_tls=True,
            username=SMTP_USERNAME,
            password=SMTP_PASSWORD,
        )
        return True
    except Exception as e:
        print(f"メール送信エラー: {e}")
        return False