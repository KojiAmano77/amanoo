"""日本郵便の郵便番号データ（utf_ken_all.zip）から、いまどこ町名（where.html）用の
町名ふりがなファイルを都道府県ごとに作る。

使い方:
    python3 app/build_town_kana.py utf_ken_all.zip

入手先: https://www.post.japanpost.jp/zipcode/dl/utf-zip.html
        「住所の郵便番号（1レコード1行、UTF-8形式）」の全国一括 utf_ken_all.zip
出力:   app/frontend/kana/NN.json （NN = 都道府県コード2桁）
        { "23202": { "c": "おかざきし", "t": { "両町": "りょうまち", ... } }, ... }
"""
import csv
import io
import json
import os
import re
import sys
import zipfile

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "kana")

# 町名として使わない行
SKIP_TOWNS = {"以下に掲載がない場合"}
SKIP_SUFFIX = ("の次に番地がくる場合",)


def kata_to_hira(s: str) -> str:
    return "".join(chr(ord(c) - 0x60) if "ァ" <= c <= "ヶ" else c for c in s)


def clean(name: str) -> str:
    # 「大通西（１〜１９丁目）」→「大通西」、「〇〇町一円」→「〇〇町」
    name = re.sub(r"（.*", "", name)
    name = re.sub(r"一円$", "", name)
    return name.strip()


COUNTY_RE = re.compile(r"^.+?郡(.+[町村])$")


def city_reading(city: str, city_kana: str) -> str:
    """「知多郡武豊町」「チタグンタケトヨチョウ」→「タケトヨチョウ」。
    郡名の読みは最後の「グン」までとみなす（北群馬郡＝キタグンマグン にも対応）。
    小郡市・郡山市など、市名に「郡」を含むだけのものは対象外。"""
    if not COUNTY_RE.match(city):
        return city_kana
    i = city_kana.rfind("グン")
    return city_kana[i + 2:] if i >= 0 else ""


def main(zip_path: str) -> None:
    with zipfile.ZipFile(zip_path) as zf:
        csv_name = next(n for n in zf.namelist() if n.lower().endswith(".csv"))
        text = zf.read(csv_name).decode("utf-8-sig")

    prefs: dict[str, dict] = {}
    for row in csv.reader(io.StringIO(text)):
        code, city_kana, town_kana, city, town = row[0], row[4], row[5], row[7], row[8]
        if town in SKIP_TOWNS or town.endswith(SKIP_SUFFIX):
            town = ""
        code = code.zfill(5)
        entry = prefs.setdefault(code[:2], {}).setdefault(code, {"c": "", "t": {}})
        if not entry["c"]:
            entry["c"] = kata_to_hira(city_reading(city, city_kana))
        t, tk = clean(town), clean(town_kana)
        if t and tk and t not in entry["t"]:
            entry["t"][t] = kata_to_hira(tk)

    os.makedirs(OUT_DIR, exist_ok=True)
    total = 0
    for pref, data in sorted(prefs.items()):
        path = os.path.join(OUT_DIR, f"{pref}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        total += sum(len(v["t"]) for v in data.values())
    print(f"{len(prefs)} 都道府県 / {total} 町名 → {OUT_DIR}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
