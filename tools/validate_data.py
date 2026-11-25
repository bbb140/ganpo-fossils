#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""赣鄱石语 · 数据校验器

用法：
    python tools/validate_data.py                 # 默认同时校验 sites.json + species.json
    python tools/validate_data.py --file X.json   # 只校验指定文件
    python tools/validate_data.py --quiet         # 只输出结论

图鉴（species.json）校验：编号必须能对上产地、中文名不重复、鉴定要点不缺；
文献图号不全等资料缺口只报警告、不阻塞发布（这些要找 B 岗补，不自行编造）。

为什么要有它：
1) 字段契约——A 岗换版时若改了列名/删了列，这里第一时间报错，不让前端静默变空；
2) 统一口径——编号、坐标、精度、级别枚举、坐标范围，一次跑完；
3) 可交付——把输出贴给 A 岗，就是一份验收单。

支持两版数据（自动识别）：
- v1.2 图册重建版：英文 17 列（id/name/region/...），编号 JX-00-00-NNN 顺序号
- 旧 32 条版：中文 16 列，编号 JX-大区码-小区码-序号（段码校验仅旧版生效）

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
# v1.2（图册重建版，109 条）：英文 17 列
REQUIRED_V12 = [
    "id", "name", "region", "subregion", "city_county", "detail_location",
    "fossil_group", "geological_age", "stratum", "protection_level",
    "protection_status", "longitude", "latitude", "coord_precision",
    "data_status", "data_source", "remarks",
]
# 旧版：中文 16 列（保留兼容，避免回滚旧数据时误报）
REQUIRED_V1 = [
    "记录编号", "产地名称", "保护分区（大区）", "分区小区", "所在市（县）",
    "主要化石门类", "地质年代", "赋存地层（组/群）", "产地保护级别",
    "保护区状态", "经度（°E）", "纬度（°N）", "坐标精度", "数据状态",
    "数据来源（文献/页码）", "备注",
]

# 列别名（英文优先 / 中文兜底）——与 js/fields.js 的 F 表保持同一契约
COLS = {
    "code":   ("id", "记录编号"),
    "name":   ("name", "产地名称"),
    "region": ("region", "保护分区（大区）", "保护分区"),
    "zone":   ("subregion", "分区小区", "小区"),
    "county": ("city_county", "所在市（县）", "所在市县"),
    "detail": ("detail_location", "详细位置"),
    "taxa":   ("fossil_group", "主要化石门类", "化石门类"),
    "age":    ("geological_age", "地质年代"),
    "strata": ("stratum", "赋存地层（组/群）", "赋存地层"),
    "level":  ("protection_level", "产地保护级别", "保护级别"),
    "status": ("protection_status", "保护区状态"),
    "lon":    ("longitude", "经度（°E）", "经度"),
    "lat":    ("latitude", "纬度（°N）", "纬度"),
    "acc":    ("coord_precision", "坐标精度"),
    "dstat":  ("data_status", "数据状态"),
    "source": ("data_source", "数据来源（文献/页码）", "数据来源"),
    "note":   ("remarks", "备注"),
}

AREAS = ("赣西北", "赣东北", "赣西", "赣东南")
AREA_CODE = {"01": "赣西北", "02": "赣东北", "03": "赣西", "04": "赣东南"}
ZONE_CODE = {
    "01": "彭泽", "02": "武宁", "03": "乐平", "04": "玉山", "05": "弋阳",
    "06": "上高", "07": "萍乡", "08": "吉安", "09": "铅山",
    "11": "赣州", "12": "崇义", "13": "会昌", "14": "信丰", "99": "其它",
}
ACC_LEVELS = {"实测", "村级占位", "乡级占位", "县级占位", "市级占位", "地名级"}
LEVELS = ("世界级", "国家级", "省级")
# 官方口径（规划正文）：109 = 5 世界级 + 20 国家级 + 84 省级。
# v1.2 图册逐条判定为 5/17/87，差异属"图册名录 vs 规划统计"两套口径，给 info 不给错。
OFFICIAL_LEVEL = {"世界级": 5, "国家级": 20, "省级": 84}
WHITELIST = {
    "JX-03-06-901": "清江盆地：编号沿 06 上高码，A岗裁定小区为「未定」（旧版数据）",
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
    """按别名取值（精确 → 归一化模糊）"""
    for a in alts:
        if a in rec:
            return rec[a]
    want = [norm_key(a) for a in alts]
    for k, v in rec.items():
        if norm_key(k) in want:
            return v
    return ""


def g(rec, key):
    """按契约别名取值"""
    return get(rec, *COLS[key])


def has_val(v):
    """v1.2 空值写法是「无」——与空串同等对待"""
    t = s(v)
    return t not in ("", "无", "—", "-")


def validate(records, rep):
    if not isinstance(records, list):
        rep.err("顶层不是数组：sites.json 应是 [{...}, ...]")
        return
    if len(records) == 0:
        rep.err("记录数为 0")
        return

    # 1. 字段契约：v1.2 英文 17 列 或 旧版中文 16 列，满足其一即可
    keys = set()
    for r in records:
        keys |= set(r.keys())
    if set(REQUIRED_V12) <= keys:
        extra = sorted(keys - set(REQUIRED_V12))
        if extra:
            rep.info("多出字段（不影响渲染）：%s" % "、".join(extra))
    elif set(REQUIRED_V1) <= keys:
        rep.info("识别为旧版中文 16 列格式（兼容模式，建议升级 v1.2 英文 17 列）")
    else:
        miss = [c for c in REQUIRED_V12 if c not in keys]
        rep.err("字段契约不满足：既不是 v1.2 英文 17 列，也不是旧版中文 16 列"
                "（缺 %d 列：%s）—— 若 A 岗改了列名，请同步更新本文件 COLS 与 js/fields.js 的 F 表"
                % (len(miss), "、".join(miss[:5])))

    # 2. 逐条检查
    codes = Counter()
    acc_dist = Counter()
    zone_dist = Counter()
    lvl_dist = Counter()
    strata_missing = 0
    src_weak = 0
    legacy_codes = 0            # 旧版编号（段码可校验）计数

    for i, r in enumerate(records, 1):
        code = s(g(r, "code"))
        name = s(g(r, "name")) or "（无名）"

        if not re.match(r"^JX-\d{2}-\d{2}-\d{3}$", code):
            rep.err("#%d 编号格式错：%r（应形如 JX-00-00-001）" % (i, code))
            continue
        codes[code] += 1
        p = code.split("-")
        if p[1] != "00" or p[2] != "00":
            legacy_codes += 1    # 旧版编号才做段码校验

        # 必填项非空（v1.2 的「无」= 有值但内容为无，不算错误）
        for key, label in [("name", "产地名称"), ("region", "大区"), ("zone", "小区"),
                           ("county", "所在市（县）"), ("taxa", "化石门类"),
                           ("age", "地质年代"), ("acc", "坐标精度"),
                           ("source", "数据来源")]:
            if not s(g(r, key)):
                rep.err("%s 的「%s」为空" % (code, label))

        # 坐标范围
        lon = num(g(r, "lon"))
        lat = num(g(r, "lat"))
        if lon is None or lat is None:
            rep.err("%s 经纬度不是数字：%r / %r" % (code, g(r, "lon"), g(r, "lat")))
        else:
            if lon == 0 or lat == 0:
                rep.err("%s 经纬度为 0（占位未填）" % code)
            elif not (LON_RANGE[0] <= lon <= LON_RANGE[1] and LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
                rep.err("%s 坐标落在江西范围外：%.4f, %.4f" % (code, lon, lat))

        # 大区
        area = s(g(r, "region"))
        if area not in AREAS:
            rep.err("%s 大区非法：%r（应为 赣西北/赣东北/赣西/赣东南）" % (code, area))
        elif p[1] != "00" and AREA_CODE.get(p[1]) and AREA_CODE[p[1]] != area:
            rep.err("%s 编号段2=%s 应是「%s」，实际填「%s」" % (code, p[1], AREA_CODE[p[1]], area))

        # 小区（v1.2 全为标准名/其它行；「未定」仍允许并提示）
        zone = s(g(r, "zone"))
        zone_dist[zone] += 1
        if not zone:
            rep.err("%s 分区小区为空" % code)
        elif zone.startswith("待确认") or zone.startswith("未定"):
            rep.warn("%s 小区未定：%r（应单列灰色，不参与大区着色）" % (code, zone))
        elif legacy_codes and p[2] != "00":
            expect = "99" if zone.startswith("其它") else next(
                (zc for zc, zn in ZONE_CODE.items() if zn in zone and zc != "99"), None)
            if expect and expect != p[2] and code not in WHITELIST:
                rep.err("%s 编号段3=%s 与小区「%s」不符（旧版编号段码校验）" % (code, p[2], zone))
            elif expect and expect != p[2]:
                rep.info("%s 编号段3 例外已白名单：%s" % (code, WHITELIST[code]))

        # 坐标精度枚举
        acc = s(g(r, "acc"))
        if acc:
            acc_base = re.sub(r"[（(][^）)]*[）)]", "", acc).strip()
            acc_dist[acc_base] += 1
            if acc_base not in ACC_LEVELS:
                rep.err("%s 坐标精度非法：%r（应为 %s）" % (code, acc, "/".join(sorted(ACC_LEVELS))))

        # 地层：v1.2 填「无」= 图册名录未给（统计不报错）；裸「待确认」仍警告
        strata = s(g(r, "strata"))
        if not strata or strata == "无":
            strata_missing += 1
        elif strata == "待确认":
            rep.warn("%s 地层只写「待确认」，未说明原因" % code)
        elif "待确认" in strata or "待补" in strata:
            rep.warn("%s 地层含待核实说明：%s" % (code, strata[:34]))

        # 级别（v1.2 有逐条真值，枚举校验；旧版「待确认」只统计）
        lv = s(g(r, "level"))
        if lv:
            if lv in LEVELS:
                lvl_dist[lv] += 1
            elif "待确认" in lv or "待核定" in lv:
                lvl_dist["待核定"] += 1
            else:
                rep.err("%s 保护级别非法：%r（应为 世界级/国家级/省级）" % (code, lv))

        # 来源：仅规划点名且无《》出处 = 弱来源
        src = s(g(r, "source"))
        if not src:
            rep.err("%s 数据来源为空" % code)
        elif "S11" in src and "《" not in src:
            src_weak += 1
            rep.warn("%s 来源仅规划点名，无文献支撑：%s" % (code, src[:30]))

    # 3. 全局统计
    dup = [c for c, n in codes.items() if n > 1]
    if dup:
        rep.err("编号重复：%s" % "、".join(dup))

    # v1.2 顺序编号应连续（001..N）
    if codes and not legacy_codes:
        nums = sorted(int(c.split("-")[-1]) for c in codes)
        if nums != list(range(1, len(nums) + 1)):
            rep.warn("顺序编号不连续：应有 001–%03d，实际 %03d–%03d"
                     % (len(nums), nums[0], nums[-1]))

    rep.info("记录数 %d ｜ 大区分布 %s" % (
        len(records), "、".join("%s %d" % (k, v) for k, v in Counter(
            s(g(r, "region")) for r in records).most_common())))
    rep.info("坐标精度分布：%s" % "、".join("%s %d" % (k, v) for k, v in acc_dist.most_common()))
    rep.info("分区小区取值 %d 种：%s" % (len(zone_dist), "、".join(
        "%s×%d" % (k or "空", v) for k, v in zone_dist.most_common())))
    if lvl_dist:
        rep.info("保护级别分布：%s" % "、".join(
            "%s %d" % (k, v) for k, v in lvl_dist.most_common()))
        for lv in LEVELS:
            if lvl_dist.get(lv) and lvl_dist[lv] != OFFICIAL_LEVEL[lv]:
                rep.info("级别口径差异：%s %d 条，规划正文口径为 %d 处——"
                         "图册逐条判定与规划统计为两套口径，展示时须注明" %
                         (lv, lvl_dist[lv], OFFICIAL_LEVEL[lv]))
    if strata_missing:
        rep.info("赋存地层图册名录未提供 %d/%d 条（填「无」，属可接受缺口，不阻塞发布）"
                 % (strata_missing, len(records)))
    if src_weak:
        rep.warn("来源仅规划点名 %d/%d 条（缺文献支撑）" % (src_weak, len(records)))


def validate_species(records, rep, site_ids):
    """图鉴数据校验：错误阻塞发布，资料缺口只警告（不自行补造文献信息）。"""
    if not isinstance(records, list):
        rep.err("图鉴顶层不是数组：species.json 应是 [{...}, ...]")
        return
    if not records:
        rep.err("图鉴为空：species.json 无条目")
        return

    seen = {}
    linked = 0
    for i, f in enumerate(records):
        if not isinstance(f, dict):
            rep.err("图鉴第 %d 条不是对象" % (i + 1))
            continue
        name = s(f.get("cn_name") or f.get("中文名"))
        if not name:
            rep.err("图鉴第 %d 条缺中文名（cn_name）" % (i + 1))
            continue
        if name in seen:
            rep.err("图鉴中文名重复：「%s」（第 %d、%d 条）" % (name, seen[name], i + 1))
        seen[name] = i + 1

        feat = s(f.get("features"))
        ref = s(f.get("reference"))
        if not feat:
            rep.err("图鉴「%s」缺鉴定要点（features）" % name)
        if re.search(r"待补|待定|TODO|待确认", feat + ref):
            rep.err("图鉴「%s」仍含待补字样" % name)

        link = s(f.get("tapho_link"))
        if link in ("无", "—", "-"):
            link = ""
        if link:
            linked += 1
            for code in re.split(r"[、，,；;]", link):
                code = code.strip()
                if code and code not in site_ids:
                    rep.err("图鉴「%s」的关联编号 %s 不在产地表中" % (name, code))

        # 图号溯源：无关联编号的文献条目同样要查（它们恰恰最依赖文献定位）
        figs = set(re.findall(r"图\s*\d+-\d+-\d+", feat))
        refs = set(re.findall(r"图\s*\d+-\d+-\d+", ref))
        if "图册" in ref and not refs:
            rep.warn("图鉴「%s」来自图册但文献字段无图号页码（需 B 岗核）" % name)
        elif figs and not refs:
            rep.warn("图鉴「%s」正文有图号但文献字段无图号页码（需 B 岗核）" % name)
        elif refs and (figs - refs):
            rep.warn("图鉴「%s」正文图号 %s 未在文献字段列出（需 B 岗核）" %
                     (name, "、".join(sorted(figs - refs))))

    rep.info("图鉴共 %d 条：%d 条有产地关联，%d 条为文献条目（不从地图掉落）"
             % (len(records), linked, len(records) - linked))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=None, help="只校验指定文件（默认校验产地+图鉴）")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()

    files = [a.file] if a.file else [
        os.path.join(BASE, "data", "sites.json"),
        os.path.join(BASE, "data", "species.json"),
    ]
    rep = Report()
    site_ids = set()
    for path in files:
        if not os.path.isfile(path):
            if a.file:
                print("找不到数据文件：%s" % path)
                return 1
            continue
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        records = data if isinstance(data, list) else (
            data.get("sites") or data.get("species") or data.get("data") or [])
        if os.path.basename(path) == "species.json":
            validate_species(records, rep, site_ids)
        else:
            validate(records, rep)
            site_ids = set(s(g(r, "code")) for r in records if isinstance(r, dict))

    print("=" * 66)
    print("赣鄱石语 · 数据校验报告")
    print("文件：%s" % "、".join(os.path.relpath(p, BASE) for p in files))
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
