/* 详情侧栏单测：假 DOM 跑 js/detail.js，验字段齐全、口径措辞、关闭与链接。
   node tools/test_detail.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.dirname(__dirname);

let created = null;                     // 捕获挂进 #map 的面板节点
function mkEl() {
  return {
    style: {}, innerHTML: '', textContent: '', className: '', id: '',
    hidden: false, scrollTop: 0,
    appendChild(ch) { created = ch; },
    addEventListener() {}, setAttribute() {},
    querySelector() { return { focus() {} }; }
  };
}

global.window = {};
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

/* 两条代表性记录：一条普通（县级占位），一条未定小区 */
const recs = JSON.parse(fs.readFileSync(path.join(BASE, 'data', 'sites.json'), 'utf8'));
const normal = recs.find(r => String(r['坐标精度'] || '').indexOf('县级') > -1);
const undecided = recs.find(r => String(r['分区小区'] || '').indexOf('未定') > -1);

let ok = true;
const chk = (name, pass, extra) => {
  ok = ok && pass;
  console.log(`${pass ? '✔' : '✘'} ${name}${extra ? '：' + extra : ''}`);
};

/* 1. 普通记录 */
const shown = D().show(normal);
chk('show 返回 true 且面板已建', shown === true && !!created);
chk('面板显示（hidden=false）', created.hidden === false);

const html = created.innerHTML;
chk('标题与编号', html.indexOf(String(normal['产地名称'])) > -1 &&
    html.indexOf(String(normal['记录编号'])) > -1);

['所在市（县）', '地质年代', '主要化石门类', '赋存地层', '保护级别',
 '保护区状态', '坐标', '数据来源'].forEach(label => {
  chk('字段「' + label + '」在列', html.indexOf(label) > -1);
});

/* 空字段不该出现空行（备注多数为空） */
const emptyRows = (html.match(/d-empty/g) || []).length;
chk('无空占位行', emptyRows === 0);

/* 口径三要素：占位、误差、非实测 */
chk('坐标注明行政驻地占位', html.indexOf('行政区政府驻地占位') > -1);
chk('坐标注明误差范围', /误差约 [0-9–]+ km/.test(html));
chk('坐标注明非实测', html.indexOf('非实测点位') > -1);
chk('底部免责句', html.indexOf('不得作为实测坐标引用') > -1);

/* 级别：32 条全是待确认 → 必须显示"待核定"+ 原因，不是裸的"待确认" */
chk('级别显示待核定而非裸待确认',
    html.indexOf('待核定') > -1 && html.indexOf('>待确认<') === -1);
chk('级别附《附表 4》说明', html.indexOf('附表 4') > -1);

/* 名录联动链接 */
chk('带"在名录中查看"链接',
    html.indexOf('list.html?q=' + encodeURIComponent(String(normal['记录编号']))) > -1);

/* 关闭 */
D().hide();
chk('hide 后隐藏', created.hidden === true && D().isOpen() === false);

/* 2. 未定小区（清江盆地）：徽标应显示"未定分区" */
if (undecided) {
  created.innerHTML = '';
  D().show(undecided);
  chk('未定小区显示「未定分区」徽标', created.innerHTML.indexOf('未定分区') > -1);
} else {
  console.log('（当前数据无未定小区记录，跳过该项）');
}

/* 3. 空记录防御 */
chk('空记录返回 false', D().show(null) === false);

console.log('\n结论：', ok ? '通过' : '不通过');
process.exit(ok ? 0 : 1);
