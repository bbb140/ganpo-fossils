/* ============================================================
   js/fields.js —— 字段兼容层（map.js / list.js / filter.js 共用）
   抽出原因：A 岗导出的列名带括号和单位，如「经度（°E）」「所在市（县）」
   「数据来源（文献/页码）」。地图页要认、列表页也要认，抄两份必然漂移，
   所以只留这一份。**这个文件必须是全局脚本，且在任何使用方之前加载。**

   加载顺序：fields.js →（map.js）→ filter.js / list.js
   ============================================================ */

/* 归一化：去掉括号内容（全角半角都算）+ 去掉度号与空白。
   于是「经度（°E）」→「经度」，和别名里的「经度」对上了。 */
function normalizeKey(k) {
  return String(k)
    .replace(/[（(][^）)]*[）)]/g, '')   // 去掉括号及其内容
    .replace(/[°\s\u00a0]/g, '');       // 去掉度号与空白
}

function pick(s, names) {
  if (!s) return '';
  // ① 精确匹配
  for (let i = 0; i < names.length; i++) {
    const v = s[names[i]];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  // ② 归一化模糊匹配
  const keys = Object.keys(s);
  for (let i = 0; i < keys.length; i++) {
    const nk = normalizeKey(keys[i]);
    for (let j = 0; j < names.length; j++) {
      if (nk === normalizeKey(names[j])) {
        const v = s[keys[i]];
        if (v !== undefined && v !== null && v !== '') return v;
      }
    }
  }
  return '';
}

function field(s, names) {
  const v = pick(s, names);
  return (v === undefined || v === null) ? '' : String(v);
}

/* 数字解析：容忍 "115.51"、"115.51°E"、115.51 三种写法 */
function toNum(v) {
  if (typeof v === 'number') return v;
  const m = String(v).replace(/[,，\s]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/* 各字段的别名表（英文优先，中文兜底）。
   改这张表等于改"数据契约"——tools/validate_data.py 校验的是同一批列名。
   2026-11-16 v1.2（图册重建版）：A 岗改出英文 17 列（109 条），
   英文别名全部排第一，旧中文列名保留——两版数据都能读。 */
const F = {
  code:   ['id', '记录编号'],
  name:   ['name', '产地名称'],
  region: ['region', '保护分区（大区）', '保护分区', '大区'],
  zone:   ['subregion', 'zone', '分区小区', '小区'],
  county: ['city_county', 'county', '所在市（县）', '所在市县', '行政区'],
  detail: ['detail_location', '详细位置', '详址'],
  taxa:   ['fossil_group', 'taxa', '主要化石门类', '化石类型', '门类'],
  age:    ['geological_age', 'age', '地质年代', '年代'],
  strata: ['stratum', 'strata', '赋存地层（组/群）', '赋存地层'],
  level:  ['protection_level', 'level', '产地保护级别', '保护级别'],
  status: ['protection_status', 'protect', '保护区状态'],
  lon:    ['longitude', 'lon', 'lng', '经度（°E）', '经度'],
  lat:    ['latitude', 'lat', '纬度（°N）', '纬度'],
  acc:    ['coord_precision', 'acc', '坐标精度', '精度'],
  dstat:  ['data_status', 'dstat', '数据状态'],
  source: ['data_source', 'source', '数据来源（文献/页码）', '数据来源', '来源'],
  note:   ['remarks', 'note', '备注']
};

/* v1.2 的空值写法是「无」而不是空串（stratum 98 条、detail_location 77 条填「无」）。
   展示层统一用它过滤，避免读者看到一排"无"。 */
function hasVal(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return s !== '' && s !== '无' && s !== '—' && s !== '-';
}

/* 保护级别配色（v1.2 起逐条级别可用：世界级5 / 国家级17 / 省级87）。
   与地图、列表、图例共用。 */
const LEVEL_COLOR = {
  '世界级': '#8B0000',
  '国家级': '#C62828',
  '省级':   '#1565C0'
};

function colorByLevel(level) {
  const s = String(level || '');
  for (const k in LEVEL_COLOR) {
    if (s.indexOf(k) > -1) return LEVEL_COLOR[k];
  }
  return '#9E9E9E';                      // 未定 / 未填 → 灰
}

/* 精度档 → 误差公里数。v1.2 档位：村级12 / 乡级8 / 县级61 / 市级19 / 地名级PBDB 9，
   全部为行政驻地或地名占位（A岗：不估读、不编坐标）。 */
function accErrorKm(acc) {
  const a = String(acc || '');
  if (a.indexOf('村级') > -1) return '2–5 km';
  if (a.indexOf('乡级') > -1) return '5–10 km';
  if (a.indexOf('县级') > -1) return '20–30 km';
  if (a.indexOf('市级') > -1) return '60–100 km';
  if (a.indexOf('地名') > -1) return '20–30 km';
  if (/实测|GPS/i.test(a)) return '实测';
  return '数公里至数十公里';
}

/* 是否实测（实测点画实心，占位点画半透明虚线） */
function isApprox(acc) {
  if (!acc) return true;                             // 没标精度 = 当近似处理
  if (/实测|GPS/i.test(acc)) return false;
  return true;
}

/* 去掉括号补充说明，如「乡级占位（重名选其一）」→「乡级占位」 */
function baseAcc(acc) {
  return String(acc || '').replace(/[（(][^）)]*[）)]/g, '').trim() || String(acc || '');
}

/* 四大区配色：地图点位、列表小圆点、图例共用同一份，避免"图上深蓝、表里浅蓝" */
const AREA_COLOR = {
  '赣西北': '#1F5C99',
  '赣东北': '#A8324A',
  '赣西':   '#6A4C93',
  '赣东南': '#2E7D5B'
};

function colorByArea(region) {
  const r = String(region || '');
  for (const k in AREA_COLOR) {
    if (r.indexOf(k) > -1) return AREA_COLOR[k];
  }
  return '#9E9E9E';                      // 大区未填 / 未定 → 灰
}

/* 单测入口 */
if (typeof window !== 'undefined') {
  window.GBSYFields = { field: field, pick: pick, F: F, toNum: toNum,
                        baseAcc: baseAcc, accErrorKm: accErrorKm, isApprox: isApprox,
                        hasVal: hasVal,
                        AREA_COLOR: AREA_COLOR, colorByArea: colorByArea,
                        LEVEL_COLOR: LEVEL_COLOR, colorByLevel: colorByLevel };
}
