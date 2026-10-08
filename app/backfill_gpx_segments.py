"""複数GPXを連結した既存の活動記録を、セグメントごとに線が分かれた形に作り直す（1回だけ実行）。

以前は連結GPXを1本のLineStringとして保存していたため、ファイル間が直線で結ばれていた。
保存済みの元GPX(gpx_content)から polygon_coordinates と distance_km を再計算する。

使い方（コンテナ内で実行）:
    docker exec activity_app python backfill_gpx_segments.py           # 対象の確認のみ（更新しない）
    docker exec activity_app python backfill_gpx_segments.py --apply   # 実際に更新する
"""
import json
import sys

from database import Activity, SessionLocal
from main import _build_track_geojson, _extract_gpx_segments, _geometry_distance_km


def main(apply: bool) -> None:
    db = SessionLocal()
    try:
        activities = db.query(Activity).filter(
            Activity.gpx_content.isnot(None),
            Activity.polygon_coordinates.isnot(None),
        ).all()

        targets = 0
        for activity in activities:
            try:
                geo = json.loads(activity.polygon_coordinates)
            except ValueError:
                continue
            # 元GPXから作られた1本線の記録だけが対象（手描きポリゴン等には触れない）
            if geo.get("geometry", geo).get("type") != "LineString":
                continue

            segments = _extract_gpx_segments(activity.gpx_content)
            if not segments or len(segments) < 2:
                continue

            track_geojson = _build_track_geojson(segments)
            new_distance = _geometry_distance_km(track_geojson["geometry"])
            targets += 1
            print(f"id={activity.id} {activity.date:%Y-%m-%d} {activity.location}: "
                  f"{len(segments)}セグメント, 距離 {activity.distance_km} → {new_distance} km")

            if apply:
                activity.polygon_coordinates = json.dumps(track_geojson)
                activity.distance_km = new_distance

        if apply:
            db.commit()
            print(f"{targets}件を更新しました")
        else:
            print(f"対象 {targets}件（確認のみ。更新するには --apply を付けて実行）")
    finally:
        db.close()


if __name__ == "__main__":
    main("--apply" in sys.argv[1:])
