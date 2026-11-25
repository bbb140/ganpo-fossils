/* 检索逻辑单测：用假 DOM 跑 map.js + filter.js，验证筛选命中数。
   不依赖浏览器：node tools/test_filter.js
   期望值来自当前 32 条数据（v1.2 刷入后数字会变，脚本会打印实际值供核对）。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.dirname(__dirname);
const markers = [];
const makeEl = () => ({
  style: {}, innerHTML: '', textContent: '', className: '', id: '', value: '', tagName: 'DIV',
  appendChild() {}, insertBefore() {}, setAttribute() {}, addEventListener() {}
});
const listeners = {};

global.window = { TDT_KEY: 'test-key' };
global.document = {
  getElementById() { return null; },      // 无筛选栏 DOM：filter.js 走纯逻辑分支
  createElement: makeEl,
  addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  dispatchEvent(e) { (listeners[e.type] || []).forEach(fn => fn(e)); }
};
global.CustomEvent = function (type, opt) { this.type = type; this.detail = opt && opt.detail; };

global.L = {
  map: () => ({
    setView() { return this; }, fitBounds() {}, on() {},
    hasLayer() { return true; }, removeLayer() {}, getZoom() { return 7; }
  }),
  tileLayer: () => ({ addTo() { return this; } }),
  latLngBounds: () => ({ isValid: () => true, pad() { return this; } }),
  circleMarker(latlng, opt) {
    markers.push(opt);
    return { addTo() { return this; }, on() { return this; }, bindPopup() { return this; }, openPopup() {}, getPopup() { return null; } };
  },
  control() { return { onAdd: null, addTo() { return this; } }; },
  DomUtil: { create: makeEl },
  DomEvent: { disableClickPropagation() {} }
};

global.fetch = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(JSON.parse(
    fs.readFileSync(path.join(BASE, 'data', 'sites.json'), 'utf8')))
});

vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'fields.js'), 'utf8'));  // 字段层先行
vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'map.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'filter.js'), 'utf8'));

setTimeout(() => {
  const F = window.GBSYFilter;
  const sites = window.GBSY.sites;
  console.log('数据条数：', sites.length, '｜点位：', markers.length);

  const cases = [
    ['关键词「笔石」', { q: '笔石' }, 5],
    ['关键词「玉山」', { q: '玉山' }, 7],   // 能坞原靠内部备注命中「玉山」，备注清理后为「无」，故 7 条
    ['关键词「不存在的词」', { q: '不存在的词' }, 0],
    ['大区=赣西北', { area: '赣西北' }, 14],
    ['小区=玉山', { zone: '玉山' }, 8],
    ['精度=市级占位', { acc: '市级占位' }, 19],
    ['状态=已核验', { status: '已核验' }, 90],
    ['组合：赣东北+县级占位', { area: '赣东北', acc: '县级占位' }, 12]
  ];

  let ok = true;
  console.log('\n=== 筛选命中 ===');
  cases.forEach(([label, st, expect]) => {
    Object.keys(F.state).forEach(k => { F.state[k] = ''; });
    Object.assign(F.state, st);
    const n = sites.filter(F.match).length;
    const pass = expect === null ? n > 0 : n === expect;
    ok = ok && pass;
    console.log(`${pass ? '✔' : '✘'} ${label} → ${n} 条` +
      (expect === null ? '' : `（期望 ${expect}）`));
  });

  // 小区短名：过长的「其它（…）」要能缩成一行
  const short = F.shortZone('其它（于都赖村、广昌甘竹、万安狮岩）');
  const shortOk = short.length <= 18 && short.indexOf('…') > -1;
  console.log(`\n${shortOk ? '✔' : '✘'} 小区短名：${short}`);
  ok = ok && shortOk;

  console.log('\n结论：', ok ? '通过' : '不通过');
  process.exit(ok ? 0 : 1);
}, 300);
