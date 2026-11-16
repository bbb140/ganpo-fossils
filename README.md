# 赣鄱石语 · 江西古生物化石产地科普站

把《江西省古生物化石保护规划（2016—2025 年）》的四大保护分区，做成一张能点开、能检索的分布图。

**线上地址**：https://\<用户名\>.github.io/ganpo-fossils/ （首次部署后填这里）

## 页面

| 页面 | 内容 |
|---|---|
| `index.html` | 数据速览、四大保护分区（条数/小区构成/产地表/门类），全部由数据渲染 |
| `map.html` | 天地图底图 + 109 处产地，按保护级别配色（世界级5/国家级17/省级87），支持关键词与四组筛选，点开右侧详情 |
| `list.html` | 名录表格，可排序、可筛选、可导出 CSV，点行跳地图定位 |
| `download.html` | 数据下载、16 个字段说明、引用格式、使用限制 |

## 本地看

**只想看效果**：`dist/index.html` 双击即可（数据已内联，不需要服务器）。

**改代码时**用本地服务器，改完刷新就生效：

```bash
python -m http.server 8000
# 浏览器打开 http://127.0.0.1:8000/map.html
```

## 数据更新（A 岗回传新表后）

```bash
python tools/build_data.py --src 新表.xlsx          # 先看差异，不覆盖
python tools/build_data.py --src 新表.xlsx --apply  # 确认后替换（自动备份到 data/backup/）
python tools/validate_data.py                       # 6 组校验，0 错误才算过
python tools/build_offline.py --dist                # 重建 dist 与离线包
```

`validate_data.py` 同时是**字段契约**：A 岗改列名会直接报错，不会静默变空。

## 部署

推送到 main 后由 `.github/workflows/pages.yml` 自动构建发布，构建前先跑数据校验，有错误就不发。

```bash
bash tools/deploy.sh <GitHub用户名>       # 首次：设 remote 并推送
git push                                  # 之后：改完推就行
```

首次部署需在仓库 Settings → Pages → Source 选 **GitHub Actions**。

## 数据口径（对外必须一致的三句话）

1. **收录全部 109 处产地档案**，据《江西省古生物化石图册》名录逐条重建，覆盖 12 个保护小区，逐条信息可溯源（图册表号 + 规划条款 + 归并依据）。
2. **所有坐标为行政驻地或地名占位，非实测点位**（村级 2–5 / 乡级 5–10 / 县级 20–30 / 市级 60–100 / 地名级PBDB 20–30 km），不得作为实测坐标引用。图上用半透明虚线点区分，实测点升级后自动变实心。
3. **逐条保护级别据图册名录判定：世界级 5 / 国家级 17 / 省级 87**；规划正文口径为 5/20/84，两者略有出入，属两套统计口径。赋存地层图册未提供者 98 条标「无」，待文献补充。

## 目录

```
css/ js/ *.html          源码（fields.js 是字段层，map/main/list/filter/detail 共用）
data/sites.json          产地数据（v1.2 图册重建版：109 条 × 17 列英文键）
data/表1_分区基本特征.csv  规划表 1 的 15 行，109 口径的来源
assets/leaflet/          Leaflet 1.9.4 本地化，不依赖 CDN
tools/                   构建、校验、测试、部署脚本
dist/                    构建产物（已 gitignore，由 Actions 生成）
```
