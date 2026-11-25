/* 详情侧栏单测：假 DOM 跑 js/detail.js，验字段齐全、口径措辞、关闭与链接。
   node tools/test_detail.js
   数据：v1.2 图册重建版（英文 17 列，109 条，逐条级别） */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.dirname(__dirname);

let created = null;                     // 捕获挂进 #map 的面板节点
/* 记录 Leaflet 事件隔离是否被施加到侧栏（防滚卡片时地图跟着动） */
const isolated = { scroll: 0, click: 0 };
function mkEl() {
  return {
    style: {}, innerHTML: '', textContent: '', className: '', id: '',
    hidden: false, scrollTop: 0,
    appendChild(ch) { created = ch; },
    addEventListener() {}, setAttribute() {},
    querySelector() { return { focus() {} }; }
  };
}

global.window = {
  L: {
    DomEvent: {
      disableScrollPropagation(el) { if (el === created) isolated.scroll++; },
      disableClickPropagation(el) { if (el === created) isolated.click++; }
    }
  }
};
global.document = {
  getElementById(id) {
    if (id === 'map') return mkEl();    // detail 面板的宿主
    return null;
  },
  createElement: mkEl,
  addEventListener() {}, dispatchEvent() {}
};

vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'fields.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'detail.js'), 'utf8'));

const D = () => global.window.GBSYDetail;
const GF = global.window.GBSYFields;

/* 代表性记录：v1.2 英文键，经字段层取数（与页面同一路径） */
const recs = JSON.parse(fs.readFileSync(path.join(BASE, 'data', 'sites.json'), 'utf8'));
const val = (r, k) => String(GF.field(r, GF.F[k]) || '').trim();
const normal = recs.find(r => /县级/.test(val(r, 'acc')));           // 行政驻地占位
const world = recs.find(r => val(r, 'level') === '世界级');           // 级别真值上色
const place = recs.find(r => /地名/.test(val(r, 'acc')));             // PBDB 地名级
const undecided = recs.find(r => val(r, 'zone').indexOf('未定') > -1);

let ok = true;
const chk = (name, pass, extra) => {
  ok = ok && pass;
  console.log(`${pass ? '✔' : '✘'} ${name}${extra ? '：' + extra : ''}`);
};

/* 1. 普通记录（县级占位） */
const shown = D().show(normal);
chk('show 返回 true 且面板已建', shown === true && !!created);
chk('面板显示（hidden=false）', created.hidden === false);

const html = created.innerHTML;
chk('标题与编号', html.indexOf(val(normal, 'name')) > -1 &&
    html.indexOf(val(normal, 'code')) > -1);

['所在市（县）', '地质年代', '主要化石门类', '保护级别',
 '坐标', '数据来源'].forEach(label => {
  chk('字段「' + label + '」在列', html.indexOf(label) > -1);
});

/* 「无」值字段不该渲染成行（地层 98 条、详址 77 条填「无」） */
chk('地层为「无」时不渲染行',
  val(normal, 'strata') === '无' ? html.indexOf('赋存地层') === -1 : true);

/* 口径三要素：占位、误差、非实测 */
chk('坐标注明行政驻地占位', html.indexOf('行政区政府驻地占位') > -1);
chk('坐标注明误差范围', /误差约 [0-9–]+ km/.test(html));
chk('坐标注明非实测', html.indexOf('非实测点位') > -1);
chk('底部免责句', html.indexOf('不得作为实测坐标引用') > -1);

/* v2.9：级别有逐条真值，应带色显示 + 图册出处说明 */
const lv = val(normal, 'level');
chk('级别显示真值（' + lv + '）',
  lv && lv.indexOf('待') < 0 ? html.indexOf(lv) > -1 : true);
chk('级别附图册出处说明', html.indexOf('图册') > -1);

/* 名录联动链接 */
chk('带"在名录中查看"链接',
  html.indexOf('list.html?q=' + encodeURIComponent(val(normal, 'code'))) > -1);

/* Leaflet 事件隔离：滚侧栏时不带动地图（用户反馈「地图被滑动而卡片不动」） */
chk('侧栏已隔离滚动传播给 Leaflet 地图', isolated.scroll > 0);
chk('侧栏已隔离点击传播给 Leaflet 地图', isolated.click > 0);

/* 关闭 */
D().hide();
chk('hide 后隐藏', created.hidden === true && D().isOpen() === false);

/* 2. 世界级记录：徽标色点用级别色（与图上点位同色） */
if (world) {
  created.innerHTML = '';
  D().show(world);
  chk('世界级徽标带级别色 #8B0000', created.innerHTML.indexOf('#8B0000') > -1);
}

/* 3. 地名级（PBDB）：坐标说明应为地名定位，不是行政驻地 */
if (place) {
  created.innerHTML = '';
  D().show(place);
  chk('PBDB 地名级标注「据公开地名」', created.innerHTML.indexOf('据公开地名') > -1);
  chk('PBDB 条不写「行政区政府驻地占位」',
    created.innerHTML.indexOf('行政区政府驻地占位') === -1);
}

/* 4. 未定小区（旧版数据才有，v1.2 可能无） */
if (undecided) {
  created.innerHTML = '';
  D().show(undecided);
  chk('未定小区显示「未定分区」徽标', created.innerHTML.indexOf('未定分区') > -1);
} else {
  console.log('（当前数据无未定小区记录，跳过该项）');
}

/* 5. 空记录防御 */
chk('空记录返回 false', D().show(null) === false);

console.log('\n结论：', ok ? '通过' : '不通过');
process.exit(ok ? 0 : 1);
