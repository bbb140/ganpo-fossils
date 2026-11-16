/* ============================================================
   js/detail.js —— 产地详情侧栏（P1-5，替代 Leaflet 弹卡）
   依赖：js/fields.js（字段层）；js/map.js 在点位 click / focus 时调
         window.GBSYDetail.show(rec)，本文件只负责渲染与开关。
   页面：map.html（面板挂在 #map 容器内部，桌面右侧、手机底部抽屉）

   为什么不用 Leaflet 自带 popup：
   1) 手机上 popup 贴着图钉，常被导航栏/输入法挡住，也放不下 16 个字段；
   2) popup 宽度受限，"数据来源"这类长文本根本读不了；
   3) 侧栏是固定版式，打印/截图时字段位置稳定。

   时序说明（吸取 2026-11-10 的教训）：
   gbsy:ready 是 map.js 用 setTimeout 派发的宏任务，本脚本同步注册监听
   一定赶得上；但仍保留 window.GBSY 已存在时的直接绑定兜底。
   ============================================================ */
(function () {
  'use strict';

  const FD = window.GBSYFields || {};
  const F = FD.F || {};
  const baseAcc = FD.baseAcc || function (a) { return String(a || ''); };
  const accErrorKm = FD.accErrorKm || function () { return ''; };
  const colorByArea = FD.colorByArea || function () { return '#9E9E9E'; };

  const PREFIX = 'gbsy-detail';
  let panel = null;          // 面板根节点（挂在 #map 里）
  let current = null;        // 当前展示的记录

  function val(rec, key) { return String(FD.field(rec, F[key]) || '').trim(); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ---------- 建面板（一次性） ---------- */
  function buildPanel() {
    if (panel || typeof document === 'undefined' || !document.getElementById) return panel;
    const host = document.getElementById('map');
    if (!host) return null;
    panel = document.createElement('aside');
    panel.id = PREFIX;
    panel.className = PREFIX;
    panel.setAttribute('aria-label', '产地详情');
    panel.setAttribute('role', 'dialog');
    panel.hidden = true;
    host.appendChild(panel);
    return panel;
  }

  /* ---------- 一行字段（空值不渲染，避免满屏"无"） ---------- */
  function row(label, valueHTML) {
    if (!valueHTML || valueHTML === '<span class="d-empty">—</span>') return '';
    return '<div class="d-row"><dt>' + esc(label) + '</dt><dd>' + valueHTML + '</dd></div>';
  }
  function plain(rec, key) {
    const v = val(rec, key);
    return v ? esc(v) : '';
  }

  /* ---------- 主体内容 ---------- */
  function contentHTML(rec) {
    const code = val(rec, 'code');
    const region = val(rec, 'region').replace(/大区/g, '');
    const zone = val(rec, 'zone');
    const undecided = zone.indexOf('未定') > -1 || region.indexOf('未定') > -1;
    const acc = val(rec, 'acc') || '未标注';
    const measured = /实测|GPS/i.test(acc);
    const approx = !measured;

    /* 级别口径：与图例同一句话，侧栏里再交代一次（不是每条都点图例） */
    const lvRaw = val(rec, 'level');
    const lvHTML = (!lvRaw || lvRaw.indexOf('待确认') > -1 || lvRaw.indexOf('待核定') > -1)
      ? '<span class="d-pending">待核定</span>' +
        '<span class="d-note">逐条级别见规划《附表 4》，该表未随正文公开；' +
        '级别汇总见数据下载页</span>'
      : esc(lvRaw);

    /* 坐标：把"这是个占位值"说满——档位、误差、依据，三样缺一不可 */
    const lon = val(rec, 'lon'), lat = val(rec, 'lat');
    const coordHTML = (lon && lat)
      ? esc(lon + '°E, ' + lat + '°N') +
        '<span class="d-note">' +
        (measured
          ? '实测点位'
          : '<strong>' + esc(baseAcc(acc)) + '</strong>：行政区政府驻地占位，' +
            '误差约 ' + esc(accErrorKm(acc)) + '，非实测点位') +
        '</span>'
      : '';

    return (
      '<header class="d-head">' +
        '<div>' +
          '<h3 class="d-title">' + esc(val(rec, 'name') || '（无名称）') + '</h3>' +
          '<span class="d-code">' + esc(code) + '</span>' +
        '</div>' +
        '<button type="button" class="d-close" data-act="close" aria-label="关闭详情">×</button>' +
      '</header>' +

      /* 大区色点与地图点位同色（fields.js 的 AREA_COLOR） */
      '<div class="d-badges">' +
        '<span class="d-badge d-badge-area" style="--dot:' +
          (undecided ? '#9E9E9E' : colorByArea(region)) + '">' +
          esc(undecided ? '未定分区' : region || '—') + '</span>' +
        '<span class="d-badge">' + esc(zone || '小区未填') + '</span>' +
        '<span class="d-badge d-badge-status">' + esc(val(rec, 'dstat') || '状态未填') + '</span>' +
      '</div>' +

      '<dl class="d-list">' +
        row('所在市（县）', plain(rec, 'county')) +
        row('地质年代', plain(rec, 'age')) +
        row('主要化石门类', plain(rec, 'taxa')) +
        row('赋存地层', plain(rec, 'strata')) +
        row('保护级别', lvHTML) +
        row('保护区状态', plain(rec, 'status')) +
        row('坐标', coordHTML) +
        row('数据来源', plain(rec, 'source')) +
        row('备注', plain(rec, 'note')) +
      '</dl>' +

      '<footer class="d-foot">' +
        '<p class="d-disc">本站坐标均为行政区政府驻地占位值，' +
          '不得作为实测坐标引用。</p>' +
        '<a class="d-golist" href="list.html?q=' + encodeURIComponent(code) + '"' +
          ' title="在名录中查看该产地">在名录中查看 →</a>' +
      '</footer>'
    );
  }

  /* ---------- 对外 API ---------- */
  function show(rec) {
    if (!rec) return false;
    const p = buildPanel();
    if (!p) return false;
    current = rec;
    p.innerHTML = contentHTML(rec);
    p.hidden = false;
    p.scrollTop = 0;
    /* 移动端抽屉展开后，键盘焦点给关闭键，Esc 可直接关 */
    const btn = p.querySelector('.d-close');
    if (btn && btn.focus) btn.focus();
    return true;
  }

  function hide() {
    if (!panel) return;
    panel.hidden = true;
    current = null;
  }

  function isOpen() { return !!(panel && !panel.hidden); }

  /* ---------- 事件 ---------- */
  function bindEvents(detail) {
    if (typeof document === 'undefined') return;
    const map = (detail && detail.points && window.GBSY && window.GBSY.map) ||
                (window.GBSY && window.GBSY.map);

    /* 面板内点关闭；点"在名录中查看"是普通链接，不拦 */
    if (panel && panel.addEventListener) {
      panel.addEventListener('click', function (e) {
        const t = e.target.closest ? e.target.closest('[data-act="close"]') : null;
        if (t) hide();
      });
    }

    /* Esc 关闭（面板开着时） */
    if (document.addEventListener) {
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen()) hide();
      });
    }

    /* 点地图空白处关闭（Leaflet 图层的 click 不会冒泡到 map，安全） */
    if (map && map.on) map.on('click', hide);
  }

  document.addEventListener('gbsy:ready', function (e) {
    buildPanel();
    bindEvents(e.detail || {});
    console.log('[赣鄱石语] 详情侧栏就绪');
  });

  /* 兜底：若本脚本加载时事件已错过，直接初始化 */
  if (window.GBSY) { buildPanel(); bindEvents({}); }

  window.GBSYDetail = { show: show, hide: hide, isOpen: isOpen,
                        _current: function () { return current; } };
})();
