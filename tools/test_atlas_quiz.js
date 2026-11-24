/* 图鉴探索「知识小考门槛」测试：题库真实性 + 答错不放行 + 三档强度 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const BASE = path.dirname(__dirname);
const L = require(path.join(BASE, 'atlas-logic.js'));
const Q = require(path.join(BASE, 'atlas-quiz.js'));

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(BASE, 'atlas-demo-data.js'), 'utf8'), ctx);
const sites = ctx.window.ATLAS_SITES, species = ctx.window.ATLAS_SPECIES;

function memStore() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
const byArea = a => sites.filter(r => r.region === a);
let ok = true;
const t = (label, cond) => { ok = ok && cond; console.log((cond ? '✔' : '✘') + ' ' + label); };

// --- 1. 题库真实性：每个选项都是数据里的真实值，答案正确且唯一 ---
let allReal = true, allUnique = true, noAnswerLeak = true, qCount = 0;
sites.slice(0, 40).forEach(site => {
  const qs = Q.make(site, sites, 2);
  qs.forEach(q => {
    qCount++;
    if (q.answer !== String(site[q.field])) allReal = false;
    // 4 个选项全部来自某个真实产地的该字段
    const realVals = new Set(sites.map(s => String(s[q.field] || '').trim()).filter(Boolean));
    q.options.forEach(op => { if (!realVals.has(op)) allReal = false; });
    if (new Set(q.options).size !== q.options.length) allUnique = false;
    if (q.options.filter(o => o === q.answer).length !== 1) noAnswerLeak = false;
  });
});
t('题库全部取自真实字段（抽查 40 处，' + qCount + ' 题）', allReal);
t('每题选项无重复', allUnique);
t('每题恰有一个正确答案', noAnswerLeak);
t('check() 仅认准确答案', Q.check({ answer: '晚白垩世' }, '晚白垩世') && !Q.check({ answer: '晚白垩世' }, '早奥陶世'));

// --- 2. 答错不放行 ---
const store = memStore();
let s = L.load(store);
const nw = byArea('赣西北');
const wrong = Q.make(nw[0], sites, 1)[0];
const wrongPick = wrong.options.filter(o => o !== wrong.answer)[0];
t('故意选错被 check 判否', !Q.check(wrong, wrongPick));
const rFail = L.explore(store, s, nw[0], sites, species, false);
t('答错题：不计入探索、不解锁、不掉落', rFail.failed === true && s.found.length === 0 && s.unlocked === 1);

// --- 3. 答对才放行，填满门槛才解锁 ---
for (let i = 0; i < 2; i++) L.explore(store, s, nw[i], sites, species, true);
t('标准档：答对 2 处仍未解锁', s.unlocked === 1 && L.foundIn(s, '赣西北', sites) === 2);
L.explore(store, s, nw[2], sites, species, true);
t('标准档：答对第 3 处解锁赣东北', s.unlocked === 2);

// --- 4. 三档强度 ---
s = L.reset(store);
L.setLevel(store, s, 'easy');
t('轻松档 need=1? 不，应为 3', L.needOf(s) === 3 && L.quizOf(s) === 1);
L.setLevel(store, s, 'hard');
t('挑战档 need=4 quiz=2', L.needOf(s) === 4 && L.quizOf(s) === 2);
for (let i = 0; i < 3; i++) L.explore(store, s, nw[i], sites, species, true);
t('挑战档：答对 3 处仍未解锁', s.unlocked === 1);
L.setLevel(store, s, 'normal');
L.setLevel(store, s, 'invalid');
t('非法档位回退标准', s.level === 'normal');

// --- 5. 演示模式跳过答题（直接 passed=true）与持久化 ---
s = L.reset(store);
s = L.setDemo(store, s, true);
t('演示模式全解锁', s.demo && s.unlocked === 4);
L.explore(store, s, nw[0], sites, species, true);
const s2 = L.load(store);
t('进度写入存储后可读回', s2.found.length === 1 && s2.demo === true);

console.log('\n结论：', ok ? '通过' : '不通过');
process.exit(ok ? 0 : 1);
