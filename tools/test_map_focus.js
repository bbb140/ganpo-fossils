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
const mapStub = {
  _zoom: null, _center: null, _setView: null,
  setView(c, z) { this._setView = [c, z]; return this; },
  fitBounds() {}, on() {},
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
    return {
      addTo() { return this; },
      on() { return this; },
      bindPopup() { return this; },
      openPopup() { return this; },
      getPopup() { return null; }
    };
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
  t('全部点位关闭 click 冒泡（否则侧栏刚开就被关）',
    markerOpts.length === 109 && markerOpts.every(function (o) {
      return o.bubblingMouseEvents === false;
    }), markerOpts.length + ' 个点位');

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

  console.log('\n==== PASS=' + pass + ' FAIL=' + fail + ' ====');
  process.exit(fail ? 1 : 0);
}, 300);
