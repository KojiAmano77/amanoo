import asyncio
import sys
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from jose import jwt
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

REPO_ROOT = Path(__file__).resolve().parents[1]
APP_DIR = REPO_ROOT
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

# 本番DBには読み書きしない（users だけをメモリ上のSQLiteに作って使う）。
# main の import 時にテーブル作成が走るため、アプリと同じDB設定のコンテナ内で実行する:
#   docker exec activity_app python -m unittest tests.test_login_security

import auth
import main
from database import Base, User


def fake_request(ip="203.0.113.1"):
    return SimpleNamespace(headers={"x-real-ip": ip}, client=None)


class LoginSecurityTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine, tables=[User.__table__])
        self.db = sessionmaker(bind=engine, autoflush=False)()
        self.db.add(User(username="山田太郎", email="y@example.com", password_hash=main.get_password_hash("123456"), is_readonly=True))
        self.db.add(User(username="管理者", email="a@example.com", password_hash=main.get_password_hash("adminpass"), is_admin=True))
        self.db.commit()
        main._login_failures.clear()
        self.addCleanup(main._login_failures.clear)
        self.addCleanup(self.db.close)

    def login(self, username="山田太郎", password="123456", ip="203.0.113.1"):
        return asyncio.run(main.login(fake_request(ip), username=username, password=password, db=self.db))

    def login_status(self, **kwargs):
        try:
            self.login(**kwargs)
            return 200
        except HTTPException as e:
            return e.status_code

    def current_user(self, token):
        payload = auth.verify_token(HTTPAuthorizationCredentials(scheme="Bearer", credentials=token))
        return auth.get_current_user(payload, self.db)

    # --- 回数制限 ---

    def test_locked_after_five_failures_even_with_correct_password(self):
        for _ in range(main.LOGIN_MAX_FAILURES):
            self.assertEqual(self.login_status(password="wrong"), 401)

        self.assertEqual(self.login_status(password="wrong"), 429)
        self.assertEqual(self.login_status(), 429)  # 正しいパスワードでもロック中は通らない

    def test_lock_is_released_after_lock_minutes(self):
        for _ in range(main.LOGIN_MAX_FAILURES):
            self.login_status(password="wrong")
        self.assertEqual(self.login_status(), 429)

        later = datetime.utcnow() + timedelta(minutes=main.LOGIN_LOCK_MINUTES, seconds=1)
        with patch.object(main, "datetime") as fake_datetime:
            fake_datetime.utcnow.return_value = later
            self.assertEqual(self.login_status(), 200)

    def test_success_resets_failure_count(self):
        for _ in range(main.LOGIN_MAX_FAILURES - 1):
            self.login_status(password="wrong")
        self.assertEqual(self.login_status(), 200)

        for _ in range(main.LOGIN_MAX_FAILURES - 1):
            self.assertEqual(self.login_status(password="wrong"), 401)
        self.assertEqual(self.login_status(), 200)

    def test_lock_is_per_username(self):
        for _ in range(main.LOGIN_MAX_FAILURES):
            self.login_status(password="wrong")

        self.assertEqual(self.login_status(username="管理者", password="adminpass"), 200)

    def test_unknown_usernames_are_counted_too(self):
        for _ in range(main.LOGIN_MAX_FAILURES):
            self.assertEqual(self.login_status(username="いない人", password="x"), 401)
        self.assertEqual(self.login_status(username="いない人", password="x"), 429)

    def test_ip_is_blocked_when_trying_many_usernames(self):
        for i in range(main.LOGIN_IP_MAX_FAILURES):
            self.assertEqual(self.login_status(username=f"名前{i}", password="x"), 401)

        self.assertEqual(self.login_status(), 429)                      # 同じ接続元は止まる
        self.assertEqual(self.login_status(ip="198.51.100.7"), 200)     # 別の接続元は影響なし

    # --- ログイン期間 ---

    def token_days(self, token):
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        return (datetime.utcfromtimestamp(payload["exp"]) - datetime.utcnow()).total_seconds() / 86400

    def test_login_period_is_90_days_and_7_days_for_admin(self):
        self.assertAlmostEqual(self.token_days(self.login()["access_token"]), 90, delta=0.01)
        admin_token = self.login(username="管理者", password="adminpass")["access_token"]
        self.assertAlmostEqual(self.token_days(admin_token), 7, delta=0.01)

    # --- パスワード変更で古いログインを無効にする ---

    def test_old_token_is_rejected_after_password_change(self):
        old_token = self.login()["access_token"]
        self.assertEqual(self.current_user(old_token).username, "山田太郎")

        user = self.db.query(User).filter(User.username == "山田太郎").one()
        user.password_hash = main.get_password_hash("654321")
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            self.current_user(old_token)
        self.assertEqual(ctx.exception.status_code, 401)

        new_token = self.login(password="654321")["access_token"]
        self.assertEqual(self.current_user(new_token).username, "山田太郎")

    def test_token_without_fingerprint_is_rejected(self):
        legacy = auth.create_access_token({"sub": "山田太郎"}, timedelta(hours=12))
        with self.assertRaises(HTTPException) as ctx:
            self.current_user(legacy)
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
