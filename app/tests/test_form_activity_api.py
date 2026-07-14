import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

REPO_ROOT = Path(__file__).resolve().parents[1]
APP_DIR = REPO_ROOT
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///" + str(REPO_ROOT / "test_activity_api.db"))

from database import Base, SessionLocal, create_tables, Activity
from main import create_activity_from_form_api


class FakeUploadFile:
    def __init__(self, filename, content):
        self.filename = filename
        self._content = content

    async def read(self):
        return self._content.encode("utf-8")


class FakeRequest:
    def __init__(self, payload):
        self._payload = payload
        self.headers = {"content-type": "application/x-www-form-urlencoded"}

    async def form(self):
        return self._payload

    async def json(self):
        return self._payload


class FormActivityApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        create_tables()

    def setUp(self):
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_create_activity_from_form_api_stores_gpx_content(self):
        payload = {
            "activity_type": "ポスティング",
            "date": "2026-06-28",
            "場所": "名古屋",
            "メモ": "Googleフォームから登録",
            "gpx_file": FakeUploadFile("route.gpx", "<gpx><trk><trkseg><trkpt lat='35.0' lon='136.0'/></trkseg></trk></gpx>"),
        }
        request = FakeRequest(payload)

        result = asyncio.run(create_activity_from_form_api(request, self.db))

        self.assertEqual(result["message"], "活動記録を登録しました")
        self.assertTrue(result["gpx_saved"])

        saved_activity = self.db.query(Activity).filter(Activity.memo == "Googleフォームから登録").first()
        self.assertIsNotNone(saved_activity)
        self.assertIn("<gpx", saved_activity.gpx_content)


if __name__ == "__main__":
    unittest.main()
