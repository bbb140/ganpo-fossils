#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把 data/fossil_images.json 的图片清单合并进 data/species.json。

规则（重要）：
  · 只增不改：仅写 image / images / image_credit 三个字段，
    正文（features/reference/classification 等）一律不动；
  · 数据口径已定（B 岗 2026-11-25 确认）：文字一律以本仓库原数据为准。
    B 岗 JSON 里附带的文字修订（「赣州江西龙」分类写成鸟臀目、
    「丁氏阶齿兽」年代写成池江组）与原文冲突，永久不采用；
    本脚本因此永远只碰图片字段，任何情况下都不得写入正文；
  · 已有 image 的条目会被最新清单覆盖（重复执行幂等）。

用法：python tools/merge_species_images.py
"""
import io
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPECIES = os.path.join(BASE, "data", "species.json")
MANIFEST = os.path.join(BASE, "data", "fossil_images.json")


def main():
    with io.open(SPECIES, encoding="utf-8") as f:
        species = json.load(f)
    with io.open(MANIFEST, encoding="utf-8") as f:
        manifest = json.load(f)

    added = updated = 0
    for sp in species:
        cn = sp.get("cn_name") or ""
        m = manifest.get(cn)
        if not m:
            continue
        imgs = m.get("images") or []
        if not imgs:
            continue
        if sp.get("image") == imgs[0] and sp.get("images") == imgs:
            continue
        if sp.get("image"):
            updated += 1
        else:
            added += 1
        sp["image"] = imgs[0]
        sp["images"] = imgs
        sp["image_credit"] = m.get("credit") or "《江西省古生物化石图册》"

    with io.open(SPECIES, "w", encoding="utf-8") as f:
        json.dump(species, f, ensure_ascii=False, indent=2)
        f.write("\n")

    total_imgs = sum(len(sp.get("images") or []) for sp in species)
    print("已合并图片字段：新增 %d 条，更新 %d 条" % (added, updated))
    print("  有图物种 %d / %d，图片总数 %d" % (
        sum(1 for sp in species if sp.get("images")), len(species), total_imgs))
    print("  未改任何文字字段（文字以原数据为准，B 岗修订不采用）")


if __name__ == "__main__":
    main()
