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
   改这张表等于改"数据契约"——tools/validate_data.py 校验的是同一批列名。 */
const F = {
  code:   ['id', '记录编号'],
  name:   ['name', '产地名称'],
  region: ['region', '保护分区（大区）', '保护分区', '大区'],
  zone:   ['zone', '分区小区', '小区'],
  county: ['county', '所在市（县）', '所在市县', '行政区'],
  taxa:   ['taxa', '主要化石门类', '化石类型', '门类'],
  age:    ['age', '地质年代', '年代'],
  strata: ['strata', '赋存地层（组/群）', '赋存地层'],
  level:  ['level', '产地保护级别', '保护级别'],
  status: ['protect', '保护区状态'],
  lon:    ['lon', 'lng', '经度（°E）', '经度'],
  lat:    ['lat', '纬度（°N）', '纬度'],
  acc:    ['acc', '坐标精度', '精度'],
  dstat:  ['dstat', '数据状态'],
  source: ['source', '数据来源（文献/页码）', '数据来源', '来源'],
  note:   ['note', '备注']
};

/* 精度档 → 误差公里数。A岗 2026-11-08 确认 32 条全为行政驻地占位，
   分档写进弹卡与列表，读者不用自己猜。 */
function accErrorKm(acc) {
  const a = String(acc || '');
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
                        AREA_COLOR: AREA_COLOR, colorByArea: colorByArea };
}
