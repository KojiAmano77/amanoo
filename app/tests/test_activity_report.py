"""活動記録マップからの歩行ログ付き活動報告（/api/reports/activity）のテスト

Chatwork・Geoapify には実際に通信しない（偽物に差し替える）。
  docker exec activity_app python -m unittest tests.test_activity_report
"""
import asyncio
import json
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi import HTTPException

APP_DIR = Path(__file__).resolve().parents[1]
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

import chatwork_service
import main
import sheet_service
from activity_report import ActivityReport, build_message, build_memo, build_gpx, clean_segments

T0 = 1764900000000  # ミリ秒
SEGMENTS = [[[137.16, 34.95, T0], [137.161, 34.951, T0 + 60000], [137.162, 34.952, T0 + 120000]]]


def report_dict(**overrides):
    data = {
        "date": "2026-11-22",
        "start_time": "09:00",
        "end_time": "10:30",
        "participants": "山田",
        "total_people": 2,
        "bills": {"ito": 50, "sanseito": "20", "kanda": 0},
        "tewatashi": 5,
        "area": "岡崎市羽根町",
        "school": "羽根小学校区",
        "report_text": "反応良好",
        "room_ids": ["420318628"],
        "segments": SEGMENTS,
    }
    data.update(overrides)
    return data


class FakeUpload:
    def __init__(self, content=b"\xff\xd8jpeg", content_type="image/jpeg"):
        self._content = content
        self.content_type = content_type

    async def read(self):
        return self._content


def user(is_readonly=False, is_admin=False):
    return SimpleNamespace(id=7, username="天野", is_readonly=is_readonly, is_admin=is_admin)


def fake_db():
    db = MagicMock()
    def refresh(obj):
        obj.id = 123
    db.refresh.side_effect = refresh
    return db


class MessageTests(unittest.TestCase):
    def test_message_matches_gas_format(self):
        msg = build_message(ActivityReport(**report_dict()), "天野")
        self.assertIn("🍊ポスティング 活動報告🍊\n投稿者：天野\n参加者：山田（計2人）\n", msg)
        self.assertIn("活動日：2026/11/22(日)\n活動時間：09:00～10:30\n", msg)
        self.assertIn("活動場所：岡崎市羽根町 羽根小学校区\n", msg)
        self.assertIn("活動結果：伊藤議員 市政報告：50枚  参政党ビラ：20枚  合計70枚 （内手渡し：5枚）\n", msg)
        self.assertTrue(msg.endswith("反応良好\n"))

    def test_message_without_counts_or_participants(self):
        msg = build_message(ActivityReport(**report_dict(bills={}, tewatashi=None, participants="")), "天野")
        self.assertNotIn("参加者：", msg)
        self.assertIn("活動結果：（枚数未記入）\n", msg)

    def test_gaisensha_message(self):
        report = ActivityReport(**report_dict(activity_type="街宣車活動", area="岡崎市内", report_text="手を振ってもらえた"))
        msg = build_message(report, "天野")
        self.assertTrue(msg.startswith("🍊街宣車活動 活動報告🍊\n投稿者：天野\n"))
        self.assertIn("活動場所：岡崎市内\n手を振ってもらえた\n", msg)
        self.assertNotIn("活動結果", msg)
        self.assertEqual(build_memo(report), "")

    def test_memo(self):
        self.assertEqual(build_memo(ActivityReport(**report_dict())), "伊藤議員 市政報告：50枚  参政党ビラ：20枚 計70枚")
        self.assertEqual(build_memo(ActivityReport(**report_dict(bills={}))), "")

    def test_clean_segments_drops_bad_points_and_short_segments(self):
        segs = clean_segments([[[137.1, 34.9], [999, 34.9], [137.2, 35.0, T0]], [[137.3, 35.1]]])
        self.assertEqual(segs, [[[137.1, 34.9], [137.2, 35.0, float(T0)]]])

    def test_gpx_is_parsed_back_by_existing_parser(self):
        gpx = build_gpx(SEGMENTS, "テスト <名前>")
        self.assertIn("<time>", gpx)
        parsed = main._extract_gpx_segments(gpx)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0][0], [137.16, 34.95])


class ChatworkServiceTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        patches = [
            patch.object(chatwork_service, "CHATWORK_TOKEN", "token"),
            patch.object(chatwork_service, "CHATWORK_REPORT_ROOM_ID", "420318628"),
            patch.object(chatwork_service, "CHATWORK_GUIDE_FOOTER", ""),
            patch.object(chatwork_service, "_sleep", lambda s: None),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def fake_request(self, statuses):
        it = iter(statuses)
        def _request(url, data, headers):
            self.calls.append((url, data))
            return next(it), b""
        return patch.object(chatwork_service, "_request", _request)

    def test_message_goes_with_first_image_only(self):
        with self.fake_request([200, 200]):
            result = chatwork_service.post_report("本文", [("a.jpg", b"1"), ("b.jpg", b"2")])
        self.assertEqual(result, {"posted": True, "images_posted": 2, "skipped_reason": None})
        self.assertTrue(all("/rooms/420318628/files" in url for url, _ in self.calls))
        self.assertIn("本文".encode(), self.calls[0][1])
        self.assertNotIn("本文".encode(), self.calls[1][1])

    def test_retries_on_rate_limit(self):
        with self.fake_request([429, 200]):
            result = chatwork_service.post_report("本文", [("a.jpg", b"1")])
        self.assertTrue(result["posted"])
        self.assertEqual(len(self.calls), 2)

    def test_text_is_posted_when_all_images_fail(self):
        with self.fake_request([500, 200]):
            result = chatwork_service.post_report("本文", [("a.jpg", b"1")])
        self.assertEqual(result["images_posted"], 0)
        self.assertTrue(result["posted"])
        self.assertIn("/messages", self.calls[-1][0])

    def test_posts_to_each_selected_room_and_ignores_unknown(self):
        with self.fake_request([200, 200]):
            result = chatwork_service.post_report_to_rooms(
                "本文", [("a.jpg", b"1")], ["420318628", "284847688", "999"], is_admin=True)
        self.assertTrue(result["posted"])
        self.assertEqual([r["id"] for r in result["rooms"]], ["284847688", "420318628"])  # 一覧の並び順
        self.assertEqual(sorted(url.split("/")[-2] for url, _ in self.calls), ["284847688", "420318628"])

    def test_no_room_selected(self):
        result = chatwork_service.post_report_to_rooms("本文", [], [])
        self.assertFalse(result["posted"])
        self.assertIsNotNone(result["skipped_reason"])

    def test_guide_footer_only_for_guide_room(self):
        with patch.object(chatwork_service, "CHATWORK_GUIDE_FOOTER", "【案内】"), self.fake_request([200, 200]):
            chatwork_service.post_report_to_rooms("本文", [("a.jpg", b"1")], ["284847688", "446130978"])
        bodies = {url.split("/")[-2]: data for url, data in self.calls}
        self.assertIn("【案内】".encode(), bodies["284847688"])
        self.assertNotIn("【案内】".encode(), bodies["446130978"])

    def test_test_room_is_admin_only(self):
        self.assertNotIn("420318628", [r["id"] for r in chatwork_service.report_rooms(is_admin=False)])
        with self.fake_request([200]):
            result = chatwork_service.post_report_to_rooms("本文", [], ["420318628", "284847688"], is_admin=False)
        self.assertEqual([r["id"] for r in result["rooms"]], ["284847688"])
        self.assertTrue(all("420318628" not in url for url, _ in self.calls))

    def test_default_room_comes_from_env(self):
        rooms = chatwork_service.report_rooms(is_admin=True)
        self.assertEqual([r["id"] for r in rooms if r["default"]], ["420318628"])

    def test_skipped_without_settings(self):
        with patch.object(chatwork_service, "CHATWORK_TOKEN", ""):
            result = chatwork_service.post_report("本文", [])
        self.assertFalse(result["posted"])
        self.assertIsNotNone(result["skipped_reason"])


class SheetServiceTests(unittest.TestCase):
    def test_row_values_use_form_question_titles(self):
        values = sheet_service.build_row_values(ActivityReport(**report_dict()), "天野")
        self.assertEqual(values["活動種類"], "ポスティング")
        self.assertEqual(values["投稿者"], "天野")
        self.assertEqual(values["日付"], "2026/11/22")
        self.assertEqual(values["伊藤議員 市政報告ビラのポスティング枚数"], 50)
        self.assertEqual(values["参政党ビラのポスティング枚数"], 20)
        self.assertEqual(values["神田議員 市政報告ビラのポスティング枚数"], "")  # 0枚は空欄
        self.assertEqual(values["ビラ手渡し枚数"], 5)
        self.assertEqual(values["ポスティングエリア（住所等）"], "岡崎市羽根町")

    def test_gaisensha_row_values(self):
        values = sheet_service.build_row_values(
            ActivityReport(**report_dict(activity_type="街宣車活動", area="岡崎市内")), "天野")
        self.assertEqual(values["活動種類"], "街宣車活動")
        self.assertEqual(values["活動エリア"], "岡崎市内")
        self.assertEqual(values["活動報告（街宣車活動）"], "反応良好")
        self.assertNotIn("ポスティングエリア（住所等）", values)
        self.assertNotIn("参政党ビラのポスティング枚数", values)

    def test_skipped_without_settings(self):
        with patch.object(sheet_service, "SHEET_WEBAPP_URL", ""):
            result = sheet_service.append_report({"活動種類": "ポスティング"})
        self.assertFalse(result["saved"])

    def test_rejected_by_gas(self):
        class Res:
            def __enter__(self): return self
            def __exit__(self, *a): pass
            def read(self): return json.dumps({"ok": False, "error": "認証に失敗しました"}).encode()
        with patch.object(sheet_service, "SHEET_WEBAPP_URL", "https://example.invalid/exec"), \
             patch.object(sheet_service, "SHEET_WEBAPP_SECRET", "s"), \
             patch.object(sheet_service.urllib.request, "urlopen", return_value=Res()):
            result = sheet_service.append_report({})
        self.assertFalse(result["saved"])
        self.assertEqual(result["skipped_reason"], "認証に失敗しました")


class ActivityReportApiTests(unittest.TestCase):
    def setUp(self):
        p = patch.object(sheet_service, "append_report",
                         return_value={"saved": True, "row": 10, "unmatched": [], "skipped_reason": None})
        self.append_report = p.start()
        self.addCleanup(p.stop)

    def call(self, current_user=None, photos=None, **overrides):
        db = fake_db()
        result = asyncio.run(main.create_activity_report(
            report=json.dumps(report_dict(**overrides)),
            photos=photos or [],
            current_user=current_user or user(),
            db=db,
        ))
        return result, db

    def test_saves_activity_and_posts_to_chatwork(self):
        with patch.object(chatwork_service, "generate_track_map_image", return_value=b"map") as gen, \
             patch.object(chatwork_service, "post_report_to_rooms",
                          return_value={"posted": True, "rooms": [], "skipped_reason": None}) as post:
            result, db = self.call(photos=[FakeUpload()])

        activity = db.add.call_args[0][0]
        self.assertEqual(activity.user_id, 7)
        self.assertEqual(activity.activity_type, "ポスティング")
        self.assertEqual(activity.location, "岡崎市羽根町")
        geo = json.loads(activity.polygon_coordinates)
        self.assertEqual(geo["geometry"]["type"], "LineString")
        self.assertEqual(geo["geometry"]["coordinates"][0], [137.16, 34.95])  # 時刻は含めない
        self.assertIn("<trkpt", activity.gpx_content)
        self.assertGreater(activity.distance_km, 0)

        gen.assert_called_once()
        message, images, room_ids, is_admin = post.call_args[0]
        self.assertEqual(room_ids, ["420318628"])
        self.assertIn("投稿者：天野", message)
        self.assertEqual([name for name, _ in images], ["photo1.jpg", "routeMap.jpg"])
        self.assertEqual(result["activity_id"], 123)
        self.assertTrue(result["chatwork"]["posted"])
        self.assertTrue(result["sheet"]["saved"])
        self.assertEqual(self.append_report.call_args[0][0]["投稿者"], "天野")

    def test_sheet_failure_still_saves(self):
        self.append_report.side_effect = RuntimeError("down")
        with patch.object(chatwork_service, "generate_track_map_image", return_value=None), \
             patch.object(chatwork_service, "post_report_to_rooms",
                          return_value={"posted": True, "rooms": [], "skipped_reason": None}):
            result, db = self.call()
        db.commit.assert_called()
        self.assertFalse(result["sheet"]["saved"])

    def test_chatwork_failure_still_saves(self):
        with patch.object(chatwork_service, "generate_track_map_image", return_value=None), \
             patch.object(chatwork_service, "post_report_to_rooms", side_effect=RuntimeError("down")):
            result, db = self.call()
        db.commit.assert_called()
        self.assertFalse(result["chatwork"]["posted"])

    def test_gaisensha_is_saved_with_its_type(self):
        with patch.object(chatwork_service, "generate_track_map_image", return_value=None), \
             patch.object(chatwork_service, "post_report_to_rooms",
                          return_value={"posted": True, "rooms": [], "skipped_reason": None}):
            result, db = self.call(activity_type="街宣車活動")
        self.assertEqual(db.add.call_args[0][0].activity_type, "街宣車活動")
        self.assertEqual(self.append_report.call_args[0][0]["活動種類"], "街宣車活動")

    def test_rejects_other_activity_types(self):
        with self.assertRaises(HTTPException) as ctx:
            self.call(activity_type="辻立ち")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_readonly_user_can_report(self):
        with patch.object(chatwork_service, "generate_track_map_image", return_value=None), \
             patch.object(chatwork_service, "post_report_to_rooms",
                          return_value={"posted": True, "rooms": [], "skipped_reason": None}):
            result, db = self.call(current_user=user(is_readonly=True))
        db.commit.assert_called()
        self.assertEqual(result["activity_id"], 123)

    def test_requires_route_and_area(self):
        for overrides in ({"segments": []}, {"area": "  "}, {"date": "bad"}):
            with self.assertRaises(HTTPException) as ctx:
                self.call(**overrides)
            self.assertEqual(ctx.exception.status_code, 400)

    def test_rejects_non_image_and_too_many_photos(self):
        with self.assertRaises(HTTPException):
            self.call(photos=[FakeUpload(content_type="application/pdf")])
        with self.assertRaises(HTTPException):
            self.call(photos=[FakeUpload()] * 11)


if __name__ == "__main__":
    unittest.main()
