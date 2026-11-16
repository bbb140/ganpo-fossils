/* 首页渲染单测：假 DOM 跑 js/main.js，检查四个分区是否真的填满。
   node tools/test_home.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.dirname(__dirname);
const AREAS = ['赣西北', '赣东北', '赣西', '赣东南'];

function el() { return { textContent: '', innerHTML: '' }; }

const sections = AREAS.map(function (a) {
  const parts = { h2: el(), '.region-lead': el(), tbody: el(), '.species-cards': el() };
  return {
    parts: parts,
    getAttribute(k) { return k === 'data-region' ? a : null; },
    querySelector(sel) { return parts[sel] || null; }
  };
});

const stats = { 'stat-total': el(), 'stat-zones': el() };
global.window = {};
global.document = {
  getElementById(id) { return stats[id] || null; },
  querySelectorAll(sel) {
    if (sel === 'section[data-region]') return sections;
    if (sel.indexOf('.region-lead') > -1) return sections.map(s => s.parts['.region-lead']);
    return [];
  }
};
global.fetch = () => Promise.resolve({
  ok: true,
  json: () => Promise.resolve(JSON.parse(
    fs.readFileSync(path.join(BASE, 'data', 'sites.json'), 'utf8')))
});

if (process.env.OFFLINE === '1') {
  // 模拟双击打开：注入 dist 的内联数据，fetch 一旦被调用就该报错
  vm.runInThisContext(fs.readFileSync(path.join(BASE, 'dist', 'js', 'data-inline.js'), 'utf8'));
  global.fetch = () => { throw new Error('离线版不应调用 fetch'); };
  console.log('模式：离线（dist/js/data-inline.js）');
}

vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'fields.js'), 'utf8'));  // 字段层先行
vm.runInThisContext(fs.readFileSync(path.join(BASE, 'js', 'main.js'), 'utf8'));

setTimeout(() => {
  let ok = true;
  console.log('=== 首页四分区 ===');
  const expect = { 赣西北: 14, 赣东北: 20, 赣西: 37, 赣东南: 38 };
  sections.forEach((s, i) => {
    const area = AREAS[i];
    const tb = s.parts.tbody.innerHTML || '';
    const rows = (tb.match(/<tr>/g) || []).length;
    const lead = s.parts['.region-lead'].textContent || '';
    const h2 = s.parts.h2.textContent || '';
    const pass = rows === expect[area] && /已收录本区 \d+ 条/.test(lead) && h2.indexOf(area) === 0;
    ok = ok && pass;
    console.log(`${pass ? '✔' : '✘'} ${area}：${rows} 行（期望 ${expect[area]}）｜标题「${h2}」`);
    if (!pass) console.log('    导语：', lead.slice(0, 80));
  });

  const total = stats['stat-total'].textContent;
  const zones = stats['stat-zones'].textContent;
  const statOk = String(total) === '109' && Number(zones) === 12;
  ok = ok && statOk;
  console.log(`\n${statOk ? '✔' : '✘'} 速览条：${total} 条 / 覆盖 ${zones} 个小区（期望 109 / 12）`);

  const empty = sections.some(s => (s.parts['.region-lead'].textContent || '').indexOf('正在载入') > -1);
  console.log(`${empty ? '✘' : '✔'} 无「正在载入」残留`);
  ok = ok && !empty;

  console.log('\n结论：', ok ? '通过' : '不通过');
  process.exit(ok ? 0 : 1);
}, 300);
