#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""赣鄱石语 · 数据构建（A 岗 xlsx → sites.json）

用法：
    python tools/build_data.py --src X.xlsx           # 产出 sites.next.json（不覆盖），打印差异
    python tools/build_data.py --src X.xlsx --apply   # 备份后替换 data/sites.json
    python tools/build_data.py                        # 自动找桌面最新的产地表 xlsx

v1.2（图册重建版）适配：
- 源表 21 列（16 核心中文列 + 图册编号/详细位置/类型原文/现状原文/归并依据）
- 输出英文 17 列 json，与 A 岗 sites(2).json 同构（单一口径，两边不漂移）
- 经纬度四舍五入到 4 位小数

设计原则：
1) 默认不覆盖——先写到 sites.next.json 并打印差异，人工看一眼再 --apply；
2) 单一来源——前端 json 由本脚本从 xlsx 生成，杜绝两边各留一份口径；
3) 改版留痕——每次 --apply 都把旧 json 备份到 data/backup/。
"""
import argparse
import glob
import io
import json
import os
import re
import shutil
import sys
from datetime import datetime

try:
    import openpyxl
except ImportError:
    print("缺 openpyxl：pip install openpyxl")
    sys.exit(2)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# xlsx 中文列名（标准写法）
CANON = [
    "记录编号", "产地名称", "保护分区（大区）", "分区小区", "所在市（县）",
    "主要化石门类", "地质年代", "赋存地层（组/群）", "产地保护级别",
    "保护区状态", "经度（°E）", "纬度（°N）", "坐标精度", "数据状态",
    "数据来源（文献/页码）", "备注", "详细位置（据正文）",
]
ALIAS = {  # 表头可能的写法 → 标准列名
    "保护分区": "保护分区（大区）", "所在市县": "所在市（县）", "化石门类": "主要化石门类",
    "赋存地层": "赋存地层（组/群）", "保护级别": "产地保护级别", "经度": "经度（°E）",
    "纬度": "纬度（°N）", "数据来源": "数据来源（文献/页码）",
    "详细位置": "详细位置（据正文）",
}
# 中文列 → 输出 json 的英文键（v1.2 与 A 岗 sites(2).json 同构）
CN2EN = {
    "记录编号": "id", "产地名称": "name", "保护分区（大区）": "region",
    "分区小区": "subregion", "所在市（县）": "city_county",
    "详细位置（据正文）": "detail_location", "主要化石门类": "fossil_group",
    "地质年代": "geological_age", "赋存地层（组/群）": "stratum",
    "产地保护级别": "protection_level", "保护区状态": "protection_status",
    "经度（°E）": "longitude", "纬度（°N）": "latitude",
    "坐标精度": "coord_precision", "数据状态": "data_status",
    "数据来源（文献/页码）": "data_source", "备注": "remarks",
}


def norm(k):
    return re.sub(r"\s+", "", str(k or "")).replace("°", "")


def find_src():
    pats = [os.path.join(os.path.expanduser("~"), "Desktop", "*产地表*.xlsx"),
            os.path.join(os.path.expanduser("~"), "Desktop", "*汇总表*.xlsx"),
            os.path.join(os.path.expanduser("~"), "Downloads", "*产地表*.xlsx"),
            os.path.join(os.path.expanduser("~"), "Downloads", "*汇总表*.xlsx")]
    files = []
    for p in pats:
        files += [f for f in glob.glob(p) if not os.path.basename(f).startswith("~$")]
    if not files:
        return None
    return max(files, key=os.path.getmtime)


def read_sheet(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["产地总表"] if "产地总表" in wb.sheetnames else wb[wb.sheetnames[0]]

    # 找表头行：首列写着「记录编号」
    hdr_row = None
    for r in range(1, min(ws.max_row, 20) + 1):
        if norm(ws.cell(r, 1).value) == "记录编号":
            hdr_row = r
            break
    if hdr_row is None:
        raise SystemExit("没找到表头行（首列为「记录编号」）——表结构可能变了，请人工确认")

    colmap = {}
    for c in range(1, ws.max_column + 1):
        h = norm(ws.cell(hdr_row, c).value)
        if not h:
            continue
        for cand in CANON:
            if norm(cand) == h:
                colmap[c] = cand
                break
        else:
            if h in ALIAS and ALIAS[h] in CANON:
                colmap[c] = ALIAS[h]
    # 详细位置是 v1.2 新列，允许缺席（旧表没有）
    core = [c for c in CANON if c != "详细位置（据正文）"]
    missing = [c for c in core if c not in colmap.values()]
    if missing:
        raise SystemExit("表里缺列：%s —— 先和 A 岗确认列名，不要猜" % "、".join(missing))

    recs = []
    for r in range(hdr_row + 1, ws.max_row + 1):
        code = str(ws.cell(r, 1).value or "").strip()
        if not re.match(r"^JX-\d{2}-\d{2}-\d{3}$", code):
            continue
        rec = {}
        for c, name in colmap.items():
            en = CN2EN[name]
            v = ws.cell(r, c).value
            if name in ("经度（°E）", "纬度（°N）"):
                if isinstance(v, (int, float)):
                    rec[en] = round(float(v), 4)
                else:
                    t = re.sub(r"[^\d.\-]", "", str(v or ""))
                    rec[en] = float(t) if t else ""
            else:
                rec[en] = "" if v is None else re.sub(r"\s+", " ", str(v)).strip()
        recs.append(rec)
    return recs


def diff(old, new):
    o = {r["id"]: r for r in old} if old and "id" in old[0] else {}
    n = {r["id"]: r for r in new}
    added = [k for k in n if k not in o]
    removed = [k for k in o if k not in n]
    changed = []
    for k in n:
        if k not in o:
            continue
        d = [c for c in n[k] if str(o[k].get(c, "")) != str(n[k].get(c, ""))]
        if d:
            changed.append((k, d))
    return added, removed, changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", help="xlsx 路径；缺省自动找桌面最新的《产地表/汇总表》")
    ap.add_argument("--out", default=os.path.join(BASE, "data", "sites.next.json"))
    ap.add_argument("--apply", action="store_true", help="备份后覆盖 data/sites.json")
    a = ap.parse_args()

    src = a.src or find_src()
    if not src or not os.path.isfile(src):
        print("没找到 xlsx，用 --src 指定路径")
        return 2
    print("源表：%s" % src)
    new = read_sheet(src)
    print("读到 %d 条记录（英文 %d 列）" % (len(new), len(new[0])))

    cur_path = os.path.join(BASE, "data", "sites.json")
    old = json.load(io.open(cur_path, encoding="utf-8")) if os.path.isfile(cur_path) else []
    added, removed, changed = diff(old, new)
    print("对比现版：新增 %d ｜ 删除 %d ｜ 字段变动 %d 条" % (len(added), len(removed), len(changed)))
    for k in added:
        print("  + %s %s" % (k, new[[r["id"] for r in new].index(k)]["name"][:22]))
    for k in removed:
        print("  - %s" % k)
    for k, fields in changed[:12]:
        print("  ~ %s 变更：%s" % (k, "、".join(fields)))
    if len(changed) > 12:
        print("  ... 另有 %d 条" % (len(changed) - 12))

    out = os.path.join(BASE, "data", "sites.json") if a.apply else a.out
    if a.apply and os.path.isfile(out):
        bdir = os.path.join(BASE, "data", "backup")
        os.makedirs(bdir, exist_ok=True)
        bak = os.path.join(bdir, "sites_%s.json" % datetime.now().strftime("%Y%m%d_%H%M%S"))
        shutil.copy2(out, bak)
        print("已备份旧数据：%s" % os.path.relpath(bak, BASE))

    with io.open(out, "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, indent=1)

    print("已写出 %s" % os.path.relpath(out, BASE))
    if not a.apply:
        print("\n确认差异无误后执行：python tools/build_data.py --src \"%s\" --apply" % os.path.basename(src))
    print("\n下一步必做：python tools/validate_data.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
