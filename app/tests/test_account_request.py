import asyncio
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

REPO_ROOT = Path(__file__).resolve().parents[1]
APP_DIR = REPO_ROOT
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

# 本番DBには読み書きしない（users / account_requests だけをメモリ上のSQLiteに作って使う）。
# main の import 時にテーブル作成が走るため、アプリと同じDB設定のコンテナ内で実行する:
#   docker exec activity_app python -m unittest tests.test_account_request

import main
from database import AccountRequest, Base, User

APPROVERS = ["shibu@example.com", "shibucho@example.com"]
ADMIN = "admin@example.com"


def page_stub(request, state, account_request=None, detail=""):
    return state


@patch.object(main, "_account_request_page", page_stub)
@patch.object(main, "ADMIN_EMAIL", ADMIN)
@patch.object(main, "APPROVER_EMAILS", APPROVERS)
class AccountRequestTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine, tables=[User.__table__, AccountRequest.__table__])
        self.db = sessionmaker(bind=engine, autoflush=False)()

        self.request_mail = patch.object(main, "send_account_request_email", new_callable=AsyncMock, return_value=True).start()
        self.account_mail = patch.object(main, "send_new_account_email", new_callable=AsyncMock, return_value=True).start()
        self.addCleanup(patch.stopall)
        self.addCleanup(self.db.close)

    def apply(self, username="山田 太郎", email="yamada@example.com"):
        return asyncio.run(main.request_account(username=username, email=email, db=self.db))

    def pending_request(self):
        self.apply()
        return self.db.query(AccountRequest).one()

    def approve(self, token):
        return asyncio.run(main.approve_account_request(None, token, self.db))

    def reject(self, token):
        return asyncio.run(main.reject_account_request(None, token, self.db))

    # --- 申請 ---

    def test_request_is_saved_and_approver_is_notified_without_creating_user(self):
        self.apply()

        req = self.db.query(AccountRequest).one()
        self.assertEqual((req.username, req.email, req.status), ("山田太郎", "yamada@example.com", "pending"))
        self.assertEqual(self.db.query(User).count(), 0)
        username, email, review_url = self.request_mail.call_args.args
        self.assertEqual((username, email), ("山田太郎", "yamada@example.com"))
        self.assertTrue(review_url.endswith("/account-requests/" + req.token))

    def test_request_rejected_when_username_or_email_already_registered(self):
        self.db.add(User(username="山田太郎", email="other@example.com", password_hash="x"))
        self.db.commit()

        for username, email in (("山田太郎", "new@example.com"), ("別人", "other@example.com")):
            with self.assertRaises(HTTPException) as ctx:
                self.apply(username, email)
            self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(self.db.query(AccountRequest).count(), 0)
        self.request_mail.assert_not_called()

    def test_duplicate_pending_request_is_not_created_twice(self):
        self.apply()
        self.apply()

        self.assertEqual(self.db.query(AccountRequest).count(), 1)
        self.assertEqual(self.request_mail.call_count, 1)

    def test_invalid_email_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            self.apply(email="not-an-email")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_request_refused_when_no_approver_configured(self):
        with patch.object(main, "APPROVER_EMAILS", []):
            with self.assertRaises(HTTPException) as ctx:
                self.apply()
        self.assertEqual(ctx.exception.status_code, 503)
        self.assertEqual(self.db.query(AccountRequest).count(), 0)

    def test_request_is_cancelled_when_notification_fails(self):
        self.request_mail.return_value = False
        with self.assertRaises(HTTPException) as ctx:
            self.apply()
        self.assertEqual(ctx.exception.status_code, 500)
        self.assertEqual(self.db.query(AccountRequest).count(), 0)

    def test_pending_requests_are_capped(self):
        for i in range(main.MAX_PENDING_ACCOUNT_REQUESTS):
            self.apply(f"申請者{i}", f"user{i}@example.com")
        with self.assertRaises(HTTPException) as ctx:
            self.apply("あふれた人", "overflow@example.com")
        self.assertEqual(ctx.exception.status_code, 503)

    # --- 承認・却下 ---

    def test_approve_creates_readonly_user_and_mails_applicant_with_bcc(self):
        req = self.pending_request()

        self.assertEqual(self.approve(req.token), "approved")

        user = self.db.query(User).one()
        self.assertEqual((user.username, user.email), ("山田太郎", "yamada@example.com"))
        self.assertTrue(user.is_readonly)
        self.assertFalse(user.is_admin)
        to_email, username, password = self.account_mail.call_args.args
        self.assertEqual((to_email, username), ("yamada@example.com", "山田太郎"))
        self.assertTrue(main.verify_password(password, user.password_hash))
        self.assertEqual(self.account_mail.call_args.kwargs["bcc"], APPROVERS + [ADMIN])
        self.assertEqual(req.status, "approved")

    def test_approve_twice_creates_only_one_user(self):
        req = self.pending_request()
        self.approve(req.token)

        self.assertEqual(self.approve(req.token), "approved")
        self.assertEqual(self.db.query(User).count(), 1)
        self.assertEqual(self.account_mail.call_count, 1)

    def test_approve_is_undone_when_mail_fails(self):
        req = self.pending_request()
        self.account_mail.return_value = False

        self.assertEqual(self.approve(req.token), "error")

        self.assertEqual(self.db.query(User).count(), 0)
        self.assertEqual(self.db.query(AccountRequest).one().status, "pending")

    def test_approve_refused_when_user_was_created_meanwhile(self):
        req = self.pending_request()
        self.db.add(User(username="山田太郎", email=None, password_hash="x"))
        self.db.commit()

        self.assertEqual(self.approve(req.token), "error")
        self.assertEqual(self.db.query(User).count(), 1)
        self.account_mail.assert_not_called()

    def test_reject_creates_no_user_and_sends_no_mail(self):
        req = self.pending_request()

        self.assertEqual(self.reject(req.token), "rejected")

        self.assertEqual(self.db.query(User).count(), 0)
        self.account_mail.assert_not_called()
        self.assertEqual(self.approve(req.token), "rejected")  # 却下後は承認できない
        self.assertEqual(self.db.query(User).count(), 0)

    def test_unknown_token_is_invalid(self):
        self.assertEqual(self.approve("no-such-token"), "invalid")
        self.assertEqual(self.reject("no-such-token"), "invalid")


if __name__ == "__main__":
    unittest.main()
