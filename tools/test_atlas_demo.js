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

// 数据一致性：所有 tapho_link 必须是有效编号或空值（无编号=文献条目，不可探索）。
// 不写死条数：B 岗以后再补化石，测试自动适配。
let valid = 0, empty = 0, bad = 0;
species.forEach(f => {
  if (!f.tapho_link) { empty++; return; }
  if (sites.some(r => r.id === f.tapho_link)) valid++;
  else { bad++; console.log('  ✗ 非法编号：' + f.cn_name + ' -> ' + f.tapho_link); }
});
t('图鉴编号全部有效（无非法编号）', bad === 0);
t('图鉴含可探索条目与文献条目', valid > 0 && empty > 0);

// ===== 新增 5 枚徽章：用模拟的「已收集名单」验证判定 =====
const g = id => badges.find(b => b.id === id);
const allBadges = L.badges(s, species);
t('徽章总数 10 枚', allBadges.length === 10);
t('初始未获得任何新徽章',
  !allBadges.find(b => ['invert','dino','time','quad','half'].includes(b.id)).got);

// 收集所有可探索化石 → 新徽章应全部点亮
const sFull = L.fresh();
sFull.fossils = species.filter(f => f.tapho_link).map(f => f.cn_name);
const full = L.badges(sFull, species);
t('集齐后「无脊椎收藏家」点亮', full.find(b => b.id === 'invert').got);
t('集齐后「龙裔传人」点亮', full.find(b => b.id === 'dino').got);
t('集齐后「穿越时空」点亮', full.find(b => b.id === 'time').got);
t('集齐后「四方藏家」点亮', full.find(b => b.id === 'quad').got);
t('集齐后「半壁江山」点亮', full.find(b => b.id === 'half').got);
t('集齐后「赣鄱化石大师」点亮', full.find(b => b.id === 'master').got);

// 只收 1 条：数量/覆盖类都不该点亮
const sOne = L.fresh();
sOne.fossils = [species.find(f => f.tapho_link).cn_name];
const one = L.badges(sOne, species);
t('仅 1 条时新徽章均不点亮',
  !one.find(b => b.id === 'invert').got && !one.find(b => b.id === 'dino').got &&
  !one.find(b => b.id === 'time').got && !one.find(b => b.id === 'quad').got &&
  !one.find(b => b.id === 'half').got);

// 描述里的数字应随数据动态变化（不写死）
const halfDesc = full.find(b => b.id === 'half').desc;
const totalAvail = species.filter(f => f.tapho_link).length;
t('「半壁江山」描述含动态门槛 ' + Math.ceil(totalAvail / 2),
  halfDesc.indexOf(String(Math.ceil(totalAvail / 2))) > -1);

console.log('\n结论：', ok ? '通过' : '不通过');
process.exit(ok ? 0 : 1);
