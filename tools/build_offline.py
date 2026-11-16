# -*- coding: utf-8 -*-
"""
导出 sites.json 为 CSV（给「数据下载」页用），并生成离线自包含版 dist/。

用法：
  python tools/build_offline.py          # 只导出 CSV
  python tools/build_offline.py --dist   # 导出 CSV + 生成 dist/ 并打 zip
"""
import csv
import hashlib
import io
import json
import os
import re
import shutil
import sys
import zipfile
import glob

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES = os.path.join(BASE, "data", "sites.json")
SITES_CSV = os.path.join(BASE, "data", "sites.csv")
DIST = os.path.join(BASE, "dist")
ZIP = os.path.join(BASE, "赣鄱石语_离线演示版.zip")

COPY_DIRS = ["css", "js", "assets", "img", "data"]
COPY_FILES = ["index.html", "map.html", "list.html", "download.html"]

# 演示包里绝不能出现的东西：内部工作稿（含"待确认/未定/待岗签字"列）+ 备份文件
# 发给老师/评委的包里出现"待确认 6 条"这种表，只会被理解成数据不严谨
EXCLUDE_NAMES = {"分区小区归并表.csv", "回填表.csv", "species.json"}
EXCLUDE_PAT = (".bak", ".backup", "~", ".next.")


def _skip(name):
    return name in EXCLUDE_NAMES or any(p in name for p in EXCLUDE_PAT)


def export_csv():
    with io.open(SITES, encoding="utf-8") as f:
        recs = json.load(f)
    cols = list(recs[0].keys())
    with io.open(SITES_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(recs)
    print("已导出 %s（%d 条 × %d 列）" % (SITES_CSV, len(recs), len(cols)))
    return len(recs)


def make_inline():
    with io.open(SITES, encoding="utf-8") as f:
        recs = json.load(f)
    js = ("/* 由 tools/build_offline.py 自动生成，请勿手改。\n"
          "   file:// 下浏览器禁止 fetch 本地 json，故把数据内联进来，双击即可看地图。 */\n"
          "window.SITES_DATA = " +
          json.dumps(recs, ensure_ascii=False, indent=0) + ";\n")
    return js


def content_version():
    """资源版本号 = 自有 css/js + sites.json 的内容哈希前 8 位。

    为什么不用时间戳：内容没变时版本号也不变，浏览器缓存继续有效（加载更快）；
    内容一变版本号立刻变，缓存自动失效（用户永远看到最新版）。
    sites.json 必须算进来——只改数据不改代码时，data-inline.js 的内容变了，
    但代码哈希没变，漏掉它就会出现"数据更新了页面还是旧的"。
    """
    h = hashlib.md5()
    paths = []
    for d in ("css", "js"):
        src = os.path.join(BASE, d)
        if os.path.isdir(src):
            for fn in sorted(os.listdir(src)):
                if fn.endswith((".css", ".js")) and not _skip(fn):
                    paths.append(os.path.join(src, fn))
    paths.append(SITES)
    for p in sorted(paths):
        with io.open(p, "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:8]


# 只匹配本站自有资源（css/、js/），外链与 assets/leaflet 的固定版本库不动
RE_ASSET = re.compile(r'(href|src)="((?:css|js)/[^"?#]+)(?:\?v=[^"]*)?"')


def stamp_assets(ver):
    """给 dist 里每条 css/js 引用追加 ?v=<hash>，重复构建不会叠加。"""
    total = 0
    for page in COPY_FILES:
        fp = os.path.join(DIST, page)
        if not os.path.isfile(fp):
            continue
        html = io.open(fp, encoding="utf-8").read()
        new, k = RE_ASSET.subn(
            lambda m: '%s="%s?v=%s"' % (m.group(1), m.group(2), ver), html)
        if k and new != html:
            io.open(fp, "w", encoding="utf-8").write(new)
            print("已给 dist/%s 的 %d 个资源加版本号 v=%s" % (page, k, ver))
        total += k
    return total


def build():
    # 不做整目录删除（容易误删/触发批量删除保护），只原地覆盖 + 清掉不该出现的残留
    if not os.path.isdir(DIST):
        os.makedirs(DIST)
    for junk in glob.glob(os.path.join(DIST, "**", "*"), recursive=True):
        base = os.path.basename(junk)
        empty = os.path.isfile(junk) and os.path.getsize(junk) == 0
        if os.path.isfile(junk) and (_skip(base) or empty):
            os.remove(junk)
            print("已从 dist 移除内部文件：" + os.path.relpath(junk, DIST))

    for d in COPY_DIRS:
        src = os.path.join(BASE, d)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(DIST, d), dirs_exist_ok=True,
                            ignore=lambda d, names: [n for n in names if _skip(n)
                                                     or (os.path.isfile(os.path.join(d, n))
                                                         and os.path.getsize(os.path.join(d, n)) == 0)])
    for f in COPY_FILES:
        shutil.copy2(os.path.join(BASE, f), os.path.join(DIST, f))

    # 内联数据
    with io.open(os.path.join(DIST, "js", "data-inline.js"), "w", encoding="utf-8") as f:
        f.write(make_inline())

    # 在 map.js / main.js 之前插入数据脚本；已有就跳过
    for page, anchor in (("map.html", '<script src="js/map.js"></script>'),
                         ("index.html", '<script src="js/main.js"></script>'),
                         ("list.html", '<script src="js/list.js"></script>')):
        fp = os.path.join(DIST, page)
        if not os.path.isfile(fp):
            continue
        html = io.open(fp, encoding="utf-8").read()
        if "js/data-inline.js" in html or anchor not in html:
            continue
        html = html.replace(anchor, '<script src="js/data-inline.js"></script>\n' + anchor)
        io.open(fp, "w", encoding="utf-8").write(html)
        print("已给 dist/%s 注入内联数据脚本" % page)

    # 资源版本号：部署后无需教用户硬刷新，内容一变缓存自动失效
    ver = content_version()
    print("版本号 v=%s（由 css/js + sites.json 内容哈希得出）" % ver)
    stamp_assets(ver)

    # GitHub Pages：跳过 Jekyll 处理，静态文件原样发布（顺带省掉构建时间）
    io.open(os.path.join(DIST, ".nojekyll"), "w").write("")

    # 打 zip
    if os.path.exists(ZIP):
        os.remove(ZIP)
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(DIST):
            for fn in files:
                p = os.path.join(root, fn)
                z.write(p, os.path.relpath(p, DIST))
    size = os.path.getsize(ZIP) / 1024.0
    print("已生成 %s（%.0f KB）" % (ZIP, size))
    print("目录：%s" % DIST)


if __name__ == "__main__":
    export_csv()
    if "--dist" in sys.argv:
        build()
