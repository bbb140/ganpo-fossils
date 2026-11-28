#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""为首页生成「无图册文字」的化石照片副本。

首页 Hero 图带与四张分区卡取用的是 data/species.json 里前几张有图物种的
首图，这些原图右下/底部印着「a：横切面，×2」这类图册标注。这里按每张图
实测的文字位置裁掉底部标注条，输出到 assets/fossils/home/，首页脚本会
优先取干净副本；图鉴、名录等页面仍用原图。

用法：
    python tools/make_home_photos.py          # 生成干净副本
    python tools/make_home_photos.py --sheet   # 顺便输出核对用联系表到临时目录
"""

import json
import os
import sys
import tempfile

from PIL import Image, ImageDraw

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "assets", "fossils")
DST = os.path.join(BASE, "assets", "fossils", "home")

# 每张图保留的上半部分比例（按原图实测：文字条起点 / 图高）。
# 数值来自逐张查看原图，保证化石主体完整、文字被裁掉。
KEEP = {
    "010_1": 0.76,
    "011_1": 0.83,
    "015_1": 0.78,
    "022_1": 0.81,
    "026_1": 0.82,
    "027_1": 0.86,
    "046_1": 0.76,
}


def main():
    os.makedirs(DST, exist_ok=True)
    made = []
    for stem, frac in KEEP.items():
        src = os.path.join(SRC, stem + ".webp")
        if not os.path.exists(src):
            print("跳过（缺原图）:", stem)
            continue
        im = Image.open(src).convert("RGB")
        h = round(im.height * frac)
        crop = im.crop((0, 0, im.width, h))
        out = os.path.join(DST, stem + ".webp")
        crop.save(out, "WEBP", quality=88, method=6)
        made.append((stem, im.size, crop.size))
        print("生成 %s %s -> %s" % (stem, im.size, crop.size))

    print("共 %d 张干净副本 -> %s" % (len(made), DST))

    if "--sheet" in sys.argv:
        w, h = 240, 190
        cols = 4
        rows = (len(made) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * w, rows * (h + 22)), "white")
        d = ImageDraw.Draw(sheet)
        for i, (stem, _, _) in enumerate(made):
            im = Image.open(os.path.join(DST, stem + ".webp")).convert("RGB")
            im.thumbnail((w - 10, h - 10))
            x = (i % cols) * w + (w - im.width) // 2
            y = (i // cols) * (h + 22) + (h - im.height) // 2
            sheet.paste(im, (x, y))
            d.text(((i % cols) * w + 5, (i // cols) * (h + 22) + h + 3), stem, fill="black")
        out = os.path.join(tempfile.gettempdir(), "gbsy_home_photos_sheet.jpg")
        sheet.save(out, quality=90)
        print("联系表:", out)


if __name__ == "__main__":
    main()
