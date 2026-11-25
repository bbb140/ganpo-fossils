/* ============================================================
   js/filter.js —— 产地检索与筛选（C 岗「第四步：检索」）
   依赖：js/map.js 暴露的 window.GBSY（map / sites / points / field / F / applyFilter）
   页面：map.html 里的 .filter-bar（无此 DOM 时自动跳过，方便单测）

   设计要点：
   1) 只做"筛掉不匹配的点"，不改数据、不改配色——筛选后图例仍是全量口径；
   2) 关键词覆盖 名称/编号/县市/门类/地层/年代/备注，一个输入框够用；
   3) 状态写进 URL（?q=笔石&zone=玉山），可分享、可回退；
   4) 结果条数实时显示，0 条时给明确提示而不是空白地图。
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

  /* ---- 当前结果的物种概览：图鉴数据到位显示图鉴卡片，否则按门类聚合 ---- */
  function parts(v) {
    return String(v || '').split(/[、，,；;]/).map(function (x) { return x.trim(); })
      .filter(Boolean);
  }
  function renderSummary(matched) {
    const box = $('species-list');
    if (!box) return;
    if (!matched.length) {
      box.innerHTML = '<p class="note">没有匹配的记录。</p>';
      return;
    }
    /* 图鉴优先：有数据且本次筛选命中图鉴条目时，直接渲染图鉴卡片 */
    const sp = window.GBSYSpecies;
    if (sp && sp.has() && sp.renderCards(box, matched)) return;

    /* 兜底：按「主要化石门类」聚合，不编物种名 */
    const c = {};
    matched.forEach(function (r) {
      parts(val(r, 'taxa')).forEach(function (t) { c[t] = (c[t] || 0) + 1; });
    });
    const top = Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }).slice(0, 8);
    box.innerHTML = top.map(function (t) {
      return '<div class="taxa-chip"><strong>' + t + '</strong><span>' + c[t] + '</span></div>';
    }).join('') +
      '<p class="note">按「主要化石门类」聚合，共 ' + matched.length +
      ' 条记录；物种级名录待 B 岗数据到位后替换。</p>';
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
        apply();
      });
    });
    const reset = $('flt-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        Object.keys(state).forEach(function (k) { state[k] = ''; });
        ids.forEach(function (p) { if ($(p[0])) $(p[0]).value = ''; });
        apply();
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

  document.addEventListener('gbsy:ready', function (e) { init(e.detail); });

  /* 兜底：若本脚本加载时 gbsy:ready 已经错过（数据比脚本先就绪），直接初始化。
     有 inited 防重入，事件稍后再到也不会跑两遍。 */
  if (window.GBSY) init(window.GBSY);

  /* 单测入口：不依赖 DOM 也能验证匹配逻辑 */
  window.GBSYFilter = {
    match: match, state: state, shortZone: shortZone,
    init: init, apply: apply,
    _setSites: function (s) { sites = s; }
  };
})();
