#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""赣鄱石语 · 数据校验器

用法：
    python tools/validate_data.py                 # 校验 data/sites.json
    python tools/validate_data.py --file X.json   # 校验指定文件
    python tools/validate_data.py --quiet         # 只输出结论

为什么要有它：
1) 字段契约——A 岗换版时若改了列名/删了列，这里第一时间报错，不让前端静默变空；
2) 统一口径——编号↔大区↔小区、坐标↔精度、地层有没有裸"待确认"，一次跑完；
3) 可交付——把输出贴给 A 岗，就是一份验收单。

退出码：0 = 无错误（可交付）；1 = 有错误（不要发布）。
"""
import argparse
import io
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------- 字段契约 ----------
# 缺任何一列都算错误：前端靠这些列渲染，少一列就少一块信息
REQUIRED = [
    "记录编号", "产地名称", "保护分区（大区）", "分区小区", "所在市（县）",
    "主要化石门类", "地质年代", "赋存地层（组/群）", "产地保护级别",
    "保护区状态", "经度（°E）", "纬度（°N）", "坐标精度", "数据状态",
    "数据来源（文献/页码）", "备注",
]

AREA_CODE = {"01": "赣西北", "02": "赣东北", "03": "赣西", "04": "赣东南"}
ZONE_CODE = {
    "01": "彭泽", "02": "武宁", "03": "乐平", "04": "玉山", "05": "弋阳",
    "06": "上高", "07": "萍乡", "08": "吉安", "09": "铅山",
    "11": "赣州", "12": "崇义", "13": "会昌", "14": "信丰", "99": "其它",
}
ACC_LEVELS = {"实测", "乡级占位", "县级占位", "市级占位", "地名级"}
# 编号与小区码不一致但已知且合理的记录（每个都要写理由，否则就是漏检）
WHITELIST = {
    "JX-03-06-901": "清江盆地：编号沿 06 上高码，A岗裁定小区为「未定」，属已知例外",
}
LON_RANGE = (113.0, 118.5)   # 江西经度
LAT_RANGE = (24.0, 30.5)     # 江西纬度


class Report:
    def __init__(self):
        self.errors = []
        self.warns = []
        self.infos = []

    def err(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warns.append(msg)

    def info(self, msg):
        self.infos.append(msg)


def s(v):
    return "" if v is None else str(v).strip()


def num(v):
    if isinstance(v, (int, float)):
        return float(v)
    t = re.sub(r"[^\d.\-]", "", s(v))
    try:
        return float(t)
    except ValueError:
        return None


def norm_key(k):
    """列名归一化：去掉括号内容与度数符号，用于别名比对"""
    return re.sub(r"[（(][^）)]*[）)]", "", s(k)).replace("°", "").strip()


def get(rec, *alts):
    """按别名取值，容忍列名带单位（如 经度（°E））"""
    for a in alts:
        if a in rec:
            return rec[a]
    want = [norm_key(a) for a in alts]
    for k, v in rec.items():
        if norm_key(k) in want:
            return v
    return ""


def validate(records, rep):
    if not isinstance(records, list):
        rep.err("顶层不是数组：sites.json 应是 [{...}, ...]")
        return
    if len(records) == 0:
        rep.err("记录数为 0")
        return

    # 1. 字段契约（抽第一条 + 全集，防止某条少字段）
    keys = set()
    for r in records:
        keys |= set(r.keys())
    missing = [c for c in REQUIRED if c not in keys]
    if missing:
        rep.err("缺字段（%d 列）：%s —— 若 A 岗改了列名，请同步更新本文件的 REQUIRED 与 js/map.js 的别名表"
                % (len(missing), "、".join(missing)))
    extra = sorted(keys - set(REQUIRED))
    if extra:
        rep.info("多出字段（不影响渲染）：%s" % "、".join(extra))

    # 2. 逐条检查
    codes = Counter()
    acc_dist = Counter()
    zone_dist = Counter()
    lvl_pending = 0
    strata_pending = 0
    src_weak = 0

    for i, r in enumerate(records, 1):
        code = s(get(r, "记录编号"))
        name = s(get(r, "产地名称")) or "（无名）"

        # 编号
        if not re.match(r"^JX-\d{2}-\d{2}-\d{3}$", code):
            rep.err("#%d 编号格式错：%r（应形如 JX-01-02-001）" % (i, code))
            continue
        codes[code] += 1
        p = code.split("-")

        # 必填项非空
        for col, alts in [
            ("产地名称", ("产地名称",)), ("保护分区（大区）", ("保护分区（大区）", "保护分区")),
            ("分区小区", ("分区小区", "小区")), ("所在市（县）", ("所在市（县）", "所在市县")),
            ("主要化石门类", ("主要化石门类", "化石门类")), ("地质年代", ("地质年代",)),
            ("坐标精度", ("坐标精度",)), ("数据来源（文献/页码）", ("数据来源（文献/页码）", "数据来源")),
        ]:
            if not s(get(r, *alts)):
                rep.err("%s 的「%s」为空" % (code, col))

        # 坐标范围
        lon = num(get(r, "经度（°E）", "经度"))
        lat = num(get(r, "纬度（°N）", "纬度"))
        if lon is None or lat is None:
            rep.err("%s 经纬度不是数字：%r / %r" % (code, get(r, "经度（°E）"), get(r, "纬度（°N）")))
        else:
            if lon == 0 or lat == 0:
                rep.err("%s 经纬度为 0（占位未填）" % code)
            elif not (LON_RANGE[0] <= lon <= LON_RANGE[1] and LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
                rep.err("%s 坐标落在江西范围外：%.4f, %.4f" % (code, lon, lat))

        # 大区 + 编号段2 一致
        area = s(get(r, "保护分区（大区）", "保护分区"))
        if area not in AREA_CODE.values():
            rep.err("%s 大区非法：%r（应为 赣西北/赣东北/赣西/赣东南）" % (code, area))
        elif AREA_CODE.get(p[1]) and AREA_CODE[p[1]] != area:
            rep.err("%s 编号段2=%s 应是「%s」，实际填「%s」" % (code, p[1], AREA_CODE[p[1]], area))

        # 小区 + 编号段3 一致
        zone = s(get(r, "分区小区", "小区"))
        zone_dist[zone] += 1
        if not zone:
            rep.err("%s 分区小区为空" % code)
        elif zone.startswith("待确认") or zone.startswith("未定"):
            rep.warn("%s 小区未定：%r（按 A 岗裁定应为「未定（…）」并单列灰色）" % (code, zone))
        else:
            expect = None
            if zone.startswith("其它"):
                expect = "99"
            else:
                for zc, zn in ZONE_CODE.items():
                    if zn in zone and zc != "99":
                        expect = zc
                        break
            if expect and expect != p[2] and code not in WHITELIST:
                rep.err("%s 编号段3=%s 与小区「%s」不符（应按 %s）" % (code, p[2], zone, expect))
            elif expect and expect != p[2]:
                rep.info("%s 编号段3 例外已白名单：%s" % (code, WHITELIST[code]))

        # 坐标精度枚举
        acc = s(get(r, "坐标精度", "精度"))
        if acc:
            acc_base = re.sub(r"[（(][^）)]*[）)]", "", acc).strip()
            acc_dist[acc_base] += 1
            if acc_base not in ACC_LEVELS:
                rep.err("%s 坐标精度非法：%r（应为 %s）" % (code, acc, "/".join(sorted(ACC_LEVELS))))

        # 地层：不允许裸"待确认"
        strata = s(get(r, "赋存地层（组/群）", "赋存地层"))
        if not strata:
            rep.err("%s 赋存地层为空" % code)
        elif strata == "待确认":
            strata_pending += 1
            rep.warn("%s 地层只写「待确认」，未说明原因" % code)
        elif "待确认" in strata or "待补" in strata:
            strata_pending += 1
            rep.warn("%s 地层含待核实说明：%s" % (code, strata[:34]))

        # 级别：已知缺口，只统计不报错
        lv = s(get(r, "产地保护级别", "保护级别"))
        if not lv or "待确认" in lv or "待核定" in lv:
            lvl_pending += 1

        # 来源：只统计学文献支撑的（S11 规划点名且无《》出处）
        src = s(get(r, "数据来源（文献/页码）", "数据来源"))
        if not src:
            rep.err("%s 数据来源为空" % code)
        elif "S11" in src and "《" not in src:
            src_weak += 1
            rep.warn("%s 来源仅规划点名，无文献支撑：%s" % (code, src[:30]))

    # 3. 全局统计
    dup = [c for c, n in codes.items() if n > 1]
    if dup:
        rep.err("编号重复：%s" % "、".join(dup))

    rep.info("记录数 %d ｜ 大区分布 %s" % (
        len(records), "、".join("%s %d" % (k, v) for k, v in Counter(
            s(get(r, "保护分区（大区）", "保护分区")) for r in records).most_common())))
    rep.info("坐标精度分布：%s" % "、".join("%s %d" % (k, v) for k, v in acc_dist.most_common()))
    rep.info("分区小区取值 %d 种：%s" % (len(zone_dist), "、".join(
        "%s×%d" % (k or "空", v) for k, v in zone_dist.most_common())))
    if lvl_pending:
        rep.warn("保护级别待核定 %d/%d 条 —— 《附表 4》未公开，属可接受缺口，前端已按大区着色"
                 % (lvl_pending, len(records)))
    if strata_pending:
        rep.warn("赋存地层待补 %d/%d 条" % (strata_pending, len(records)))
    if src_weak:
        rep.warn("来源仅规划点名 %d/%d 条（缺文献支撑）" % (src_weak, len(records)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=os.path.join(BASE, "data", "sites.json"))
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    if not os.path.isfile(a.file):
        print("找不到数据文件：%s" % a.file)
        return 1
    with io.open(a.file, encoding="utf-8") as f:
        data = json.load(f)
    records = data if isinstance(data, list) else (
        data.get("sites") or data.get("data") or [])

    rep = Report()
    validate(records, rep)

    print("=" * 66)
    print("赣鄱石语 · 数据校验报告")
    print("文件：%s" % os.path.relpath(a.file, BASE))
    print("时间：%s" % datetime.now().strftime("%Y-%m-%d %H:%M"))
    print("=" * 66)

    if not a.quiet:
        for t, items in (("错误", rep.errors), ("警告", rep.warns), ("提示", rep.infos)):
            if not items:
                continue
            print("\n[%s] %d 条" % (t, len(items)))
            for m in items:
                print("  %s %s" % ({"错误": "×", "警告": "!", "提示": "·"}[t], m))

    print("\n" + "-" * 66)
    if rep.errors:
        print("结论：不通过 —— %d 个错误必须先修（不要发布）" % len(rep.errors))
        return 1
    print("结论：通过 —— 0 错误，%d 条警告（已知缺口，可发布）" % len(rep.warns))
    return 0


if __name__ == "__main__":
    sys.exit(main())
