"""いまどこ町名のホーム画面アイコン（道標）を標準ライブラリだけで描いてPNG出力する。
使い方: python3 app/make_where_icon.py app/frontend/icons
座標は 512x512 基準。Androidのマスク（円・角丸）でも欠けないよう、絵は中央約70%に収める。"""
import struct
import sys
import zlib

BG = (17, 24, 39)        # #111827 ページの背景色
YELLOW = (250, 204, 21)  # #facc15 町名の文字色
WHITE = (249, 250, 251)
POLE = (209, 213, 219)
DARK = BG


def rect(x0, y0, x1, y1):
    return lambda x, y: x0 <= x <= x1 and y0 <= y <= y1


def rrect(x0, y0, x1, y1, r):
    def f(x, y):
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        cx = min(max(x, x0 + r), x1 - r)
        cy = min(max(y, y0 + r), y1 - r)
        return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
    return f


def convex(pts):
    n = len(pts)

    def f(x, y):
        sign = 0
        for i in range(n):
            ax, ay = pts[i]
            bx, by = pts[(i + 1) % n]
            c = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
            if c != 0:
                s = 1 if c > 0 else -1
                if sign == 0:
                    sign = s
                elif s != sign:
                    return False
        return True
    return f


# 描画順（後ろほど手前）
SHAPES = [
    (POLE, rrect(238, 118, 274, 418, 10)),          # 柱
    (POLE, rrect(196, 404, 316, 430, 12)),          # 台座
    # 右向きの看板（黄）
    (YELLOW, convex([(132, 146), (338, 146), (386, 186), (338, 226), (132, 226)])),
    (DARK, rrect(160, 176, 312, 196, 10)),          # 看板の文字に見立てた線
    # 左向きの看板（白）
    (WHITE, convex([(174, 262), (380, 262), (380, 342), (174, 342), (126, 302)])),
    (DARK, rrect(200, 292, 352, 312, 10)),
]


def render(size, ss=4):
    scale = 512 / size
    rows = []
    n = ss * ss
    for py in range(size):
        row = bytearray([0])  # filter: none
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                y = (py + (sy + 0.5) / ss) * scale
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) * scale
                    col = BG
                    for c, f in SHAPES:
                        if f(x, y):
                            col = c
                    acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]
            row += bytes(round(v / n) for v in acc)
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size):
    raw = render(size)

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(path, size)


if __name__ == "__main__":
    out = sys.argv[1]
    for s in (180, 192, 512):
        write_png(f"{out}/where-{s}.png", s)
