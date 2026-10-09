import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

REPO_ROOT = Path(__file__).resolve().parents[1]
APP_DIR = REPO_ROOT
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

# DBには接続しない（Sessionはモック）。main の import 時にテーブル作成が走るため、
# アプリと同じDB設定のコンテナ内で実行する:
#   docker exec activity_app python -m unittest tests.test_register_user_from_form

import main
from main import FormUserRegisterRequest, register_user_from_form


def fake_db(*first_results):
    """db.query(...).filter(...).first() が呼ばれた順に first_results を返す Session のモック"""
    db = MagicMock()
    db.query.return_value.filter.return_value.first.side_effect = list(first_results)
    return db


def run(db, username, email):
    payload = FormUserRegisterRequest(username=username, email=email)
    return asyncio.run(register_user_from_form(payload, db))


@patch.object(main, "send_new_account_email", new_callable=AsyncMock, return_value=True)
class RegisterUserFromFormTests(unittest.TestCase):
    def test_links_email_to_readonly_account_without_email(self, send_mail):
        user = SimpleNamespace(email=None, is_readonly=True, password_hash="old", updated_at=None)
        db = fake_db(user, None)  # 同名アカウントあり、メールアドレスは未使用

        result = run(db, "斉藤照美", "saito@example.com")

        self.assertTrue(result["email_linked"])
        self.assertTrue(result["email_sent"])
        self.assertEqual(user.email, "saito@example.com")
        self.assertNotEqual(user.password_hash, "old")
        db.commit.assert_called_once()
        to_email, username, password = send_mail.call_args.args
        self.assertEqual((to_email, username), ("saito@example.com", "斉藤照美"))
        self.assertTrue(main.verify_password(password, user.password_hash))

    def test_does_nothing_when_email_used_by_other_account(self, send_mail):
        user = SimpleNamespace(email=None, is_readonly=True, password_hash="old")
        db = fake_db(user, SimpleNamespace(email="taken@example.com"))

        result = run(db, "斉藤照美", "taken@example.com")

        self.assertNotIn("email_linked", result)
        self.assertIsNone(user.email)
        self.assertEqual(user.password_hash, "old")
        db.commit.assert_not_called()
        send_mail.assert_not_called()

    def test_does_nothing_when_account_already_has_email(self, send_mail):
        user = SimpleNamespace(email="old@example.com", is_readonly=True, password_hash="old")
        db = fake_db(user)

        result = run(db, "竹下誠", "new@example.com")

        self.assertNotIn("email_linked", result)
        self.assertEqual(user.email, "old@example.com")
        send_mail.assert_not_called()

    def test_does_nothing_for_normal_account_without_email(self, send_mail):
        user = SimpleNamespace(email=None, is_readonly=False, password_hash="old")
        db = fake_db(user)

        result = run(db, "管理者作成", "someone@example.com")

        self.assertNotIn("email_linked", result)
        self.assertEqual(user.password_hash, "old")
        send_mail.assert_not_called()

    def test_does_nothing_when_form_email_is_blank(self, send_mail):
        user = SimpleNamespace(email=None, is_readonly=True, password_hash="old")
        db = fake_db(user)

        run(db, "斉藤照美", "  ")

        self.assertIsNone(user.email)
        send_mail.assert_not_called()


if __name__ == "__main__":
    unittest.main()
