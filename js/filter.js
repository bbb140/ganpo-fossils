/* ============================================================
   js/filter.js —— 产地检索与筛选（C 岗「第四步：检索」）
   依赖：js/map.js 暴露的 window.GBSY（map / sites / points / field / F / applyFilter）
   页面：map.html 里的 .filter-bar（无此 DOM 时自动跳过，方便单测）

   设计要点：
   1) 只做"筛掉不匹配的点"，不改数据、不改配色——筛选后图例仍是全量口径；
   2) 关键词覆盖 名称/编号/县市/门类/地层/年代/备注，一个输入框够用；
   3) 状态写进 URL（?q=笔石&zone=玉山），可分享、可回退；
   4) 结果条数实时显示，0 条时给明确提示而不是空白地图。
   5) 页面下方「代表物种」区跟随当前范围：检索/筛选 → 命中产地的物种；
      点开某条产地（点标记、「名录 → 地图 ?code=」跳转）→ 只显示这条产地的物种，
      关闭侧栏即退回筛选结果。侧栏通过 gbsy:sitefocus / gbsy:siteblur 事件通知，
      本文件只监听、不反向依赖 detail.js。
   ============================================================ */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const state = { q: '', area: '', zone: '', acc: '', status: '' };
  let sites = [];

  /* ---- 取值与匹配（纯函数，可单测） ---- */
  function val(rec, key) {
    if (!window.GBSY) return '';
    return window.GBSY.field(rec, window.GBSY.F[key]);
  }
  function baseAcc(acc) {
    return String(acc || '').replace(/[（(][^）)]*[）)]/g, '').trim() || acc;
  }
  /* 下拉里的小区名太长，缩成「其它·于都赖村/广昌甘竹…」 */
  function shortZone(z) {
    const m = String(z || '').match(/^([^（(]+)[（(](.+)[）)]$/);
    if (!m) return z;
    const body = m[2].replace(/、/g, '/');
    return m[1].trim() + '·' + (body.length > 12 ? body.slice(0, 11) + '…' : body);
  }
  function hay(rec) {
    return [val(rec, 'name'), val(rec, 'code'), val(rec, 'county'), val(rec, 'taxa'),
            val(rec, 'strata'), val(rec, 'age'), val(rec, 'note')].join(' ').toLowerCase();
  }
  function match(rec) {
    if (state.q && hay(rec).indexOf(state.q) < 0) return false;
    if (state.area && String(val(rec, 'region')).replace(/大区|\s/g, '') !== state.area) return false;
    if (state.zone && String(val(rec, 'zone')) !== state.zone) return false;
    if (state.acc && baseAcc(val(rec, 'acc')) !== state.acc) return false;
    if (state.status && String(val(rec, 'dstat')) !== state.status) return false;
    return true;
  }

  /* ---- URL 同步（file:// 下 replaceState 可能抛错，忽略即可） ---- */
  function syncURL() {
    try {
      const p = new URLSearchParams();
      ['q', 'area', 'zone', 'acc', 'status'].forEach(function (k) {
        if (state[k]) p.set(k, state[k]);
      });
      const qs = p.toString();
      if (qs) history.replaceState(null, '', '?' + qs);
      else history.replaceState(null, '', location.pathname);
    } catch (e) { /* file:// 忽略 */ }
  }
  function readURL() {
    try {
      const p = new URLSearchParams(location.search);
      ['q', 'area', 'zone', 'acc', 'status'].forEach(function (k) {
        const v = p.get(k);
        if (v) state[k] = v;
      });
    } catch (e) { /* ignore */ }
  }

  /* ---- 下拉选项：全部从数据里取，避免和图例脱钩 ---- */
  const ACC_ORDER = ['实测', '村级占位', '乡级占位', '县级占位', '市级占位', '地名级'];
  function fillSelect(sel, items, placeholder) {
    if (!sel) return;
    let html = '<option value="">' + placeholder + '</option>';
    items.forEach(function (it) {
      html += '<option value="' + String(it.value).replace(/"/g, '&quot;') + '">' +
              it.label + (it.count != null ? '（' + it.count + '）' : '') + '</option>';
    });
    sel.innerHTML = html;
  }
  function countBy(getter) {
    const c = {};
    sites.forEach(function (r) {
      const k = getter(r);
      if (k) c[k] = (c[k] || 0) + 1;
    });
    return c;
  }

  /* ---- 当前结果的物种概览 ----
     范围口径（按优先级）：
       ① 点开某条产地（含「名录 → 地图 ?code=」跳转）→ 只显示这条产地的物种；
          该产地没有关联图鉴条目时，给出「看同小区其他化石」的手动入口
          （不自动扩展：同小区是地理相邻，不等于物种属该产地，必须读者自己点）；
       ② 有检索/筛选条件 → 显示命中产地的物种；
       ③ 都没有 → 显示全部产地的物种。
     图鉴数据到位就用图鉴卡片，否则按门类聚合兜底，不编物种名。 */
  let focused = null;        // 当前点开/聚焦的产地记录
  let zoneExpand = false;    // 是否已扩展到"同保护小区"
  let lastMatched = [];      // 最近一次筛选命中（调试与测试用）

  function parts(v) {
    return String(v || '').split(/[、，,；;]/).map(function (x) { return x.trim(); })
      .filter(Boolean);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* 同一保护小区内的产地（含自己）。小区为空时只返回自己，不跨区兜底 */
  function sameZone(rec) {
    const z = val(rec, 'zone');
    if (!z) return [rec];
    const list = sites.filter(function (s) { return val(s, 'zone') === z; });
    return list.length ? list : [rec];
  }

  /* 标题与范围说明：让读者一眼看出这批卡片来自"全部/筛选结果/单个产地" */
  function renderScope(list, rendered) {
    const title = $('species-title'), scope = $('species-scope');
    if (title) {
      title.textContent = focused
        ? (zoneExpand ? '同小区的代表物种' : '该产地的代表物种')
        : '当前结果的代表物种';
    }
    if (!scope) return;
    if (focused) {
      const nm = esc(val(focused, 'name') || '该产地');
      const code = val(focused, 'code');
      const back = '<a class="sp-scope-link" data-act="only-site">只看本产地 →</a>';
      const all = '<a class="sp-scope-link" data-act="all-species">看全部筛选结果 →</a>';
      if (zoneExpand) {
        scope.innerHTML = '聚焦 ' + nm + (code ? '（' + esc(code) + '）' : '') +
          '　已扩展到同小区「' + esc(val(focused, 'zone') || '—') + '」的 ' +
          list.length + ' 处产地' + back + all;
      } else {
        let extra = '';
        if (!rendered && sameZone(focused).length > 1) {
          extra = '<a class="sp-scope-link" data-act="zone">看同小区其他化石 →</a>';
        }
        scope.innerHTML = '聚焦 ' + nm + (code ? '（' + esc(code) + '）' : '') + all + extra;
      }
    } else {
      const active = state.q || state.area || state.zone || state.acc || state.status;
      scope.textContent = active
        ? '已按条件筛选：' + list.length + ' 处产地'
        : '全部 ' + list.length + ' 处产地（检索关键词或点开某条产地，可缩小到这里）';
    }
  }

  function renderSummary(matched) {
    const box = $('species-list');
    if (!box) return;
    lastMatched = matched;
    /* 聚焦单条产地时，无论筛选命中多少，只显示这一条（或它所在小区） */
    const list = focused ? (zoneExpand ? sameZone(focused) : [focused]) : matched;
    if (!list.length) {
      renderScope(list, false);
      box.innerHTML = '<p class="note">没有匹配的记录。</p>';
      return;
    }
    /* 图鉴优先：有数据且本次范围内命中图鉴条目时，直接渲染图鉴卡片 */
    const sp = window.GBSYSpecies;
    const rendered = !!(sp && sp.has() && sp.renderCards(box, list));
    renderScope(list, rendered);
    if (rendered) return;

    /* 兜底：按「主要化石门类」聚合，不编物种名 */
    const c = {};
    list.forEach(function (r) {
      parts(val(r, 'taxa')).forEach(function (t) { c[t] = (c[t] || 0) + 1; });
    });
    const top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, 8);
    box.innerHTML = top.map(function (t) {
      return '<div class="taxa-chip"><strong>' + t + '</strong><span>' + c[t] + '</span></div>';
    }).join('') +
      '<p class="note">' + (focused
        ? '该产地暂未关联到图鉴条目，以上为它的主要化石门类。'
        : '按「主要化石门类」聚合，共 ' + list.length + ' 条记录。') + '</p>';
  }

  /* ---- 主流程 ---- */
  function apply() {
    const n = window.GBSY ? window.GBSY.applyFilter(match) : 0;
    const total = window.GBSY ? window.GBSY.show : sites.length;
    const cnt = $('flt-count');
    if (cnt) cnt.textContent = '显示 ' + n + ' / ' + total + ' 条';
    renderSummary(sites.filter(match));

    const hint = $('flt-hint');
    if (hint) {
      const active = state.q || state.area || state.zone || state.acc || state.status;
      if (n === 0) {
        hint.textContent = '没有匹配的产地：换个关键词，或点「重置」看全部 ' + total + ' 条';
        hint.className = 'filter-hint warn';
      } else if (active && n === 1 && window.GBSY) {
        hint.textContent = '仅 1 条，已定位';
        hint.className = 'filter-hint ok';
        const hit = sites.filter(match)[0];
        const code = hit ? val(hit, 'code') : '';
        if (code) window.GBSY.focus(code);
      } else {
        hint.textContent = active ? '已按条件筛选（图例计数仍为全量）' : '';
        hint.className = 'filter-hint';
      }
    }
    syncURL();
  }

  function bind() {
    const ids = [['flt-q', 'q'], ['flt-area', 'area'], ['flt-zone', 'zone'],
                 ['flt-acc', 'acc'], ['flt-status', 'status']];
    ids.forEach(function (pair) {
      const el = $(pair[0]);
      if (!el) return;
      const ev = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(ev, function () {
        state[pair[1]] = el.value.trim();
        if (pair[1] === 'q') state.q = state.q.toLowerCase();
        focused = null;          // 用户重新检索 → 退回"筛选结果"口径
        zoneExpand = false;
        apply();
      });
    });
    const reset = $('flt-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        Object.keys(state).forEach(function (k) { state[k] = ''; });
        ids.forEach(function (p) { if ($(p[0])) $(p[0]).value = ''; });
        focused = null;
        zoneExpand = false;
        apply();
      });
    }
    /* 作用范围行里的三个入口：看全部筛选结果 / 只看本产地 / 看同小区其他化石 */
    const scope = $('species-scope');
    if (scope) {
      scope.addEventListener('click', function (e) {
        const t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (!t) return;
        e.preventDefault();
        const act = t.getAttribute ? t.getAttribute('data-act') : '';
        if (act === 'zone') {
          zoneExpand = true;
        } else if (act === 'only-site') {
          zoneExpand = false;
        } else if (act === 'all-species') {
          focused = null;
          zoneExpand = false;
        } else {
          return;
        }
        renderSummary(sites.filter(match));
      });
    }
  }

  let inited = false;                // 宏任务时序下事件可能触发两次路径，防重入
  function init(detail) {
    if (inited) return;
    inited = true;
    sites = (detail && detail.sites) || (window.GBSY && window.GBSY.sites) || [];
    const areaC = countBy(function (r) { return val(r, 'region'); });
    const zoneC = countBy(function (r) { return val(r, 'zone'); });
    const accC = countBy(function (r) { return baseAcc(val(r, 'acc')); });
    const stC = countBy(function (r) { return val(r, 'dstat'); });

    fillSelect($('flt-area'), Object.keys(areaC).map(function (k) {
      return { value: k, label: k, count: areaC[k] };
    }), '全部大区');
    fillSelect($('flt-zone'), Object.keys(zoneC)
      .sort(function (a, b) { return zoneC[b] - zoneC[a]; })
      .map(function (k) { return { value: k, label: shortZone(k), count: zoneC[k] }; }),
      '全部小区');
    fillSelect($('flt-acc'), ACC_ORDER.filter(function (k) { return accC[k]; }).map(function (k) {
      return { value: k, label: k, count: accC[k] };
    }), '全部精度');
    fillSelect($('flt-status'), Object.keys(stC)
      .sort(function (a, b) { return stC[b] - stC[a]; })
      .map(function (k) { return { value: k, label: k, count: stC[k] }; }),
      '全部状态');

    readURL();
    ['flt-q', 'flt-area', 'flt-zone', 'flt-acc', 'flt-status'].forEach(function (id, i) {
      const key = ['q', 'area', 'zone', 'acc', 'status'][i];
      if ($(id) && state[key]) $(id).value = state[key];
    });
    bind();
    apply();
    console.log('[赣鄱石语] 检索就绪：' + sites.length + ' 条可筛｜大区 ' +
                Object.keys(areaC).length + '｜小区 ' + Object.keys(zoneC).length);
  }

  /* 侧栏开/关 → 代表物种跟着"聚焦某条产地"或"退回筛选结果"。
     由 js/detail.js 在 show()/hide() 时派发，filter.js 只监听，不反向依赖它，
     这样 list.html（没有地图）加载 detail.js 也不会报错。 */
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('gbsy:sitefocus', function (e) {
      focused = (e && e.detail && e.detail.rec) || null;
      zoneExpand = false;
      renderSummary(sites.filter(match));
    });
    document.addEventListener('gbsy:siteblur', function () {
      if (!focused) return;
      focused = null;
      zoneExpand = false;
      renderSummary(sites.filter(match));
    });
    /* 图鉴数据走 fetch，常晚于首次渲染到达：补渲染一次，
       否则会一直停在"门类聚合"的兜底视图 */
    document.addEventListener('gbsy:species', function () {
      renderSummary(sites.filter(match));
    });
  }

  document.addEventListener('gbsy:ready', function (e) { init(e.detail); });

  /* 兜底：若本脚本加载时 gbsy:ready 已经错过（数据比脚本先就绪），直接初始化。
     有 inited 防重入，事件稍后再到也不会跑两遍。 */
  if (window.GBSY) init(window.GBSY);

  /* 单测入口：不依赖 DOM 也能验证匹配逻辑 */
  window.GBSYFilter = {
    match: match, state: state, shortZone: shortZone,
    init: init, apply: apply, renderSummary: renderSummary,
    _setSites: function (s) { sites = s; },
    _focus: function (rec) { focused = rec || null; zoneExpand = false; renderSummary(sites.filter(match)); },
    _focused: function () { return focused; },
    _expand: function (v) { zoneExpand = !!v; renderSummary(sites.filter(match)); },
    _zoneExpand: function () { return zoneExpand; },
    _scopeList: function (matched) { return focused ? [focused] : matched; }
  };
})();
