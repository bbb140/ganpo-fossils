/* 用假的 Leaflet / DOM 跑一遍 map.js，验证配色与图例口径。
   不依赖浏览器，node tools/test_map.js 即可。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.dirname(__dirname);
const markers = [];
const popups = [];   // openPopup 降级路径的调用记录
const makeEl = () => ({
  style: { cssText: '', setProperty() {} },
  innerHTML: '', textContent: '', className: '', id: '',
  appendChild() {}, insertBefore() {}, setAttribute() {}
});
const legendEls = [];

global.window = { TDT_KEY: 'test-key' };
const listeners = {};
global.document = {
  getElementById(id) {
    if (id === 'map') return { ...makeEl(), parentNode: { insertBefore() {} } };
    return null;                       // 其余元素走自动创建分支
  },
  createElement: makeEl,
  addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
  dispatchEvent(e) { (listeners[e.type] || []).forEach(fn => fn(e)); }
};
global.console = console;

global.L = {
  map: () => ({ setView() { return this; }, fitBounds() {}, on() {} }),
  tileLayer: () => ({ addTo() { return this; } }),
  latLngBounds: () => ({ isValid: () => true, pad() { return this; } }),
  circleMarker(latlng, opt) {
    markers.push(opt);
    return {
      addTo() { return this; },
      on(ev, fn) { (this._h = this._h || {})[ev] = fn; return this; },
      bindPopup() { return this; },
      openPopup() { popups.push(latlng); return this; },
      getPopup() { return null; }
    };
  },
  control() {
    return {
      onAdd: null,
      addTo() {
        const el = this.onAdd ? this.onAdd() : makeEl();
        legendEls.push(el);
        return this;
      }
    };
  },
  DomUtil: { create: makeEl },
  DomEvent: { disableClickPropagation() {} }
};

const OFFLINE = process.env.OFFLINE === '1';
if (OFFLINE) {
  // 模拟双击打开（file://）：有内联数据，且 fetch 一旦被调用就该报错
  vm.runInThisContext(fs.readFileSync(path.join(BASE, 'dist', 'js', 'data-inline.js'), 'utf8'));
  global.fetch = () => { throw new Error('离线版不应调用 fetch'); };
  console.log('模式：离线（window.SITES_DATA 已注入）');
} else {
global.fetch = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(JSON.parse(
    fs.readFileSync(path.join(BASE, 'data', 'sites.json'), 'utf8')))
});
}

vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'fields.js'), 'utf8'));  // 字段层先行
vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'map.js'), 'utf8'));

setTimeout(() => {
  const colors = {};
  markers.forEach(m => { colors[m.fillColor] = (colors[m.fillColor] || 0) + 1; });
  const placeholder = markers.filter(m => m.dashArray && m.fillOpacity <= 0.3);
  console.log('\n=== 点位 ===');
  console.log('上图', markers.length, '个，颜色种类', Object.keys(colors).length);
  console.log('配色分布：', colors);
  console.log('占位样式（虚线描边+半透明）：', placeholder.length + '/' + markers.length,
    placeholder.length === markers.length ? '✔' : '✘（应全部为占位样式）');

  const legend = legendEls.map(e => e.innerHTML || '').find(h => h.indexOf('保护级别') > -1) || '';
  console.log('\n=== 图例 ===');
  console.log('含「保护级别」标题：', legend.indexOf('保护级别') > -1);
  console.log('三档级别带计数（5/17/87）：',
    legend.indexOf('世界级　5') > -1 && legend.indexOf('国家级　17') > -1 && legend.indexOf('省级　87') > -1);
  console.log('含图册口径说明：', legend.indexOf('图册') > -1);
  console.log('含占位口径说明：', legend.indexOf('占位坐标') > -1);

  const dis = legendEls.map(e => e.textContent || '').find(t => t.indexOf('说明：') > -1) || '';
  console.log('\n=== 免责句 ===');
  console.log(dis ? '已渲染：' + dis : '缺失');
  console.log('含「不得作为实测坐标引用」：', dis.indexOf('不得作为实测坐标引用') > -1);

  const ok = markers.length === 109 &&
    colors['#8B0000'] === 5 && colors['#C62828'] === 17 && colors['#1565C0'] === 87 &&
    placeholder.length === markers.length &&
    markers.every(m => m.bubblingMouseEvents === false) &&
    legend.indexOf('省级　87') > -1 &&
    legend.indexOf('占位坐标') > -1 &&
    dis.indexOf('不得作为实测坐标引用') > -1;
  console.log('\n结论：', ok ? '通过' : '不通过');
  process.exit(ok ? 0 : 1);
}, 300);
