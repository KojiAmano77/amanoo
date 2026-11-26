import asyncio
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import HTTPException

REPO_ROOT = Path(__file__).resolve().parents[1]
APP_DIR = REPO_ROOT
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

# DBには接続しない（Sessionはモック）。main の import 時にテーブル作成が走るため、
# アプリと同じDB設定のコンテナ内で実行する:
#   docker exec activity_app python -m unittest tests.test_activity_permissions

import main

OWNER_ID = 10


def user(id, is_admin=False, is_readonly=False, is_editor=False):
    return SimpleNamespace(id=id, is_admin=is_admin, is_readonly=is_readonly, is_editor=is_editor)


class ActivityEditPermissionTests(unittest.TestCase):
    def update(self, current_user):
        activity = SimpleNamespace(user_id=OWNER_ID, memo="元のメモ")
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = activity
        asyncio.run(main.update_activity(
            activity_id=1, activity_type="辻立ち", location="岡崎市", date="2026-10-19",
            memo="書き換え", latitude=None, longitude=None, location_name=None,
            polygon_coordinates=None, current_user=current_user, db=db,
        ))
        return activity

    def assert_forbidden(self, current_user):
        with self.assertRaises(HTTPException) as ctx:
            self.update(current_user)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_readonly_user_can_edit_own_record(self):
        # 削除不可（is_readonly）でも自分の記録の編集はできる（削除はできない）
        self.assertEqual(self.update(user(OWNER_ID, is_readonly=True)).memo, "書き換え")

    def test_readonly_user_cannot_edit_others_record(self):
        self.assert_forbidden(user(99, is_readonly=True))

    def test_normal_user_cannot_edit_others_record(self):
        self.assert_forbidden(user(99))

    def test_normal_user_can_edit_own_record(self):
        self.assertEqual(self.update(user(OWNER_ID)).memo, "書き換え")

    def test_admin_can_edit_others_record(self):
        self.assertEqual(self.update(user(99, is_admin=True)).memo, "書き換え")

    def test_editor_can_edit_others_record(self):
        self.assertEqual(self.update(user(99, is_editor=True)).memo, "書き換え")

    def test_readonly_editor_flag_does_not_allow_edit(self):
        # 万一フラグが両方立っていても、削除不可が優先される
        self.assert_forbidden(user(99, is_editor=True, is_readonly=True))


class ActivityDeletePermissionTests(unittest.TestCase):
    def delete(self, current_user):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(user_id=OWNER_ID)
        asyncio.run(main.delete_activity(activity_id=1, current_user=current_user, db=db))
        return db

    def test_editor_can_delete_others_record(self):
        self.delete(user(99, is_editor=True)).delete.assert_called_once()

    def test_readonly_user_cannot_delete_own_record(self):
        with self.assertRaises(HTTPException) as ctx:
            self.delete(user(OWNER_ID, is_readonly=True))
        self.assertEqual(ctx.exception.status_code, 403)

    def test_normal_user_can_delete_own_record(self):
        self.delete(user(OWNER_ID)).delete.assert_called_once()

    def test_normal_user_cannot_delete_others_record(self):
        with self.assertRaises(HTTPException) as ctx:
            self.delete(user(99))
        self.assertEqual(ctx.exception.status_code, 403)


class AdminActivityEditPermissionTests(unittest.TestCase):
    def admin_update(self, current_user):
        activity = SimpleNamespace(id=1, user_id=OWNER_ID, activity_type="", location="", memo="", distance_km=None, date=None)
        target = SimpleNamespace(id=20, username="別の担当者")
        db = MagicMock()
        db.query.return_value.filter.return_value.first.side_effect = [activity, target]
        body = main.AdminActivityEditRequest(username="別の担当者", date="2026-10-19", activity_type="辻立ち",
                                             location="岡崎市", memo="直した", distance_km=1.5)
        asyncio.run(main.admin_update_activity(activity_id=1, body=body, current_user=current_user, db=db))
        return activity

    def test_editor_can_reassign_and_edit(self):
        activity = self.admin_update(user(99, is_editor=True))
        self.assertEqual((activity.user_id, activity.memo), (20, "直した"))

    def test_normal_user_cannot_use_admin_edit(self):
        with self.assertRaises(HTTPException) as ctx:
            self.admin_update(user(99))
        self.assertEqual(ctx.exception.status_code, 403)


class PermissionCombinationTests(unittest.TestCase):
    def normalized(self, **flags):
        u = SimpleNamespace(is_admin=False, is_readonly=False, is_editor=False, **{})
        for k, v in flags.items():
            setattr(u, k, v)
        main._normalize_permissions(u)
        return (u.is_admin, u.is_editor, u.is_readonly)

    def test_admin_drops_editor_and_readonly(self):
        self.assertEqual(self.normalized(is_admin=True, is_editor=True, is_readonly=True), (True, False, False))

    def test_editor_drops_readonly(self):
        self.assertEqual(self.normalized(is_editor=True, is_readonly=True), (False, True, False))

    def test_toggle_editor_refused_for_admin_and_only_by_admin(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(id=5, is_admin=True, is_editor=False, is_readonly=False)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(main.toggle_editor_user(user_id=5, current_user=user(1, is_admin=True), db=db))
        self.assertEqual(ctx.exception.status_code, 400)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(main.toggle_editor_user(user_id=5, current_user=user(1, is_editor=True), db=db))
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
