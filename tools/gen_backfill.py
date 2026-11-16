# -*- coding: utf-8 -*-
"""
生成《回填表》给 A 岗：16 条地层 + 4 条坐标下钻。
只写"动作"和"格式"，不替 A 岗编具体地层名——查不到就写"待补（无公开来源）"。
用法：python tools/gen_backfill.py
输出：data/回填表.csv
"""
import csv
import io
import json
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "data", "sites.json")
FENQU = os.path.join(BASE, "data", "分区小区归并表.csv")
DST = os.path.join(BASE, "data", "回填表.csv")

# 4 条市级占位的下钻方向（坐标只给"往哪一级退"，不给具体经纬度）
DRILL = {
    "JX-02-03-001": ("乐平市为县级市，退到县级驻地即可收窄到 20–30 km；若能查到涌山/名口等具体剖面更好",
                     "乐平市（县级）驻地"),
    "JX-03-06-001": ("新余为地级市，需下钻到渝水区姚圩镇（乡级，5–10 km）",
                     "渝水区姚圩镇"),
    "JX-03-07-001": ("萍乡为地级市，需下钻到安源区或上栗/芦溪的具体产地",
                     "安源区（或具体乡镇）"),
    "JX-03-06-901": ("樟树为县级市，退到县级驻地；若清江盆地归属定不下来，此条可暂不动",
                     "樟树市（县级）驻地"),
}

FIELDS = ["类型", "记录编号", "产地名称", "所在市（县）", "小区（归并后）",
          "现值", "建议值（格式/方向）", "说明（你要做的动作）", "回填值", "确认（签名/日期）"]


def load_fenqu():
    m = {}
    with io.open(FENQU, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            m[r["记录编号"]] = r["小区（建议）"]
    return m


def classify(rec):
    """按现值形态给出动作。返回 (建议值, 说明)"""
    v = rec["赋存地层（组/群）"]
    cell = rec["分区小区"]
    if "与第四纪化石不符" in v:
        return ("待定（表1 该行地层与第四纪化石冲突）",
                "★先解决冲突再填：要么改这条的地层、要么改它挂的小区；"
                "建议单列到「其它单元」，不要挂在赣东南其它行里")
    if "待确认（表1" in v:
        # 括号里已经有表 1 的小区级描述，只需提到正文并标来源
        desc = re.search(r"表1\s*(.+?)）", v)
        desc = desc.group(1) if desc else "小区级地层"
        short = cell.replace("其它（", "").replace("）", "").split("、")[0]
        return ("（表1 %s小区：%s，小区级）" % (short, desc.split("：")[-1]),
                "已达标口径，只需改写格式：删掉「待确认」，把表1描述放括号里；"
                "数据状态列改「小区级（表1）」")
    if "组级" in v and "待确认" in v:
        return ("<正式组名>（现仅到%s）" % v.split("（")[0],
                "层位只到系/群，补到组名；查不到就保留现状并在数据状态标「部分待确认」")
    if "与第四纪化石不符" in v:
        return ("待定（表1 该行地层与第四纪化石冲突）",
                "★先解决冲突再填：要么改这条的地层、要么改它挂的小区；"
                "建议单列到「其它单元」，不要挂在赣东南其它行里")
    if v.strip() == "待确认":
        return ("<正式岩石地层单位名>（组/群）",
                "查该点文献或《江西省区域地质志》取组/群名；"
                "查不到就写「待补（无公开来源）」，数据状态保留「待确认」，不要猜")
    if "待确认" in v:
        return (re.sub(r"（待确认）", "", v) + "（组名待补）",
                "已有粗略类型，补正式组名；查不到保留并标「部分待确认」")
    return (v, "无需处理")


def main():
    with io.open(SRC, encoding="utf-8") as f:
        recs = json.load(f)
    fenqu = load_fenqu()

    rows = []
    for r in recs:
        v = r["赋存地层（组/群）"]
        if "待确认" in v:
            sug, act = classify(r)
            rows.append(["地层", r["记录编号"], r["产地名称"], r["所在市（县）"],
                         fenqu.get(r["记录编号"], ""), v, sug, act, "", ""])
    for r in recs:
        if r["坐标精度"] == "市级占位":
            sug, act = DRILL[r["记录编号"]]
            rows.append(["坐标", r["记录编号"], r["产地名称"], r["所在市（县）"],
                         fenqu.get(r["记录编号"], ""),
                         "%s, %s（市级占位，60–100 km）" % (r["经度（°E）"], r["纬度（°N）"]),
                         sug, act, "", ""])

    with io.open(DST, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(FIELDS)
        w.writerows(rows)

    n_dc = sum(1 for x in rows if x[0] == "地层")
    n_zb = sum(1 for x in rows if x[0] == "坐标")
    print("已写出：%s" % DST)
    print("地层 %d 行 / 坐标 %d 行，共 %d 行" % (n_dc, n_zb, len(rows)))
    assert n_dc == 16 and n_zb == 4, "条数与预期不符"


if __name__ == "__main__":
    main()
