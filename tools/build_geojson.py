# -*- coding: utf-8 -*-
"""
从 data/sites.json 生成标准 GeoJSON（data/sites.geojson），供 QGIS / ArcGIS /
其它 GIS 软件直接打开。与 sites.json 同源，改数据后重跑本脚本即可，不需手改。

用法：
  python tools/build_geojson.py

设计要点：
1) geometry 用 Point，坐标顺序 [经度, 纬度]，坐标系 WGS84（EPSG:4326），
   这是 GeoJSON 规范与 Leaflet / 天地图共同使用的顺序，写反会跑到国外去；
2) properties 保留英文 17 字段原名，与 sites.json / CSV 一一对应，方便对照；
3) 附加两个派生字段，把本站的坐标口径一并带走，避免 GIS 用户误读：
     coord_approx  : true = 行政驻地/地名占位，false = 实测
     coord_error_km: 该精度档的误差范围（如「县级占位」→「20–30 km」）
4) 无坐标记录不编点，geometry 置 null，properties 照常保留。
"""
import io
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITES = os.path.join(BASE, "data", "sites.json")
OUT = os.path.join(BASE, "data", "sites.geojson")

# 与 js/fields.js 的 accErrorKm / isApprox 保持同一套口径，改一处要同步两处
ERROR_KM = [
    ("村级", "2–5 km"),
    ("乡级", "5–10 km"),
    ("县级", "20–30 km"),
    ("市级", "60–100 km"),
    ("地名", "20–30 km"),
]


def acc_error_km(acc):
    a = str(acc or "")
    for key, km in ERROR_KM:
        if key in a:
            return km
    if "实测" in a or "GPS" in a.upper():
        return "实测"
    return "数公里至数十公里"


def is_approx(acc):
    if not acc:
        return True
    return not ("实测" in str(acc) or "GPS" in str(acc).upper())


def to_num(v):
    """容忍 115.51 / '115.51°E' / ' 115.51 ' 三种写法；空或「无」返回 None。"""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s in ("无", "—", "-", "None", "null"):
        return None
    import re
    m = re.search(r"-?\d+(?:\.\d+)?", s.replace(",", "").replace("，", ""))
    return float(m.group(0)) if m else None


def build():
    with io.open(SITES, encoding="utf-8") as f:
        recs = json.load(f)

    features = []
    for r in recs:
        lon, lat = to_num(r.get("longitude")), to_num(r.get("latitude"))
        acc = r.get("coord_precision", "")
        props = dict(r)                       # 17 字段原名全保留
        props["coord_approx"] = is_approx(acc)
        props["coord_error_km"] = acc_error_km(acc)

        if lon is None or lat is None:
            geom = None                       # 无坐标不编点
        else:
            geom = {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}

        features.append({
            "type": "Feature",
            "id": r.get("id") or r.get("记录编号") or str(len(features) + 1),
            "geometry": geom,
            "properties": props,
        })

    fc = {
        "type": "FeatureCollection",
        "name": "赣鄱石语·江西省古生物化石产地",
        "crs": {"type": "name", "properties": {
            "name": "urn:ogc:def:crs:OGC:1.3:CRS84"   # WGS84 经纬度顺序 [lon, lat]
        }},
        "metadata": {
            "source": "《江西省古生物化石图册》《江西省古生物化石保护规划（2016—2025年）》",
            "count": len(features),
            "coord_note": "所有坐标均为行政驻地或地名占位，非实测点位；"
                          "coord_approx / coord_error_km 标明精度，不得作为实测坐标引用。",
        },
        "features": features,
    }

    with io.open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, indent=1)
        f.write("\n")

    n_geom = sum(1 for x in features if x["geometry"])
    print("已生成 %s（%d 条要素，%d 个点，%d 条无坐标）" %
          (OUT, len(features), n_geom, len(features) - n_geom))


if __name__ == "__main__":
    build()
