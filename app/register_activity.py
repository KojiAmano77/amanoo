import os
import requests
from datetime import datetime

API_URL = os.getenv("API_URL", "https://sanseitoaichi12.f5.si/api/forms/activity")

payload = {
    "activity_type": os.getenv("ACTIVITY_TYPE", "Python登録テスト2"),
    "date": os.getenv("ACTIVITY_DATE", datetime.utcnow().strftime("%Y-%m-%d")),
    "location": os.getenv("LOCATION", "自動登録テスト2"),
    "memo": os.getenv("MEMO", "Pythonスクリプトからの登録テスト"),
    "gpx_content": os.getenv(
        "GPX_CONTENT",
        '''<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RouteHistory - https://www.ateow.com" xmlns="http://www.topografix.com/GPX/1/1" xmlns:rh="http://www.ateow.com/routehistory">
<trk>
<trkseg>
<trkpt lat="34.9424955" lon="137.178621">
<time>2026-05-01T09:04:45Z</time>
<ele>81.30000305175781</ele>
</trkpt>
<trkpt lat="34.9425508" lon="137.1785549">
<time>2026-05-01T09:04:54Z</time>
<ele>81.0999984741211</ele>
</trkpt>
<trkpt lat="34.9425803" lon="137.1784847">
<time>2026-05-01T09:05:01Z</time>
<ele>81.0999984741211</ele>
</trkpt>
<trkpt lat="34.9426145" lon="137.1784303">
<time>2026-05-01T09:05:04Z</time>
<ele>81.0999984741211</ele>
</trkpt>
<trkpt lat="34.942658" lon="137.1784121">
<time>2026-05-01T09:05:07Z</time>
<ele>81.0999984741211</ele>
</trkpt>
<trkpt lat="34.9427092" lon="137.1784061">
<time>2026-05-01T09:05:12Z</time>
<ele>81.0999984741211</ele>
</trkpt>
<trkpt lat="34.9427604" lon="137.1784104">
<time>2026-05-01T09:05:22Z</time>
<ele>80.9000015258789</ele>
</trkpt>
<trkpt lat="34.9427834" lon="137.1783604">
<time>2026-05-01T09:05:25Z</time>
<ele>81.0999984741211</ele>
</trkpt>
<trkpt lat="34.9428371" lon="137.1783297">
<time>2026-05-01T09:05:43Z</time>
<ele>81.0</ele>
</trkpt>
<trkpt lat="34.942886" lon="137.1783327">
<time>2026-05-01T09:05:49Z</time>
<ele>81.0</ele>
</trkpt>
<trkpt lat="34.9429523" lon="137.1783753">
<time>2026-05-01T09:05:55Z</time>
<ele>80.5999984741211</ele>
</trkpt>
<trkpt lat="34.9428981" lon="137.1783808">
<time>2026-05-01T09:06:52Z</time>
<ele>80.5999984741211</ele>
</trkpt>
<trkpt lat="34.9427969" lon="137.1783837">
<time>2026-05-01T09:07:08Z</time>
<ele>80.5999984741211</ele>
</trkpt>
<trkpt lat="34.9428593" lon="137.1784392">
<time>2026-05-01T09:07:16Z</time>
<ele>80.5999984741211</ele>
</trkpt>
<trkpt lat="34.942909" lon="137.1783626">
<time>2026-05-01T09:07:28Z</time>
<ele>80.5999984741211</ele>
</trkpt>
<trkpt lat="34.9429196" lon="137.1782521">
<time>2026-05-01T09:07:34Z</time>
<ele>80.9000015258789</ele>
</trkpt>
<trkpt lat="34.9429656" lon="137.178302">
<time>2026-05-01T09:07:43Z</time>
<ele>80.4000015258789</ele>
</trkpt>
<trkpt lat="34.94292" lon="137.1782538">
<time>2026-05-01T09:07:58Z</time>
<ele>80.30000305175781</ele>
</trkpt>
<trkpt lat="34.942969" lon="137.1781757">
<time>2026-05-01T09:08:16Z</time>
<ele>80.5</ele>
</trkpt>
<trkpt lat="34.9430089" lon="137.1782274">
<time>2026-05-01T09:08:22Z</time>
<ele>80.5</ele>
</trkpt>
<trkpt lat="34.9430012" lon="137.178132">
<time>2026-05-01T09:08:40Z</time>
<ele>80.9000015258789</ele>
</trkpt>
<trkpt lat="34.9430568" lon="137.1781262">
<time>2026-05-01T09:08:47Z</time>
<ele>80.80000305175781</ele>
</trkpt>
<trkpt lat="34.9430075" lon="137.1781241">
<time>2026-05-01T09:08:58Z</time>
<ele>80.30000305175781</ele>
</trkpt>
<trkpt lat="34.9430371" lon="137.1780133">
<time>2026-05-01T09:09:13Z</time>
<ele>80.19999694824219</ele>
</trkpt>
<trkpt lat="34.9430784" lon="137.177985">
<time>2026-05-01T09:09:16Z</time>
<ele>80.19999694824219</ele>
</trkpt>
<trkpt lat="34.9431306" lon="137.1779755">
<time>2026-05-01T09:09:25Z</time>
<ele>80.80000305175781</ele>
</trkpt>
<trkpt lat="34.9431703" lon="137.1779318">
<time>2026-05-01T09:09:28Z</time>
<ele>80.9000015258789</ele>
</trkpt>
<trkpt lat="34.9432094" lon="137.1778982">
<time>2026-05-01T09:09:31Z</time>
<ele>80.9000015258789</ele>
</trkpt>
<trkpt lat="34.9432751" lon="137.1779206">
<time>2026-05-01T09:09:36Z</time>
<ele>80.9000015258789</ele>
</trkpt>
<trkpt lat="34.9433299" lon="137.1779965">
<time>2026-05-01T09:09:42Z</time>
<ele>80.30000305175781</ele>
</trkpt>
<trkpt lat="34.9433534" lon="137.1780445">
<time>2026-05-01T09:09:45Z</time>
<ele>80.30000305175781</ele>
</trkpt>
<trkpt lat="34.9433748" lon="137.1781009">
<time>2026-05-01T09:09:48Z</time>
<ele>80.80000305175781</ele>
</trkpt>
<trkpt lat="34.9433939" lon="137.1781531">
<time>2026-05-01T09:09:51Z</time>
<ele>80.80000305175781</ele>
</trkpt>
<trkpt lat="34.9434088" lon="137.1782092">
<time>2026-05-01T09:09:57Z</time>
<ele>80.0</ele>
</trkpt>
<trkpt lat="34.9434319" lon="137.1782599">
<time>2026-05-01T09:10:00Z</time>
<ele>80.0</ele>
</trkpt>
<trkpt lat="34.9434543" lon="137.1783092">
<time>2026-05-01T09:10:03Z</time>
<ele>80.0</ele>
</trkpt>
<trkpt lat="34.9434251" lon="137.1783924">
<time>2026-05-01T09:10:09Z</time>
<ele>78.34428942927443</ele>
</trkpt>
</trkseg>
</trk>
</gpx>'''
    ),
}

response = requests.post(API_URL, json=payload, timeout=15)

print("api_url:", API_URL)
print("status_code:", response.status_code)
print("response:", response.text)
