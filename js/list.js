/* ============================================================
   js/list.js —— 产地名录（表格视图，C 岗「第四步」的第二种表达）
   依赖：js/fields.js（field / F / baseAcc / accErrorKm / colorByArea）
   数据：window.SITES_DATA（dist 离线版）优先，否则 fetch ./data/sites.json
   页面：list.html

   为什么要有这张表（而不是只做地图）：
   1) 地图只能看空间分布，"某县到底有哪些点"看不出来；
   2) 表格可排序、可复制、可打印，老师/评委翻起来比点图快；
   3) 全部记录都是驻地占位坐标，只给图会让人误以为是实测点位，
      表格把"精度"单列一列，配合底部说明，口径一次说清。

   设计要点：
   - 筛选规则与 js/filter.js 完全一致（大区精确比较、小区全等、精度去括号），
     两页不会出现"地图 5 条、名录 6 条"的情况；
   - 点任意一行 → map.html?code=JX-… ，地图页读参数自动定位并打开弹卡；
   - 可"导出当前筛选结果"为 CSV，方便离线核对。
   ============================================================ */
(function () {
  'use strict';

  const FD = window.GBSYFields || {};
  const F = FD.F || {};
  const baseAcc = FD.baseAcc || function (a) { return String(a || ''); };
  const accErrorKm = FD.accErrorKm || function () { return ''; };
  const colorByArea = FD.colorByArea || function () { return '#9E9E9E'; };
  const colorByLevel = FD.colorByLevel || function () { return '#9E9E9E'; };
  const hasVal = FD.hasVal || function (v) {
    const t = String(v == null ? '' : v).trim();
    return t !== '' && t !== '无' && t !== '—' && t !== '-';
  };

  const $ = function (id) {
    return (typeof document !== 'undefined' && document.getElementById)
      ? document.getElementById(id) : null;
  };

  const state = { q: '', area: '', zone: '', acc: '', status: '', sort: 'code', dir: 1 };
  let sites = [];

  /* ---------- 取值 ---------- */
  function val(rec, key) { return String(FD.field(rec, F[key]) || ''); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  /* 长文本进表格要截断，否则一列把整张表撑开 */
  function cut(s, n) {
    const t = String(s || '').trim();
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  }
  function shortZone(z) {
    const m = String(z || '').match(/^([^（(]+)[（(](.+)[）)]$/);
    if (!m) return z || '—';
    const body = m[2].replace(/、/g, '/');
    return m[1].trim() + '·' + (body.length > 12 ? body.slice(0, 11) + '…' : body);
  }

  /* ---------- 纯函数：匹配（与 filter.js 同规则） ---------- */
  function hay(rec) {
    return [val(rec, 'name'), val(rec, 'code'), val(rec, 'county'), val(rec, 'taxa'),
            val(rec, 'strata'), val(rec, 'age'), val(rec, 'note')].join(' ').toLowerCase();
  }
  function match(rec) {
    if (state.q && hay(rec).indexOf(String(state.q).toLowerCase()) < 0) return false;
    /* 大区必须精确比较：用 indexOf 会让「赣西」把「赣西北」吞进来 */
    if (state.area && val(rec, 'region').replace(/大区|\s/g, '') !== state.area) return false;
    if (state.zone && val(rec, 'zone') !== state.zone) return false;
    if (state.acc && baseAcc(val(rec, 'acc')) !== state.acc) return false;
    if (state.status && val(rec, 'dstat') !== state.status) return false;
    return true;
  }

  /* ---------- 纯函数：排序 ---------- */
  function sortRows(rows) {
    const k = state.sort, dir = state.dir;
    const cp = function (a, b) {
      const va = val(a, k), vb = val(b, k);
      const r = va.localeCompare(vb, 'zh-Hans-CN', { numeric: true });
      /* 同值时用编号兜底，保证每次排序结果稳定（刷新不会换位） */
      return r !== 0 ? r : val(a, 'code').localeCompare(val(b, 'code'));
    };
    return rows.slice().sort(function (a, b) { return cp(a, b) * dir; });
  }

  function view() { return sortRows(sites.filter(match)); }

  /* ---------- 渲染一行 ---------- */
  function rowHTML(rec) {
    const code = val(rec, 'code');
    const region = val(rec, 'region').replace(/大区/g, '');
    const zone = val(rec, 'zone');
    const acc = val(rec, 'acc') || '未标注';
    const measured = /实测|GPS/i.test(acc);
    /* 级别（v2.9 有逐条真值）：带色显示，与地图点位同色 */
    const lv = val(rec, 'level');
    const lvOK = lv && lv.indexOf('待') < 0 && lv !== '无';
    /* 状态值已是短词（已核验 / 按县域推定 / 存疑），直接显示 */
    const dstatShort = val(rec, 'dstat') || '—';
    return '<tr class="row" data-code="' + esc(code) + '" tabindex="0">' +
      '<td class="c-code">' + esc(code) + '</td>' +
      '<td class="c-name">' + esc(val(rec, 'name')) + '</td>' +
      '<td>' + esc(val(rec, 'county')) + '</td>' +
      '<td><span class="zone-dot" style="background:' + colorByArea(region) + '"></span>' +
        esc(region || '—') + ' <span class="zone-sub">' + esc(shortZone(zone)) + '</span></td>' +
      '<td>' + esc(val(rec, 'age')) + '</td>' +
      '<td>' + esc(cut(val(rec, 'taxa'), 22)) + '</td>' +
      '<td>' + (lvOK
        ? '<span style="color:' + colorByLevel(lv) + ';font-weight:600">' + esc(lv) + '</span>'
        : '<span class="zone-sub">未定级</span>') + '</td>' +
      '<td class="col-hide-sm">' + esc(cut(hasVal(val(rec, 'strata')) ? val(rec, 'strata') : '—', 26)) + '</td>' +
      '<td><span class="badge ' + (measured ? 'badge-ok' : 'badge-soft') + '">' +
        esc(baseAcc(acc)) + '</span>' +
        '<span class="acc-km">' + esc(accErrorKm(acc)) + '</span></td>' +
      '<td class="col-hide-sm"><span class="badge badge-plain">' +
        esc(dstatShort) + '</span></td>' +
      '<td class="col-act"><a class="row-go" href="map.html?code=' +
        encodeURIComponent(code) + '" title="在地图上定位">定位</a></td>' +
    '</tr>';
  }

  /* ---------- 下拉选项 ---------- */
  const ACC_ORDER = ['实测', '村级占位', '乡级占位', '县级占位', '市级占位', '地名级'];
  function fillSelect(sel, items, placeholder) {
    if (!sel) return;
    let html = '<option value="">' + placeholder + '</option>';
    items.forEach(function (it) {
      html += '<option value="' + esc(it.value) + '">' + esc(it.label) +
              (it.count != null ? '（' + it.count + '）' : '') + '</option>';
    });
    sel.innerHTML = html;
  }
  function countBy(getter) {
    const c = {};
    sites.forEach(function (r) { const k = getter(r); if (k) c[k] = (c[k] || 0) + 1; });
    return c;
  }

  /* ---------- 主渲染 ---------- */
  function render() {
    const rows = view();
    const tb = $('lst-tbody');
    if (tb) {
      tb.innerHTML = rows.length
        ? rows.map(rowHTML).join('')
        : '<tr><td colspan="11" class="note">没有匹配的记录：换个关键词，或点「重置」看全部 ' +
          sites.length + ' 条。</td></tr>';
    }

    const cnt = $('lst-count');
    if (cnt) cnt.textContent = '显示 ' + rows.length + ' / ' + sites.length + ' 条';

    const hint = $('lst-hint');
    if (hint) {
      const active = state.q || state.area || state.zone || state.acc || state.status;
      if (rows.length === 0) {
        hint.textContent = '无结果';
        hint.className = 'filter-hint warn';
      } else if (active) {
        hint.textContent = '已按条件筛选';
        hint.className = 'filter-hint';
      } else {
        hint.textContent = '';
        hint.className = 'filter-hint';
      }
    }

    /* 排序箭头：只标当前列，方向用 ▲▼ */
    if (typeof document !== 'undefined' && document.querySelectorAll) {
      document.querySelectorAll('th.sortable').forEach(function (th) {
        const on = th.getAttribute('data-key') === state.sort;
        th.classList.toggle('sorted', on);
        th.setAttribute('data-dir', on ? (state.dir > 0 ? '▲' : '▼') : '');
      });
    }
    if (typeof window !== 'undefined') window.GBSYListRows = rows;
    return rows;
  }

  /* ---------- 统计头 ---------- */
  function renderHead() {
    const t = $('lst-total');
    if (t) t.textContent = sites.length;
    const zones = {};
    sites.forEach(function (r) {
      const z = val(r, 'zone');
      /* 只数 12 个标准小区：「其它（…）」「未定（…）」不算覆盖 */
      if (z && !/^(其它|未定|待确认)/.test(z)) zones[z.split('（')[0]] = 1;
    });
    const zn = $('lst-zones');
    if (zn) zn.textContent = Object.keys(zones).length;
  }

  /* ---------- CSV 导出（当前筛选结果，不是全量） ---------- */
  const CSV_COLS = [
    ['code', '编号'], ['name', '产地名称'], ['county', '所在市县'],
    ['region', '保护分区（大区）'], ['zone', '分区小区'],
    ['detail', '详细位置'], ['age', '地质年代'],
    ['taxa', '主要化石门类'], ['strata', '赋存地层（组/群）'],
    ['level', '产地保护级别'],
    ['lon', '经度（°E）'], ['lat', '纬度（°N）'],
    ['acc', '坐标精度'], ['dstat', '数据状态'], ['source', '数据来源'],
    ['note', '备注']
  ];
  function toCSV(rows) {
    const q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    const head = CSV_COLS.map(function (c) { return q(c[1]); }).join(',');
    const body = rows.map(function (r) {
      return CSV_COLS.map(function (c) { return q(val(r, c[0])); }).join(',');
    });
    /* BOM：不加，Excel 打开中文会乱码 */
    return '\ufeff' + [head].concat(body).join('\r\n');
  }
  function downloadCSV() {
    if (typeof Blob === 'undefined' || typeof document === 'undefined') return 0;
    const rows = view();
    const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '赣鄱石语_产地名录_' + rows.length + '条.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    return rows.length;
  }

  /* ---------- 交互 ---------- */
  function readURL() {
    try {
      const p = new URLSearchParams(location.search);
      ['q', 'area', 'zone', 'acc', 'status'].forEach(function (k) {
        const v = p.get(k);
        if (v) state[k] = v;
      });
    } catch (e) { /* file:// 忽略 */ }
  }
  function syncURL() {
    try {
      const p = new URLSearchParams();
      ['q', 'area', 'zone', 'acc', 'status'].forEach(function (k) {
        if (state[k]) p.set(k, state[k]);
      });
      const qs = p.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    } catch (e) { /* file:// 忽略 */ }
  }

  function bind() {
    [['lst-q', 'q'], ['lst-area', 'area'], ['lst-zone', 'zone'],
     ['lst-acc', 'acc'], ['lst-status', 'status']].forEach(function (pair) {
      const el = $(pair[0]);
      if (!el || !el.addEventListener) return;
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', function () {
        state[pair[1]] = String(el.value || '').trim();
        render(); syncURL();
      });
    });

    const reset = $('lst-reset');
    if (reset && reset.addEventListener) {
      reset.addEventListener('click', function () {
        ['q', 'area', 'zone', 'acc', 'status'].forEach(function (k) { state[k] = ''; });
        ['lst-q', 'lst-area', 'lst-zone', 'lst-acc', 'lst-status'].forEach(function (id) {
          const el = $(id); if (el) el.value = '';
        });
        render(); syncURL();
      });
    }

    const csv = $('lst-csv');
    if (csv && csv.addEventListener) {
      csv.addEventListener('click', function () {
        const n = downloadCSV();
        const hint = $('lst-hint');
        if (hint && n) { hint.textContent = '已导出 ' + n + ' 条'; hint.className = 'filter-hint ok'; }
      });
    }

    /* 表头排序：同一列再点一次就反向 */
    if (typeof document !== 'undefined' && document.querySelectorAll) {
      document.querySelectorAll('th.sortable').forEach(function (th) {
        th.addEventListener('click', function () {
          const k = th.getAttribute('data-key');
          if (state.sort === k) state.dir = -state.dir;
          else { state.sort = k; state.dir = 1; }
          render();
        });
      });
    }

    /* 行点击 → 地图定位；点的是"定位"链接就交给浏览器跳转，不重复处理 */
    const tb = $('lst-tbody');
    if (tb && tb.addEventListener) {
      const go = function (tr) {
        const code = tr.getAttribute('data-code');
        if (code) location.href = 'map.html?code=' + encodeURIComponent(code);
      };
      tb.addEventListener('click', function (e) {
        const tr = e.target.closest ? e.target.closest('tr.row') : null;
        if (tr && !(e.target.closest && e.target.closest('a'))) go(tr);
      });
      tb.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const tr = e.target.closest ? e.target.closest('tr.row') : null;
        if (tr) { e.preventDefault(); go(tr); }
      });
    }
  }

  function init(raw) {
    sites = Array.isArray(raw) ? raw : ((raw && (raw.sites || raw.data)) || []);
    const areaC = countBy(function (r) { return val(r, 'region').replace(/大区/g, ''); });
    const zoneC = countBy(function (r) { return val(r, 'zone'); });
    const accC = countBy(function (r) { return baseAcc(val(r, 'acc')); });
    const stC = countBy(function (r) { return val(r, 'dstat'); });

    fillSelect($('lst-area'), Object.keys(areaC).map(function (k) {
      return { value: k, label: k, count: areaC[k] };
    }), '全部大区');
    fillSelect($('lst-zone'), Object.keys(zoneC)
      .sort(function (a, b) { return zoneC[b] - zoneC[a]; })
      .map(function (k) { return { value: k, label: shortZone(k), count: zoneC[k] }; }),
      '全部小区');
    fillSelect($('lst-acc'), ACC_ORDER.filter(function (k) { return accC[k]; }).map(function (k) {
      return { value: k, label: k, count: accC[k] };
    }), '全部精度');
    fillSelect($('lst-status'), Object.keys(stC)
      .sort(function (a, b) { return stC[b] - stC[a]; })
      .map(function (k) { return { value: k, label: k, count: stC[k] }; }),
      '全部状态');

    readURL();
    [['lst-q', 'q'], ['lst-area', 'area'], ['lst-zone', 'zone'],
     ['lst-acc', 'acc'], ['lst-status', 'status']].forEach(function (p) {
      const el = $(p[0]); if (el && state[p[1]]) el.value = state[p[1]];
    });

    renderHead();
    bind();
    render();
    console.log('[赣鄱石语] 名录就绪：' + sites.length + ' 条｜大区 ' +
                Object.keys(areaC).length + '｜小区 ' + Object.keys(zoneC).length);
  }

  function load() {
    if (typeof window !== 'undefined' && window.SITES_DATA) {
      return Promise.resolve(window.SITES_DATA);
    }
    if (typeof fetch !== 'function') return Promise.resolve([]);
    return fetch('./data/sites.json').then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  load().then(init).catch(function (err) {
    console.error('[赣鄱石语] 名录数据读取失败：', err,
                  '｜若地址栏是 file:// 开头，请改用 dist/ 里带内联数据的版本');
    const tb = $('lst-tbody');
    if (tb) tb.innerHTML = '<tr><td colspan="11" class="note">数据读取失败：' +
      '本地双击打开时浏览器禁止读 json，请用 dist/ 离线版或本地服务器。</td></tr>';
  });

  /* 单测入口：不依赖真实 DOM 也能验匹配、排序、CSV */
  if (typeof window !== 'undefined') {
    window.GBSYList = {
      state: state, match: match, sortRows: sortRows, view: view, render: render,
      toCSV: toCSV, rowHTML: rowHTML, shortZone: shortZone,
      init: init,
      _setSites: function (s) { sites = s; },
      _rows: function () { return view(); }
    };
  }
})();
