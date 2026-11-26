/* 验证「名录页 → 地图页」的定位放大行为。
   用假 Leaflet 跑真实 map.js，按坐标精度检查 GBSY.focus() 选的 zoom。
   node tools/test_map_focus.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.dirname(__dirname);
let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('✔ ' + name + (extra ? ' → ' + extra : '')); }
  else { fail++; console.log('✘ ' + name + (extra ? ' → ' + extra : '')); }
}

const makeEl = () => ({
  style: { cssText: '', setProperty() {} },
  innerHTML: '', textContent: '', className: '', id: '',
  appendChild() {}, insertBefore() {}, setAttribute() {}
});
const markerOpts = [];
const haloOpts = [];
const removedLayers = [];
const mapStub = {
  _zoom: null, _center: null, _setView: null,
  _layers: [],
  setView(c, z) { this._setView = [c, z]; return this; },
  fitBounds() {}, on() {},
  hasLayer(l) { return this._layers.indexOf(l) > -1; },
  removeLayer(l) { removedLayers.push(l); this._layers = this._layers.filter(x => x !== l); return this; },
  flyTo(c, z, opt) { this._zoom = z; this._center = c; this._opt = opt; return this; }
};

global.window = { TDT_KEY: 'test-key' };
const listeners = {};
global.document = {
  getElementById(id) {
    if (id === 'map') return { ...makeEl(), parentNode: { insertBefore() {} } };
    return null;
  },
  createElement: makeEl,
  addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  dispatchEvent(e) { (listeners[e.type] || []).forEach(fn => fn(e)); }
};
global.console = console;
global.L = {
  map: () => mapStub,
  tileLayer: () => ({ addTo() { return this; } }),
  latLngBounds: () => ({ isValid: () => true, pad() { return this; } }),
  circleMarker(latlng, opt) {
    markerOpts.push(opt);
    const mk = {
      _latlng: latlng, _style: null, _tip: null,
      addTo() {
        if (mapStub._layers.indexOf(this) < 0) mapStub._layers.push(this);
        return this;
      },
      on() { return this; },
      setStyle(s) { this._style = Object.assign({}, this._style || {}, s); return this; },
      bindTooltip(html, o) { this._tip = { html: html, opt: o }; return this; },
      unbindTooltip() { this._tip = null; return this; },
      getElement() { return null; },
      bindPopup() { return this; },
      openPopup() { return this; },
      getPopup() { return null; }
    };
    if (opt.className === 'gbsy-focus-halo') haloOpts.push({ latlng: latlng, opt: opt, layer: mk });
    return mk;
  },
  control() { return { onAdd: null, addTo() { return makeEl(); } }; },
  DomUtil: { create: makeEl },
  DomEvent: { disableClickPropagation() {} }
};

const rows = JSON.parse(fs.readFileSync(path.join(BASE, 'data', 'sites.json'), 'utf8'));
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(rows) });

vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'fields.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'map.js'), 'utf8'));

setTimeout(() => {
  t('地图接口已就绪', !!(window.GBSY && window.GBSY.focus));
  const siteOpts = markerOpts.filter(function (o) { return o.className !== 'gbsy-focus-halo'; });
  t('全部点位关闭 click 冒泡（否则侧栏刚开就被关）',
    siteOpts.length === 109 && siteOpts.every(function (o) {
      return o.bubblingMouseEvents === false;
    }), siteOpts.length + ' 个点位');

  // 初始化时地图本身会 setView([27.8,115.9],7)，记下来用于确认 focus 没再走旧路径
  const initSetView = mapStub._setView;
  const cases = [
    ['村级占位', 14],
    ['乡级占位', 12],
    ['县级占位', 10],
    ['地名级', 10],
    ['市级占位', 9]
  ];
  cases.forEach(function (c) {
    const kind = c[0], want = c[1];
    const rec = rows.filter(function (r) {
      return String(r.coord_precision || '').indexOf(kind) > -1;
    })[0];
    if (!rec) { t(kind + ' 有样本数据', false); return; }
    mapStub._zoom = null;
    const hit = window.GBSY.focus(rec.id);
    t(kind + ' 定位成功', hit === true, rec.id);
    t(kind + ' 放大到 zoom ' + want, mapStub._zoom === want, '实际 ' + mapStub._zoom);
    t(kind + ' 飞向该产地坐标',
      Math.abs(mapStub._center[0] - Number(rec.latitude)) < 1e-9 &&
      Math.abs(mapStub._center[1] - Number(rec.longitude)) < 1e-9);
  });

  t('使用了带动画的 flyTo', mapStub._opt && mapStub._opt.duration > 0);
  t('focus 不再用旧的全场 setView 定位', mapStub._setView === initSetView);
  t('不存在的编号安全返回 false', window.GBSY.focus('JX-NO-SUCH') === false);

  /* ---- 定位高亮：变亮 + 呼吸光圈 + 名称标签，且与侧栏开关同步 ---- */
  const hlRec = rows.filter(function (r) {
    return String(r.coord_precision || '').indexOf('村级占位') > -1;
  })[0];
  haloOpts.length = 0;
  removedLayers.length = 0;
  t('高亮接口可用', window.GBSY.highlight(hlRec.id) === true);
  const halo = haloOpts[0];
  t('生成呼吸光圈', !!halo && halo.opt.className === 'gbsy-focus-halo');
  t('光圈落在目标坐标', !!halo &&
    Math.abs(halo.latlng[0] - Number(hlRec.latitude)) < 1e-9 &&
    Math.abs(halo.latlng[1] - Number(hlRec.longitude)) < 1e-9);
  t('光圈不抢鼠标事件', !!halo &&
    halo.opt.interactive === false && halo.opt.bubblingMouseEvents === false);
  const target = window.GBSY.points.filter(function (p) {
    return window.GBSY.field(p.rec, window.GBSY.F.code) === hlRec.id;
  })[0];
  t('目标点位变亮（半径/描边/填充）', !!target && !!target.marker._style &&
    target.marker._style.radius === 11 && target.marker._style.weight === 3 &&
    target.marker._style.fillOpacity > 0.25,
    target && target.marker._style ? JSON.stringify(target.marker._style) : '');
  t('常驻名称标签带定位字样', !!target && !!target.marker._tip &&
    target.marker._tip.opt.permanent === true &&
    target.marker._tip.opt.className === 'gbsy-focus-tip' &&
    target.marker._tip.html.indexOf(hlRec.name) > -1);
  const haloCount = haloOpts.length;
  window.GBSY.highlight(hlRec.id);
  t('重复定位同一条不重建图层', haloOpts.length === haloCount);
  t('高亮不存在的编号安全返回 false', window.GBSY.highlight('JX-NO-SUCH') === false);

  window.GBSY.clearHighlight();
  t('关闭后点位样式还原', target.marker._style.radius === 7 &&
    target.marker._style.weight === 2 && target.marker._style.fillOpacity === 0.25);
  t('关闭后标签解绑', target.marker._tip === null);
  t('关闭后光圈从地图移除', removedLayers.indexOf(halo.layer) > -1);

  document.dispatchEvent({ type: 'gbsy:sitefocus', detail: { rec: hlRec } });
  t('侧栏打开事件也能点亮', target.marker._tip !== null && haloOpts.length === haloCount + 1);
  document.dispatchEvent({ type: 'gbsy:siteblur' });
  t('侧栏关闭事件清除高亮', target.marker._tip === null);

  document.dispatchEvent({ type: 'gbsy:sitefocus', detail: { rec: hlRec } });
  window.GBSY.applyFilter(function (r) {
    return window.GBSY.field(r, window.GBSY.F.code) !== hlRec.id;
  });
  t('筛选隐藏目标点时撤掉高亮', target.marker._tip === null);

  console.log('\n==== PASS=' + pass + ' FAIL=' + fail + ' ====');
  process.exit(fail ? 1 : 0);
}, 300);
