#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把正式数据 sites.json / species.json 同步到图鉴探索原型的数据文件。

以后 A/B 岗补了化石，只需两步：
    python tools/build_atlas_data.py      # 重新生成 atlas-demo-data.js
然后刷新图鉴页 atlas.html 即可。题库、门槛、图鉴本、徽章全部自动跟随新数据，
无需改任何 JS；本地那份不上线的演示版（atlas-demo.html）如需同步，再跑一次 python tools/make_demo_page.py。
"""
import io
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES = os.path.join(BASE, "data", "sites.json")
SPECIES = os.path.join(BASE, "data", "species.json")
OUT = os.path.join(BASE, "atlas-demo-data.js")

# 原型只需要这些字段，避免把整份数据塞进页面
SITE_KEYS = ["id", "name", "region", "city_county",
             "geological_age", "fossil_group", "protection_level"]


def main():
    with io.open(SITES, encoding="utf-8") as f:
        sites = json.load(f)
    with io.open(SPECIES, encoding="utf-8") as f:
        species = json.load(f)

    slim = [{k: r.get(k, "") for k in SITE_KEYS} for r in sites]
    ids = set(r["id"] for r in sites)

    linked = sum(1 for f in species if f.get("tapho_link"))
    no_link = [f.get("cn_name", "") for f in species if not f.get("tapho_link")]
    bad = [f.get("cn_name", "") for f in species
           if f.get("tapho_link") and f["tapho_link"] not in ids]

    js = ("/* 由 tools/build_atlas_data.py 自动生成，请勿手改。 */\n"
          "window.ATLAS_SITES=" + json.dumps(slim, ensure_ascii=False) + ";\n"
          "window.ATLAS_SPECIES=" + json.dumps(species, ensure_ascii=False) + ";\n")
    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write(js)

    print("已生成 %s" % os.path.relpath(OUT, BASE))
    print("  产地 %d 条 / 图鉴 %d 条（有编号 %d，可探索）" % (len(slim), len(species), linked))
    if no_link:
        print("  无产地编号（图鉴本标为文献、不可探索）：" + "、".join(no_link))
    if bad:
        print("  ⚠ 编号在 sites.json 中不存在：" + "、".join(bad), file=sys.stderr)
    print("完成。刷新 atlas-demo.html 即可看到新数据。")


if __name__ == "__main__":
    main()
