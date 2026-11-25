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
SPECIES = os.path.join(BASE, "data", "species.json")
SITES_CSV = os.path.join(BASE, "data", "sites.csv")
DIST = os.path.join(BASE, "dist")
ZIP = os.path.join(BASE, "赣鄱石语_离线演示版.zip")

COPY_DIRS = ["css", "js", "assets", "img", "data"]
# 图鉴探索页的四个根目录依赖（atlas.html 用相对路径直接引，不在 js/ 子目录）
ATLAS_JS = ["atlas-demo-data.js", "atlas-logic.js", "atlas-quiz.js", "atlas-mystery.js"]
COPY_FILES = ["index.html", "map.html", "list.html", "download.html", "atlas.html"] + ATLAS_JS

# 演示包里绝不能出现的东西：内部工作稿（含"待确认/未定/待岗签字"列）+ 备份文件
# 发给老师/评委的包里出现"待确认 6 条"这种表，只会被理解成数据不严谨
EXCLUDE_NAMES = {"分区小区归并表.csv", "回填表.csv", "species.json"}
EXCLUDE_PAT = (".bak", ".backup", "~", ".next.")
# 目录名不带点，只靠 EXCLUDE_PAT 会漏网：data/backup 曾把「待补编号/待B岗」工作稿
# 一路带进演示包。这里按目录名单独拦一道。
EXCLUDE_DIRS = {"backup", "__pycache__", ".git"}


def _skip(name):
    return name in EXCLUDE_NAMES or any(p in name for p in EXCLUDE_PAT)


def _skip_dir(name):
    return name in EXCLUDE_DIRS or any(p in name for p in EXCLUDE_PAT)


def _ignore(dirpath, names):
    """copytree 的忽略回调：目录按 _skip_dir，文件按 _skip + 空文件。"""
    out = []
    for n in names:
        p = os.path.join(dirpath, n)
        if os.path.isdir(p):
            if _skip_dir(n):
                out.append(n)
        elif _skip(n) or os.path.getsize(p) == 0:
            out.append(n)
    return out


# v1.2 英文字段 → 对外 CSV 中文表头（公众下载，中文更友好；顺序即导出顺序）
CSV_HEADER = [
    ("id", "编号"), ("name", "产地名称"), ("region", "保护分区（大区）"),
    ("subregion", "分区小区"), ("city_county", "所在市（县）"),
    ("detail_location", "详细位置"), ("fossil_group", "主要化石门类"),
    ("geological_age", "地质年代"), ("stratum", "赋存地层（组/群）"),
    ("protection_level", "产地保护级别"), ("protection_status", "保护区状态"),
    ("longitude", "经度（°E）"), ("latitude", "纬度（°N）"),
    ("coord_precision", "坐标精度"), ("data_status", "数据状态"),
    ("data_source", "数据来源"), ("remarks", "备注"),
]
# 旧版中文 16 列原样导出（无映射时回退）
LEGACY_KEYS = ["记录编号", "产地名称", "保护分区（大区）", "分区小区", "所在市（县）",
               "主要化石门类", "地质年代", "赋存地层（组/群）", "产地保护级别",
               "保护区状态", "经度（°E）", "纬度（°N）", "坐标精度", "数据状态",
               "数据来源（文献/页码）", "备注"]


def export_csv():
    with io.open(SITES, encoding="utf-8") as f:
        recs = json.load(f)
    keys = list(recs[0].keys())
    if set(dict(CSV_HEADER)) <= set(keys):          # v1.2 英文 17 列
        out = [(k, zh) for k, zh in CSV_HEADER if k in keys]
    else:                                           # 旧版中文 16 列原样
        out = [(k, k) for k in keys]
    with io.open(SITES_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow([zh for _, zh in out])
        for r in recs:
            w.writerow([r.get(k, "") for k, _ in out])
    print("已导出 %s（%d 条 × %d 列，中文表头）" % (SITES_CSV, len(recs), len(out)))
    return len(recs)


def _load_species():
    """图鉴数据尚未到位时 species.json 是 0 字节或空数组，一律当 []，
       页面自动回退到门类聚合，不等同于报错。"""
    if not os.path.isfile(SPECIES) or os.path.getsize(SPECIES) == 0:
        return []
    try:
        with io.open(SPECIES, encoding="utf-8") as f:
            raw = f.read().strip()
        if not raw:
            return []
        data = json.loads(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for k in ("items", "species", "data"):
                if isinstance(data.get(k), list):
                    return data[k]
        return []
    except (ValueError, IOError):
        return []


def make_inline():
    with io.open(SITES, encoding="utf-8") as f:
        recs = json.load(f)
    species = _load_species()
    js = ("/* 由 tools/build_offline.py 自动生成，请勿手改。\n"
          "   file:// 下浏览器禁止 fetch 本地 json，故把数据内联进来，双击即可看地图。 */\n"
          "window.SITES_DATA = " +
          json.dumps(recs, ensure_ascii=False, indent=0) + ";\n"
          "/* B 岗图鉴：空数组时页面自动回退到门类聚合 */\n"
          "window.SPECIES_DATA = " +
          json.dumps(species, ensure_ascii=False, indent=0) + ";\n")
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
    if os.path.isfile(SPECIES) and os.path.getsize(SPECIES) > 0:
        paths.append(SPECIES)   # B 岗图鉴一到位，版本号即变，缓存自动失效
    # 图鉴探索的根目录 JS 也要计入：加化石后 build_atlas_data.py 会改 atlas-demo-data.js，
    # 漏掉它就会出现"图鉴数据更新了、浏览器还是旧缓存"
    for fn in ATLAS_JS:
        p = os.path.join(BASE, fn)
        if os.path.isfile(p):
            paths.append(p)
    # HTML 本身也必须计入：只改导航/文案/说明时，若哈希不变浏览器会一直拿旧缓存页
    for fn in COPY_FILES:
        p = os.path.join(BASE, fn)
        if fn.endswith(".html") and os.path.isfile(p):
            paths.append(p)
    for p in sorted(paths):
        with io.open(p, "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:8]


# 只匹配本站自有资源（css/、js/ + 图鉴探索的四个根目录 JS），
# 外链与 assets/leaflet 的固定版本库不动
RE_ASSET = re.compile(
    r'(href|src)="((?:css|js)/[^"?#]+|atlas-(?:demo-data|logic|quiz|mystery)\.js)(?:\?v=[^"]*)?"')


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
        if os.path.isdir(junk) and _skip_dir(base):
            shutil.rmtree(junk)
            print("已从 dist 移除内部目录：" + os.path.relpath(junk, DIST))
            continue
        empty = os.path.isfile(junk) and os.path.getsize(junk) == 0
        if os.path.isfile(junk) and (_skip(base) or empty):
            os.remove(junk)
            print("已从 dist 移除内部文件：" + os.path.relpath(junk, DIST))

    for d in COPY_DIRS:
        src = os.path.join(BASE, d)
        if os.path.isdir(src):
            shutil.copytree(src, os.path.join(DIST, d), dirs_exist_ok=True,
                            ignore=_ignore)
    for f in COPY_FILES:
        shutil.copy2(os.path.join(BASE, f), os.path.join(DIST, f))

    # 内联数据
    with io.open(os.path.join(DIST, "js", "data-inline.js"), "w", encoding="utf-8") as f:
        f.write(make_inline())

    # 在 species.js / main.js / list.js 之前插入数据脚本；已有就跳过。
    # 必须早于 species.js：它加载时即读 window.SPECIES_DATA，晚一步离线图鉴就读不到。
    for page, anchor in (("map.html", '<script src="js/species.js"></script>'),
                         ("index.html", '<script src="js/species.js"></script>'),
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
    print("版本号 v=%s（由 css/js + HTML + sites.json 内容哈希得出）" % ver)
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
