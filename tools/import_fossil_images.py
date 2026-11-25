#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 B 岗提交的化石照片整理进站点资源目录。

输入（默认）：
  C:/Users/lenovo/Desktop/species_with_images.json   物种 + 封面图文件名
  C:/Users/lenovo/Desktop/赣鄱石语--化石录入/<编号_中文名>/*.jpg|png

输出：
  assets/fossils/<编号>_<序号>.webp    统一 WebP、最长边 <= 1100px
  data/fossil_images.json              物种 → 图片列表清单（供前端/校验用）

原则：
  1) 同一目录下的多张图视为同一物种的不同角度/切面，全部保留，JSON 里指定的封面排第一；
  2) 文件名一律 ASCII（编号_序号），避免中文/空格/特殊符号在 URL 与 zip 里出问题；
  3) 透明底 PNG 压成白底，防止在深色卡片上出现黑块；
  4) 只处理图片，不改 species.json 的文字字段（文字修订另行人工确认）。

用法：
  python tools/import_fossil_images.py
  python tools/import_fossil_images.py --src-json ... --src-dir ...
"""
import argparse
import io
import json
import os
import re
import sys

from PIL import Image, ImageOps

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "assets", "fossils")
MANIFEST = os.path.join(BASE, "data", "fossil_images.json")

DEFAULT_JSON = r"C:/Users/lenovo/Desktop/species_with_images.json"
DEFAULT_DIR = r"C:/Users/lenovo/Desktop/赣鄱石语--化石录入"

MAX_SIDE = 1100          # 最长边，够详情弹窗 2x 显示
QUALITY = 82             # WebP 质量，标本纹理够用
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")


def norm(s):
    """去掉中英文括号与问号，用于目录名/物种名宽松匹配。"""
    return re.sub(r"[（）()？?\s]", "", str(s or "")).strip()


def load_json(path):
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def to_white_bg(im):
    """透明底合成到白底；统一 RGB。"""
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert("RGB")


def resize(im, max_side):
    w, h = im.size
    if max(w, h) <= max_side:
        return im
    scale = max_side / float(max(w, h))
    return im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src-json", default=DEFAULT_JSON)
    ap.add_argument("--src-dir", default=DEFAULT_DIR)
    ap.add_argument("--max-side", type=int, default=MAX_SIDE)
    args = ap.parse_args()

    max_side = args.max_side

    if not os.path.isfile(args.src_json):
        sys.exit("找不到物种 JSON：%s" % args.src_json)
    if not os.path.isdir(args.src_dir):
        sys.exit("找不到图片目录：%s" % args.src_dir)

    species = load_json(args.src_json)
    os.makedirs(OUT_DIR, exist_ok=True)

    # 目录索引：规范化中文名 → (编号, 目录路径)
    dir_map = {}
    for d in os.listdir(args.src_dir):
        p = os.path.join(args.src_dir, d)
        if not os.path.isdir(p):
            continue
        num, _, name = d.partition("_")
        if not num.isdigit():
            continue
        dir_map[norm(name)] = (num, p)

    manifest = {}
    used_cover = set()
    total_in = total_out = 0
    missing_dir, missing_cover, no_image = [], [], []

    for sp in species:
        cn = sp.get("cn_name") or sp.get("中文名") or ""
        cover = str(sp.get("image") or "").strip()
        if not cn:
            continue
        hit = dir_map.get(norm(cn))
        if not hit:
            if cover and cover not in ("无", "无图片"):
                missing_dir.append(cn)
            else:
                no_image.append(cn)
            continue

        num, folder = hit
        files = sorted(f for f in os.listdir(folder) if f.lower().endswith(IMG_EXT))
        if not files:
            no_image.append(cn)
            continue

        # 封面排第一，其余按文件名顺序作为补充角度
        if cover in files:
            files.remove(cover)
            files.insert(0, cover)
            used_cover.add(cover)
        elif cover and cover not in ("无", "无图片"):
            missing_cover.append("%s → %s" % (cn, cover))

        out_list = []
        for i, fn in enumerate(files, 1):
            src = os.path.join(folder, fn)
            out_name = "%s_%d.webp" % (num, i)
            out_path = os.path.join(OUT_DIR, out_name)
            try:
                with Image.open(src) as im:
                    im = ImageOps.exif_transpose(im)   # 手机竖拍方向
                    im = resize(to_white_bg(im), max_side)
                    im.save(out_path, "WEBP", quality=QUALITY, method=6)
            except Exception as e:
                print("  ! 跳过（读图失败）%s/%s：%s" % (num, fn, e), file=sys.stderr)
                continue
            total_in += os.path.getsize(src)
            total_out += os.path.getsize(out_path)
            out_list.append("assets/fossils/" + out_name)

        if out_list:
            manifest[cn] = {
                "code": num,
                "images": out_list,
                "cover": out_list[0],
                "credit": "《江西省古生物化石图册》",
                "source_name": cover,
            }

    with io.open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print("已输出图片 → %s" % os.path.relpath(OUT_DIR, BASE))
    print("  物种 %d 条有图 / 共 %d 张" % (len(manifest),
          sum(len(v["images"]) for v in manifest.values())))
    print("  体积 %.1f MB → %.1f MB" % (total_in / 1048576.0, total_out / 1048576.0))
    print("  清单 → %s" % os.path.relpath(MANIFEST, BASE))
    if missing_dir:
        print("  ⚠ 有封面但找不到目录：" + "、".join(missing_dir), file=sys.stderr)
    if missing_cover:
        print("  ⚠ 封面文件名不在目录内：" + "；".join(missing_cover), file=sys.stderr)
    if no_image:
        print("  · 无图（保持占位）:" + "、".join(no_image))


if __name__ == "__main__":
    main()
