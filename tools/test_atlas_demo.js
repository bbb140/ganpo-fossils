/* 化石图鉴探索原型的逻辑测试：直接测 atlas-logic.js 的纯函数 */
const fs = require('fs'), path = require('path');
const BASE = path.dirname(__dirname);
const L = require(path.join(BASE, 'atlas-logic.js'));
const SITES = [{ region: '赣西北' }, { region: '赣东北' }].concat([]); // 占位，实际从数据文件读
vm = require('vm');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(BASE, 'atlas-demo-data.js'), 'utf8'), ctx);
const sites = ctx.window.ATLAS_SITES, species = ctx.window.ATLAS_SPECIES;

function memStore() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v))
  };
}
const byArea = a => sites.filter(r => r.region === a);
const fossilAt = id => species.filter(f => f.tapho_link === id);

let ok = true;
const t = (label, cond) => { ok = ok && cond; console.log((cond ? '✔' : '✘') + ' ' + label); };

const store = memStore();
let s = L.load(store);

t('初始：解锁 1 区、0 探索、0 化石', s.unlocked === 1 && s.found.length === 0 && s.fossils.length === 0);
t('初始：只有赣西北可进入', L.canEnter(s, 0) && !L.canEnter(s, 1));

// 赣西北探索 3 处（该区无化石）
const nw = byArea('赣西北');
let opened = [];
for (let i = 0; i < 2; i++) {
  const r = L.explore(store, s, nw[i], sites, species);
  t('赣西北第 ' + (i + 1) + ' 次探索掉落 0 化石且未解锁', r.fossils.length === 0 && r.unlockedAreas.length === 0);
}
const r3 = L.explore(store, s, nw[2], sites, species);
t('赣西北第 3 次探索解锁赣东北', s.unlocked === 2 && r3.unlockedAreas.join() === '赣东北');
t('解锁后赣东北可进入', L.canEnter(s, 1));

// 重复探索不重复计数
const again = L.explore(store, s, nw[0], sites, species);
t('重复勘探同一产地不增加进度', again.already === true && s.found.length === 3);

// 赣东北探索：其中一处藏玉山笔石
const ne = byArea('赣东北');
const hidden = ne.find(r => fossilAt(r.id).length);
t('赣东北存在藏化石的产地', !!hidden);
const hit = L.explore(store, s, hidden, sites, species);
t('勘探藏化石产地掉落 1 条图鉴', hit.fossils.length === 1 && hit.fossils[0].cn_name === '分离玉山笔石');
t('首次收集返回 true', L.collect(store, s, hit.fossils[0]) === true);
t('重复收集返回 false', L.collect(store, s, hit.fossils[0]) === false);
t('图鉴去重后只有 1 条', s.fossils.length === 1);

// 徽章：初探者(3产地) + 化石发现者(1条)
const badges = L.badges(s);
t('获得「初探者」徽章', !!badges.find(b => b.id === 'scout' && b.got));
t('获得「化石发现者」徽章', !!badges.find(b => b.id === 'first' && b.got));
t('未获得「走遍赣鄱」徽章', !badges.find(b => b.id === 'traveler').got);

// 演示模式
s = L.setDemo(store, s, true);
t('演示模式解锁全部 4 区', s.demo && s.unlocked === 4);
t('演示模式任意区可进入', L.canEnter(s, 3));

// 重置
s = L.reset(store);
t('重置回到初始状态', s.unlocked === 1 && s.found.length === 0 && s.fossils.length === 0 && !s.demo);

// 数据一致性：图鉴的 tapho_link 必须在 sites 里（除斑嵴龙空值）
let valid = 0, empty = 0;
species.forEach(f => {
  if (!f.tapho_link) { empty++; return; }
  if (sites.some(r => r.id === f.tapho_link)) valid++;
});
t('图鉴编号全部有效（13 有效 / 1 空）', valid === 13 && empty === 1);

console.log('\n结论：', ok ? '通过' : '不通过');
process.exit(ok ? 0 : 1);
