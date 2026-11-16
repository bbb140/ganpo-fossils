/* ============================================================
   js/map.js —— 赣鄱石语 · 江西化石产地地图（天地图版 v2.9）
   v2.9 变更（2026-11-16，v1.2 图册重建版 109 条全量数据）：
   ① 逐条保护级别可用（世界级5 / 国家级17 / 省级87，据《江西省
      古生物化石图册》名录逐条判定），COLOR_BY 切回 'level'——
      这是 v2.5 时预留的路径，当时因 32 条全是"待确认"临时改大区；
   ② 坐标精度新增两档：村级占位（12条，误差 2–5 km）、地名级PBDB
      （9条，据 Paleobiology Database 地名定位）；
   ③ 图例与免责句按新口径动态生成（仍为占位坐标，非实测）。
   依赖：js/config.js（key）、assets/leaflet/leaflet.js + leaflet.css
   数据：data/sites.json（A 岗导出，字段名带括号/单位也能认）
   容器：<div id="map"></div>，CSS 必须有高度
   ============================================================ */

/* 1. 天地图 key 统一放在 js/config.js（window.TDT_KEY），
      本文件不出现 key 明文。页面引入顺序：
      config.js → leaflet.js → map.js */
const TK = (window.TDT_KEY || '').trim();
if (!TK) {
  console.error('[赣鄱石语] 没读到天地图 key：检查 js/config.js 是否已引入、是否填了值。');
}

/* 2. 初始化地图：中心定在江西，zoom 7 正好看全省。
      坐标顺序是 [纬度, 经度]，写反会跑到太平洋。 */
const map = L.map('map').setView([27.8, 115.9], 7);

/* 3. 底图：vec_w 是矢量底图，cva_w 是中文注记，两层缺一不可。
      只加 vec_w 会出现"有地图、没地名"。 */
L.tileLayer('https://t0.tianditu.gov.cn/DataServer?T=vec_w&x={x}&y={y}&l={z}&tk=' + TK, {
  attribution: '&copy; 天地图',
  maxZoom: 18
}).addTo(map);

L.tileLayer('https://t0.tianditu.gov.cn/DataServer?T=cva_w&x={x}&y={y}&l={z}&tk=' + TK, {
  attribution: '&copy; 天地图',
  maxZoom: 18
}).addTo(map);

/* ============================================================
   4. 字段兼容层 → 已抽到 js/fields.js（v2.8）
   原因此前 map.js 里自带一份 normalizeKey/pick/field/F，
   列表页要用就得再抄一份，两份迟早不一致。现在全站只有一份：
   fields.js 提供 normalizeKey / pick / field / toNum / F /
   accErrorKm / isApprox / baseAcc，加载顺序必须在 map.js 之前。
   ============================================================ */

/* 4.2.1 读 URL 上的 code 参数（名录页 → 地图页联动）。
         file:// 下 URLSearchParams 可用，但 location.search 也可能为空，所以都兜住。 */
function readCodeParam() {
  try {
    const p = new URLSearchParams(location.search);
    const c = p.get('code');
    return c ? String(c).trim() : '';
  } catch (e) {
    return '';
  }
}

/* 4.3 配色口径（v2.9）
       v1.2 图册重建版带来逐条保护级别（世界级 5 / 国家级 17 / 省级 87，
       据图册名录判定），COLOR_BY 切回 'level'——红系三档是保护规划的
       核心分类，信息量最大。切回大区配色只需把 'level' 改成 'area'，
       图例计数两种模式都支持。 */
const COLOR_BY = 'level';                // 'level' 按保护级别 | 'area' 按大区

/* 4.4 配色表 → js/fields.js（AREA_COLOR/colorByArea、LEVEL_COLOR/colorByLevel），列表页共用 */

function markerColor(s) {
  /* 小区"未定"（如清江盆地）：A岗裁定不参与分区着色，单列灰色 */
  const zone = field(s, F.zone);
  if (zone.indexOf('未定') > -1) return '#9E9E9E';
  return COLOR_BY === 'level'
    ? colorByLevel(field(s, F.level))
    : colorByArea(field(s, F.region));
}

/* 5. colorByLevel / colorByArea / 配色表 → js/fields.js（v2.9 统一，列表页同色） */

/* 6. 信息卡（弹卡降级版，主展示走 detail.js 侧栏）：
       名称 + 编号 + 位置/年代 + 门类 + 级别 + 精度 + 来源。
       v1.2：级别有逐条真值（图册名录判定），直接上色显示；
       「无」值字段不渲染（地层 98 条、详址 77 条填「无」）。 */
function popupHTML(s) {
  const acc = field(s, F.acc);
  const approx = isApprox(acc);
  const accText = acc || '未标注';
  /* 级别：v1.2 有真值（世界级/国家级/省级）；旧版数据的"待确认"降级显示原因 */
  const lvRaw = field(s, F.level);
  const lvOK = lvRaw && lvRaw.indexOf('待确认') < 0 && lvRaw.indexOf('待核定') < 0 && lvRaw !== '无';
  const lv = lvOK
    ? '<span style="color:' + colorByLevel(lvRaw) + ';font-weight:600">' + lvRaw + '</span>'
    : '<span style="color:#9E9E9E">待核定</span>' +
      '<span style="font-size:11px;color:#999">（来源未逐条给出）</span>';
  const detailLoc = field(s, F.detail);
  const strata = field(s, F.strata);
  return '<div style="min-width:200px;line-height:1.6">' +
    '<b>' + field(s, F.name) + '</b><br>' +
    '<span style="font-size:12px;color:#888">' + field(s, F.code) + '</span><br>' +
    field(s, F.county) + ' · ' + field(s, F.age) + '<br>' +
    '<span style="font-size:12px;color:#666">' +
      field(s, F.region) + ' / ' + field(s, F.zone) + '小区</span><br>' +
    '门类：' + field(s, F.taxa) + '<br>' +
    (hasVal(strata) ? '地层：' + strata + '<br>' : '') +
    (hasVal(detailLoc) ? '详址：' + detailLoc + '<br>' : '') +
    '级别：' + lv + '<br>' +
    '位置：' + (approx
      ? '<span style="color:#EF6C00">' + (accText.indexOf('占位') > -1 || accText === '未标注'
          ? accText : accText + '（占位）') +
        '　误差约 ' + accErrorKm(accText) + '，非实测点位</span>'
      : '<span style="color:#2E7D32">实测点位</span>') + '<br>' +
    '<span style="font-size:12px;color:#666">来源：' + field(s, F.source) + '</span>' +
    '</div>';
}

/* 6.0.1 详情入口：侧栏优先，弹卡降级。focus(code) 与点位 click 共用 */
function openDetail(s, mk) {
  if (window.GBSYDetail && window.GBSYDetail.show(s)) return;
  if (mk) {
    if (!mk.getPopup || !mk.getPopup()) mk.bindPopup(popupHTML(s));
    mk.openPopup();
  }
}

/* 6.0 精度分布摘要：把"村级占位 12 条、县级占位 61 条…"这类统计拼成一句话。
       精度越粗，误差越大：村级 2–5 / 乡级 5–10 / 县级 20–30 / 市级 60–100 km。
       免责句必须说实数，不能只说"县级"——本项目实际混了五档。 */
function accBreakdown(accCount) {
  const order = ['实测', '村级占位', '乡级占位', '县级占位', '市级占位', '地名级'];
  const rank = function (k) {
    for (let i = 0; i < order.length; i++) {
      if (k.indexOf(order[i]) > -1) return i;
    }
    return 99;
  };
  return Object.keys(accCount)
    .sort(function (a, b) { return rank(a) - rank(b); })
    .map(function (k) { return k + ' ' + accCount[k] + ' 条'; })
    .join('、');
}

/* 6.1 免责声明（v2.4）
       必须同时出现在两个地方：
       ① 地图内左下角——截图进 PPT 时会跟着走，逃不掉；
       ② 页面下方 #map-disclaimer——给读者一句完整说明。
       两处都由数据自动决定，没有近似坐标时不显示。 */
function renderDisclaimer(approxCount, total, accCount) {
  /* 先拿到页面下方的占位段落；HTML 里忘了加也能自动补一个 */
  let note = document.getElementById('map-disclaimer');
  if (!note) {
    note = document.createElement('p');
    note.id = 'map-disclaimer';
    note.className = 'map-disclaimer';
    const anchor = document.getElementById('map');
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(note, anchor.nextSibling);
    }
  }

  if (approxCount === 0) {
    if (note) note.textContent = '';
    console.log('[赣鄱石语] 全部为实测坐标，不显示免责声明');
    return;
  }

  const bd = accBreakdown(accCount || {});
  const core = '坐标为行政驻地或地名占位（据图册名录与公开地名，非实地勘测），'
             + '误差约 2–100 km，仅供分布示意，不得作为实测坐标引用。';
  const shortText = '点位为行政驻地/地名占位，误差约 2–100 km，不得作为实测坐标引用。';

  const ctl = L.control({ position: 'bottomleft' });
  ctl.onAdd = function () {
    const d = L.DomUtil.create('div');
    d.style.cssText = 'background:rgba(255,255,255,.92);padding:4px 8px;' +
      'border-radius:3px;font-size:11px;color:#555;max-width:min(330px,62vw);line-height:1.5';
    d.textContent = '说明：' + shortText;
    L.DomEvent.disableClickPropagation(d);
    return d;
  };
  ctl.addTo(map);

  if (note) {
    const head = (approxCount === total)
      ? '本图共 ' + total + ' 条产地记录，点位全部为占位坐标（' + bd + '）。'
      : '本图共 ' + total + ' 条产地记录，其中 ' + approxCount +
        ' 条为占位坐标（' + bd + '）。';
    note.textContent = head + core;
  }

  console.log('[赣鄱石语] 免责声明已渲染：占位 ' + approxCount + ' / 共 ' + total + ' 条｜' + bd);
}

/* 7. 读数据：有坐标的打点，没坐标的进下方列表并标"坐标待补"。
      注意：数据出问题只会少点位，不会让整张地图消失；
      地图整片空白一定是 CSS 高度或瓦片的问题。 */
/* 7. 数据源：优先用内联数据，其次 fetch 本地 json。
      为什么要两条路：
      ① 开发时用 Live Server（http://）→ 走 fetch，改 sites.json 刷新就生效；
      ② 拷给别人/拷到 U 盘双击打开（file://）→ 浏览器禁止 fetch 本地文件，
         此时若没有内联数据，地图上会一个点都没有。dist 版由
         tools/build_offline.py 生成 js/data-inline.js（window.SITES_DATA），
         双击 map.html 也能正常出点。 */
const dataSource = (typeof window !== 'undefined' && window.SITES_DATA)
  ? Promise.resolve(window.SITES_DATA)
  : fetch('./data/sites.json').then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);   // 404 会在这里抛出
      return res.json();
    });

dataSource
  .then(function (raw) {
    const sites = Array.isArray(raw) ? raw : (raw.sites || raw.data || []);
    let shown = 0;
    let approxCount = 0;
    const missing = [];
    const accCount = {};                       // 精度分布：{ '县级占位': 61, ... }
    const areaCount = {};                      // 大区分布：{ '赣西北': 14, ... }
    const levelCount = {};                     // 级别分布：{ '省级': 87, ... }（v2.9 图例用）
    const points = [];                         // { rec, marker }：供检索/列表联动
    let levelPending = 0;                      // 级别未核定的条数

    sites.forEach(function (s) {
      const lat = toNum(field(s, F.lat));
      const lon = toNum(field(s, F.lon));
      const ok = !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;

      if (!ok) { missing.push(s); return; }          // 没坐标先跳过，不报错

      const acc = field(s, F.acc) || '未标注';
      const approx = isApprox(acc);
      // 统计时去掉括号补充说明，如「乡级占位（重名选其一）」并入「乡级占位」
      const accKey = acc.replace(/[（(][^）)]*[）)]/g, '').trim() || acc;
      accCount[accKey] = (accCount[accKey] || 0) + 1;
      if (approx) approxCount++;

      // 大区计数（图例要显示每区几条，和图上的颜色对得上）
      // 小区「未定」的点（如清江盆地）单独计入"未定"，不混进大区
      const reg = field(s, F.region) || '未填大区';
      const zoneRaw = field(s, F.zone);
      const undecided = zoneRaw.indexOf('未定') > -1 || reg.indexOf('未定') > -1;
      areaCount[undecided ? '未定' : reg] = (areaCount[undecided ? '未定' : reg] || 0) + 1;

      // 级别统计：真值进 levelCount（图例显示），待确认进 levelPending（自检日志）
      const lvRaw = field(s, F.level);
      if (!lvRaw || lvRaw.indexOf('待确认') > -1 || lvRaw.indexOf('待核定') > -1 || lvRaw === '无') {
        levelPending++;
      } else {
        levelCount[lvRaw] = (levelCount[lvRaw] || 0) + 1;
      }

      /* 占位点样式（A岗要求）：半透明填充 + 同色虚线描边 = 一眼看出"不是实测"；
         实测点（未来 A-05 升级后出现）才是实心 + 白描边 */
      const mc = markerColor(s);
      const mk = L.circleMarker([lat, lon], {
        radius: approx ? 7 : 6,
        color: approx ? mc : '#fff',
        weight: approx ? 2 : 1.5,
        dashArray: approx ? '4 3' : null,            // 虚线描边 = 行政驻地占位
        fillColor: mc,
        fillOpacity: approx ? 0.25 : 0.9             // 半透明 = 占位
      }).addTo(map);
      /* 详情侧栏（P1-5）：detail.js 加载了走侧栏；没加载（极端情况）退回弹卡。
         弹卡不放默认绑定——手机上 popup 会被挡，且 16 字段塞不下 */
      mk.on('click', function () { openDetail(s, mk); });
      points.push({ rec: s, marker: mk, lat: lat, lon: lon });

      shown++;
    });

    /* 7.1 无坐标记录列表（死线一验收要求：必须列出并标"坐标待补"） */
    const box = document.getElementById('no-coord-list');
    if (box) {
      let html = '';
      if (missing.length === 0) {
        html = '<li class="ok">全部记录均有坐标</li>';
      } else {
        html = missing.map(function (s) {
          return '<li>' + field(s, F.name) +
                 ' <span class="tag">坐标待补</span></li>';
        }).join('');
      }
      // 占位坐标要单独交代清楚，不能混在"有坐标"里糊过去
      if (approxCount > 0) {
        html += '<li class="ok">其中 ' + approxCount + ' 条为占位坐标（' +
                accBreakdown(accCount) + '），图上以半透明虚线圆标示</li>';
      }
      box.innerHTML = html;
    }

    /* 7.2 免责声明（地图内 + 页面下方都写） */
    renderDisclaimer(approxCount, shown, accCount);

    /* 7.2 图例回填：两种配色口径的计数都传（v2.9 主用级别，大区备用） */
    legendCounts = COLOR_BY === 'level' ? levelCount : areaCount;
    legendStats = { placeholder: approxCount, total: shown };
    renderLegend(legendCounts);

    /* 7.3 自检日志 */
    console.log('[赣鄱石语] 数据共 ' + sites.length + ' 条，上图 ' + shown +
                ' 条（占位 ' + approxCount + ' 条），无坐标 ' + missing.length + ' 条');
    console.log('[赣鄱石语] 配色口径：' + COLOR_BY + '｜级别分布：' +
                Object.keys(levelCount).map(function (k) {
                  return k + ' ' + levelCount[k];
                }).join('、') + '｜大区分布：' +
                Object.keys(areaCount).map(function (k) {
                  return k + ' ' + areaCount[k];
                }).join('、'));
    if (levelPending > 0) {
      console.warn('[赣鄱石语] 注意：' + levelPending + '/' + shown +
                   ' 条记录的「产地保护级别」未核定，图上不按级别配色');
    }
    if (shown > 0) {
      const b = L.latLngBounds(sites
        .map(function (s) { return [toNum(field(s, F.lat)), toNum(field(s, F.lon))]; })
        .filter(function (c) { return !isNaN(c[0]) && !isNaN(c[1]); }));
      if (b.isValid()) map.fitBounds(b.pad(0.15));   // 自动缩放到数据范围
    }

    /* 7.4 对外接口：检索/列表靠它拿数据、控制点位显隐（v2.7）
           - points: [{ rec, marker, lat, lon }]
           - applyFilter(fn): 按记录判定显示/隐藏，返回可见条数
           - focus(code): 打开某条记录的弹卡并居中（列表页跳转用）
           数据是异步加载的，所以再派发一个 gbsy:ready 事件，
           让 js/filter.js、js/list.js 不用轮询。 */
    window.GBSY = {
      version: '2.9',
      map: map,
      sites: sites,
      points: points,
      field: field,          // 供 filter.js / list.js 按别名取字段
      F: F,
      show: shown,
      applyFilter: function (fn) {
        let n = 0;
        points.forEach(function (p) {
          const on = !!fn(p.rec);
          const has = map.hasLayer(p.marker);
          if (on && !has) p.marker.addTo(map);
          if (!on && has) map.removeLayer(p.marker);
          if (on) n++;
        });
        return n;
      },
      focus: function (code) {
        const p = points.filter(function (x) {
          return field(x.rec, F.code) === code;
        })[0];
        if (!p) return false;
        map.setView([p.lat, p.lon], Math.max(map.getZoom(), 10));
        openDetail(p.rec, p.marker);       // 侧栏优先（名录页 ?code= 跳转走这里）
        return true;
      }
    };
    /* 7.5 从名录页跳过来（map.html?code=JX-02-04-001）：定位到该点并打开弹卡。
           code 必须在 gbsy:ready 之前读——js/filter.js 在同一事件里同步 URL，
           会把 ?code= 改写成筛选参数，之后再读就没了。 */
    const wantCode = readCodeParam();

    /* gbsy:ready 的派发时机（两版踩坑后的结论）：
       ① 不能同步派发——内联数据的 Promise 回调在 map.js 脚本一结束就以微任务
          执行，比 filter.js/detail.js 的脚本抓取还早，派发时没有监听者；
       ② 也不能只靠 setTimeout(0)——定时器可能在后续脚本（filter.js/detail.js）
          尚未加载完时就被执行（2026-11-15 无头浏览器实测抓到）；
       ③ 挂 DOMContentLoaded：所有同步脚本必然已执行完，监听者一定在。
          在线版数据走 fetch，回调通常晚于 DOMContentLoaded，走 setTimeout 兜底。 */
    const readyDetail = { sites: sites, points: points };
    const fireReady = function () {
      document.dispatchEvent(new CustomEvent('gbsy:ready', { detail: readyDetail }));

      if (wantCode) {
        const hit = window.GBSY.focus(wantCode);
        if (hit) {
          console.log('[赣鄱石语] 已按 URL 参数定位：' + wantCode);
        } else {
          console.warn('[赣鄱石语] URL 里的 code=' + wantCode + ' 在数据中不存在，忽略');
        }
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fireReady);
    } else {
      setTimeout(fireReady, 0);
    }
  })
  .catch(function (err) {
    console.error('[赣鄱石语] 数据读取失败：', err,
                  '｜若地址栏是 file:// 开头，说明是双击打开的——浏览器禁止读本地 json，' +
                  '要么改用 Live Server（http://），要么用 dist/ 里带内联数据的版本');
  });

/* 8. 图例：配色口径必须与图上实际颜色一致，列出来的每一档都得真的能出现 */
let legendDiv = null;
let legendCounts = null;           // { '赣西北': 3, ... } 数据加载后回填
let legendStats = null;            // { placeholder: 32, total: 32 } 占位/总数

function renderLegend(counts) {
  if (!legendDiv) return;
  let body = '';
  if (COLOR_BY === 'level') {
    body = '<div style="font-weight:bold;margin-bottom:2px">保护级别</div>';
    for (const k in LEVEL_COLOR) {
      const n = counts && counts[k] != null ? counts[k] : null;
      body += legendRow(LEVEL_COLOR[k], k + (n == null ? '' : '　' + n));
    }
    if (counts && counts['待核定']) {
      body += legendRow('#9E9E9E', '待核定　' + counts['待核定']);
    }
  } else {
    body = '<div style="font-weight:bold;margin-bottom:2px">保护分区（大区）</div>';
    for (const k in AREA_COLOR) {
      const n = counts && counts[k] != null ? counts[k] : null;
      body += legendRow(AREA_COLOR[k], k + (n == null ? '' : '　' + n));
    }
    /* 小区「未定」的点单列灰色（A岗裁定：清江盆地不参与分区着色） */
    if (counts && counts['未定']) {
      body += legendRow('#9E9E9E', '未定　' + counts['未定']);
    }
  }
  /* 占位说明行：样式与图上占位点一致（半透明+虚线描边），文字带实数 */
  const st = legendStats;
  const phText = st
    ? (st.placeholder === st.total
        ? '全部点位为占位坐标（' + st.total + '/' + st.total + '，非实测）'
        : '占位坐标 ' + st.placeholder + '/' + st.total + '（半透明虚线）')
    : '点位为占位坐标（非实测）';
  legendDiv.innerHTML = body +
    '<div style="margin-top:4px;padding-top:4px;border-top:1px solid #ddd">' +
      '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;' +
      'border:2px dashed #555;background:rgba(85,85,85,.25);margin-right:5px"></span>' +
      phText + '</div>' +
    '<div style="margin-top:3px;font-size:11px;color:#888;max-width:min(180px,36vw);' +
      'line-height:1.45">逐条级别据《江西省古生物化石图册》名录判定（世界级5 / ' +
      '国家级17 / 省级87）；规划正文口径为 5/20/84，两套统计口径略有出入</div>';
}

function legendRow(color, label) {
  return '<div><span style="display:inline-block;width:9px;height:9px;border-radius:50%;' +
    'background:' + color + ';margin-right:5px"></span>' + label + '</div>';
}

(function addLegend() {
  const legend = L.control({ position: 'bottomright' });
  legend.onAdd = function () {
    legendDiv = L.DomUtil.create('div');
    legendDiv.style.cssText = 'background:rgba(255,255,255,.94);padding:6px 8px;' +
      'border-radius:4px;font-size:12px;line-height:1.75;color:#222;' +
      'max-width:min(190px,46vw);' +
      'box-shadow:0 1px 4px rgba(0,0,0,.2)';
    renderLegend(legendCounts);
    L.DomEvent.disableClickPropagation(legendDiv);   // 点图例不触发地图拖动
    return legendDiv;
  };
  legend.addTo(map);
})();

/* 9. 分区着色层（下一步）：拿到 data/districts.geojson 后取消注释即可。
      着色口径两种：产地总数 / 世界级数量，用变量切换。 */
// let colorMode = 'total';   // 'total' | 'world'
// fetch('./data/districts.geojson')
//   .then(function (r) { return r.json(); })
//   .then(function (gj) {
//     L.geoJSON(gj, {
//       style: function (f) {
//         const v = colorMode === 'world' ? f.properties.world : f.properties.total;
//         return { color: '#0D3B66', weight: 1, fillColor: scaleColor(v), fillOpacity: 0.35 };
//       }
//     }).bindPopup(function (l) {
//       const p = l.feature.properties;
//       return '<b>' + p.name + '</b><br>产地 ' + p.total + ' 处<br>世界级 ' + p.world + ' 处';
//     }).addTo(map);
//   });
