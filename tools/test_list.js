/* 名录页单测：假 DOM 跑 js/list.js，验行数、排序、筛选、CSV、跳转链接。
   node tools/test_list.js
   OFFLINE=1 node tools/test_list.js   # 用 dist 的内联数据，模拟双击打开 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.dirname(__dirname);

function el(extra) {
  const o = {
    textContent: '', innerHTML: '', value: '', className: '',
    tagName: 'DIV', style: {},
    addEventListener() {}, appendChild() {}, removeChild() {},
    classList: { toggle() {} },
    setAttribute() {}, getAttribute() { return null; }
  };
  return Object.assign(o, extra || {});
}

const els = {};
['lst-total', 'lst-zones', 'lst-count', 'lst-hint', 'lst-tbody',
 'lst-q', 'lst-reset', 'lst-csv'].forEach(id => { els[id] = el(); });

/* 下拉：tagName 必须是 SELECT，list.js 才会绑 change 而不是 input */
['lst-area', 'lst-zone', 'lst-acc', 'lst-status'].forEach(id => {
  els[id] = el({ tagName: 'SELECT' });
});

/* 排序表头：只关心 getAttribute('data-key') */
const ths = ['code', 'name', 'county', 'zone', 'age', 'taxa', 'strata', 'acc', 'dstat']
  .map(k => el({ getAttribute(a) { return a === 'data-key' ? k : null; } }));

global.window = {};
global.document = {
  getElementById: id => els[id] || null,
  querySelectorAll(sel) { return sel === 'th.sortable' ? ths : []; },
  createElement: () => el(),
  body: { appendChild() {}, removeChild() {} }
};
global.fetch = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(JSON.parse(
    fs.readFileSync(path.join(BASE, 'data', 'sites.json'), 'utf8')))
});

if (process.env.OFFLINE === '1') {
  vm.runInThisContext(fs.readFileSync(path.join(BASE, 'dist', 'js', 'data-inline.js'), 'utf8'));
  global.fetch = () => { throw new Error('离线版不应调用 fetch'); };
  console.log('模式：离线（dist/js/data-inline.js）');
}

vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'fields.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'list.js'), 'utf8'));

const L = () => global.window.GBSYList;

setTimeout(() => {
  let ok = true;
  const chk = (name, pass, extra) => {
    ok = ok && pass;
    console.log(`${pass ? '✔' : '✘'} ${name}${extra ? '：' + extra : ''}`);
  };

  const html = els['lst-tbody'].innerHTML || '';
  const rows = (html.match(/data-code="/g) || []).length;
  chk('渲染行数', rows === 109, rows + ' 行（期望 109）');
  chk('无「正在载入」残留', html.indexOf('正在载入') < 0);

  chk('统计头：条数 / 覆盖小区', els['lst-total'].textContent === 109 &&
      Number(els['lst-zones'].textContent) === 12,
      els['lst-total'].textContent + ' 条 / ' + els['lst-zones'].textContent + ' 个小区（期望 109 / 12）');

  chk('计数文案', /显示 109 \/ 109 条/.test(els['lst-count'].textContent),
      els['lst-count'].textContent);

  /* 跳转链接：每行都要指向 map.html?code=… */
  const links = (html.match(/map\.html\?code=/g) || []).length;
  chk('每行带地图定位链接', links === 109, links + ' 个');

  /* 排序：按名称升序、降序，首行应互换 */
  const st = L().state;
  st.sort = 'name'; st.dir = 1;
  const asc = L()._rows();
  st.dir = -1;
  const desc = L()._rows();
  const nm = r => String(r.name || r['产地名称'] || '');
  chk('按名称排序可反向', nm(asc[0]) !== nm(desc[0]),
      `升序首行「${nm(asc[0])}」/ 降序首行「${nm(desc[0])}」`);

  /* 筛选：与地图页 filter.js 必须同结果 */
  const cases = [
    [{ q: '笔石' }, 5, '关键词「笔石」'],
    [{ q: '玉山' }, 7, '关键词「玉山」'],   // 同上：内部备注清理后少 1 条
    [{ area: '赣西' }, 37, '大区=赣西（不能被赣西北吞）'],
    [{ area: '赣西北' }, 14, '大区=赣西北'],
    [{ acc: '市级占位' }, 19, '精度=市级占位'],
    [{ status: '已核验' }, 90, '状态=已核验'],
    [{ q: '不存在的词xyz' }, 0, '关键词无结果']
  ];
  cases.forEach(([patch, expect, label]) => {
    Object.keys(st).forEach(k => { st[k] = (k === 'sort' || k === 'dir') ? st[k] : ''; });
    Object.assign(st, patch);
    const n = L()._rows().length;
    chk('筛选 ' + label, n === expect, n + ' 条（期望 ' + expect + '）');
  });

  /* 0 结果时的提示不能是空白表格（直接改 state 不会自动重渲染，要显式调 render） */
  L().render();
  chk('0 结果提示', (els['lst-tbody'].innerHTML || '').indexOf('没有匹配的记录') > -1,
      (els['lst-tbody'].innerHTML || '').slice(0, 30));

  /* CSV：BOM + 表头 12 列 + 32 行数据 */
  Object.keys(st).forEach(k => { st[k] = (k === 'sort' || k === 'dir') ? st[k] : ''; });
  st.sort = 'code'; st.dir = 1;
  const csv = L().toCSV(L()._rows());
  const lines = csv.replace(/^\ufeff/, '').split('\r\n');
  chk('CSV 带 BOM', csv.charCodeAt(0) === 0xfeff);
  chk('CSV 表头列数', lines[0].split('","').length === 16, lines[0].slice(0, 40) + '…');
  chk('CSV 数据行数', lines.length === 110, (lines.length - 1) + ' 行（期望 109）');

  /* 大区色点：四色都应出现，且不含未定义色 */
  const AC = global.window.GBSYFields.AREA_COLOR;
  const palette = Object.keys(AC).map(k => AC[k]);
  Object.keys(st).forEach(k => { st[k] = (k === 'sort' || k === 'dir') ? st[k] : ''; });
  L().render();
  const all = els['lst-tbody'].innerHTML || '';
  const usedColors = palette.filter(c => all.indexOf(c) > -1);
  chk('四色色点齐全', usedColors.length === 4, usedColors.join(' '));
  chk('无灰色误标大区', all.indexOf('background:#9E9E9E') === -1);

  console.log('\n结论：', ok ? '通过' : '不通过');
  process.exit(ok ? 0 : 1);
}, 300);
