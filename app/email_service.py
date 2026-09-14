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

async def send_new_account_email(to_email: str, username: str, password: str):
    """Googleフォーム経由で新規発行したアカウントの初期パスワードを通知"""
    login_url = "https://sanseitoaichi12.f5.si/"
    subject = "参政党愛知第12支部活動記録マップのアカウントが発行されました"

    html_content = f"""
    <html>
      <body style="margin:0; padding:0; background-color:#fff8f0; font-family:'Hiragino Sans','Meiryo',sans-serif;">
        <div style="max-width:480px; margin:24px auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #ffe0c2; box-shadow:0 2px 8px rgba(255,140,0,0.08);">

          <div style="background:linear-gradient(135deg,#ff9800,#ffb74d); padding:28px 24px; text-align:center;">
            <div style="font-size:34px;">🎉🍊🎉🍊</div>
            <h1 style="color:#ffffff; font-size:20px; margin:8px 0 0;">アカウント発行のお知らせ</h1>
          </div>

          <div style="padding:24px;">
            <p style="color:#5a4632; font-size:14px; line-height:1.7;">
              参政党愛知第12支部活動記録マップへようこそ！<br>
              あなたのアカウントが発行されました✨
            </p>

            <div style="background:#fff3e0; border:2px dashed #ffb74d; border-radius:12px; padding:16px 20px; margin:20px 0;">
              <p style="margin:0 0 8px; font-size:13px; color:#e65100;">👤 ログインID</p>
              <p style="margin:0 0 16px; font-size:18px; font-weight:bold; color:#3a2e20;">{username}</p>
              <p style="margin:0 0 8px; font-size:13px; color:#e65100;">🔑 パスワード</p>
              <p style="margin:0; font-size:18px; font-weight:bold; color:#3a2e20; letter-spacing:2px;">{password}</p>
            </div>

            <div style="text-align:center; margin:24px 0;">
              <a href="{login_url}" style="display:inline-block; background:#ff9800; color:#ffffff; text-decoration:none; font-weight:bold; padding:12px 32px; border-radius:24px; font-size:15px;">ログインページを開く 🚀</a>
            </div>

            <p style="color:#8a7660; font-size:12px; line-height:1.6; background:#fdf6ee; border-radius:8px; padding:12px 14px;">
              🔒 パスワードを変更したい場合は、ログイン画面の「パスワードをお忘れですか？」からこのメールアドレス（{to_email}）を入力すると変更できます。
            </p>
          </div>

          <div style="background:#fff3e0; text-align:center; padding:14px; font-size:12px; color:#a1785a;">
            参政党 愛知第12支部活動記録マップ 🍊
          </div>
        </div>
      </body>
    </html>
    """

    text_content = f"""
    アカウント発行のお知らせ

    愛知第12支部活動記録マップのアカウントが作成されました。
    ログインID：{username}
    パスワード：{password}

    {login_url}

    パスワードを変更したい場合は、ログイン画面の「パスワードをお忘れですか？」から
    このメールアドレス（{to_email}）を入力すると変更できます。

    愛知第12支部活動記録マップ
    """

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = FROM_EMAIL
    message["To"] = to_email

    message.attach(MIMEText(text_content, "plain", "utf-8"))
    message.attach(MIMEText(html_content, "html", "utf-8"))

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