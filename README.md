# 赣鄱石语 · 江西古生物化石产地科普站

把《江西省古生物化石保护规划（2016—2025 年）》的四大保护分区，做成一张能点开、能检索的分布图。

**线上地址**：https://\<用户名\>.github.io/ganpo-fossils/ （首次部署后填这里）

## 页面

| 页面 | 内容 |
|---|---|
| `index.html` | 数据速览、四大保护分区（条数/小区构成/产地表/门类），全部由数据渲染 |
| `map.html` | 天地图底图 + 32 个产地，按大区配色，支持关键词与四组筛选，点开右侧详情 |
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

1. **收录 32 条，规划口径全省 109 处**。逐条清单在规划《附表 4》，未随正文公开，缺口按周补。
2. **所有坐标为行政区驻地占位，非实测点位**，误差 5–100 km，不得作为实测坐标引用。图上用半透明虚线点区分，实测点升级后自动变实心。
3. **逐条保护级别待核定**，同样在《附表 4》未公开；目前只到小区级汇总（5 世界级 / 20 国家级 / 84 省级）。

## 目录

```
css/ js/ *.html          源码（fields.js 是字段层，map/main/list/filter/detail 共用）
data/sites.json          产地数据（32 条 × 16 列）
data/表1_分区基本特征.csv  规划表 1 的 15 行，109 口径的来源
assets/leaflet/          Leaflet 1.9.4 本地化，不依赖 CDN
tools/                   构建、校验、测试、部署脚本
dist/                    构建产物（已 gitignore，由 Actions 生成）
```
