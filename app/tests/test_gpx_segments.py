import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
APP_DIR = REPO_ROOT
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

# DBには読み書きしない（純粋関数のテスト）。main の import 時にテーブル作成が走り、
# SQLite では MEDIUMTEXT を扱えないため、アプリと同じDB設定のコンテナ内で実行する:
#   docker exec activity_app python -m unittest tests.test_gpx_segments

from main import (
    _build_track_geojson,
    _calculate_distance_km,
    _extract_gpx_segments,
    _geometry_distance_km,
)

SEG_A = "<trkseg><trkpt lat='35.00' lon='137.00'/><trkpt lat='35.01' lon='137.00'/></trkseg>"
SEG_B = "<trkseg><trkpt lat='35.50' lon='137.50'/><trkpt lat='35.50' lon='137.51'/></trkseg>"
NS = "xmlns='http://www.topografix.com/GPX/1/1'"


class GpxSegmentTests(unittest.TestCase):
    def test_multiple_segments_become_multilinestring(self):
        segments = _extract_gpx_segments(f"<gpx {NS}><trk>{SEG_A}{SEG_B}</trk></gpx>")
        self.assertEqual(len(segments), 2)

        geometry = _build_track_geojson(segments)["geometry"]
        self.assertEqual(geometry["type"], "MultiLineString")
        self.assertEqual(geometry["coordinates"][0][0], [137.0, 35.0])

        # 距離は各セグメントの合計で、セグメント間の直線は含めない
        expected = round(sum(_calculate_distance_km(s) for s in segments), 2)
        self.assertEqual(_geometry_distance_km(geometry), expected)
        joined = _calculate_distance_km(segments[0] + segments[1])
        self.assertLess(_geometry_distance_km(geometry), joined)

    def test_single_segment_stays_linestring(self):
        segments = _extract_gpx_segments(f"<gpx {NS}><trk>{SEG_A}</trk></gpx>")
        geometry = _build_track_geojson(segments)["geometry"]
        self.assertEqual(geometry["type"], "LineString")
        self.assertEqual(len(geometry["coordinates"]), 2)

    def test_trkpt_without_trkseg_is_one_segment(self):
        gpx = "<gpx><trk><trkpt lat='35.0' lon='137.0'/><trkpt lat='35.1' lon='137.0'/></trk></gpx>"
        self.assertEqual(len(_extract_gpx_segments(gpx)), 1)

    def test_segments_with_less_than_two_points_are_dropped(self):
        short = "<trkseg><trkpt lat='36.0' lon='138.0'/></trkseg>"
        segments = _extract_gpx_segments(f"<gpx><trk>{SEG_A}{short}{SEG_B}</trk></gpx>")
        self.assertEqual(len(segments), 2)

    def test_single_point_gpx_still_returns_points(self):
        gpx = "<gpx><trk><trkseg><trkpt lat='35.0' lon='136.0'/></trkseg></trk></gpx>"
        self.assertEqual(_extract_gpx_segments(gpx), [[[136.0, 35.0]]])

    def test_invalid_xml_returns_none(self):
        self.assertIsNone(_extract_gpx_segments("not xml"))


if __name__ == "__main__":
    unittest.main()
