/* 健壮性回归：localStorage 脏数据归一化 + 演示模式进度回滚 + 存储禁用降级。
   node tools/test_atlas_robust.js */
const fs = require('fs');
const path = require('path');
const L = require('../atlas-logic.js');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function memStore(init) {
  const m = Object.assign({}, init || {});
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    _raw: m
  };
}

console.log('=== 1. localStorage 脏数据归一化（不再崩溃）===');
const dirty = memStore({
  [L.K.unlocked]: JSON.stringify('abc'),       // 非数字
  [L.K.found]: JSON.stringify('123'),          // 字符串冒充数组
  [L.K.fossils]: JSON.stringify({ a: 1 }),     // 对象冒充数组
  [L.K.preDemo]: JSON.stringify(999),          // 越界
  [L.K.level]: JSON.stringify('unknown')       // 未知档位
});
const s = L.load(dirty);
t('unlocked 非法 → 1', s.unlocked === 1);
t('found 非数组 → []', Array.isArray(s.found) && s.found.length === 0);
t('fossils 非数组 → []', Array.isArray(s.fossils) && s.fossils.length === 0);
t('preDemo 越界 → 1', s.preDemo === 1);
t('level 未知 → normal', s.level === 'normal');
t('foundIn 不抛错', (function () {
  try { L.foundIn(s, '赣西', [{ id: 'x', region: '赣西' }]); return true; }
  catch (e) { return false; }
})());
t('collect 不抛错', (function () {
  try { L.collect(dirty, s, { cn_name: '测试化石' }); return true; }
  catch (e) { return false; }
})());

console.log('=== 2. 演示模式关闭时完整回滚 ===');
const store = memStore();
let st = L.fresh();
L.collect(store, st, { cn_name: '正式收集' });
L.explore(store, st, { id: 'JX-1' }, [{ id: 'JX-1', region: '赣西' }], [], true);
t('演示前：1 条收集 / 1 处勘探', st.fossils.length === 1 && st.found.length === 1);
st = L.setDemo(store, st, true);
t('进入演示：全解锁', st.demo === true && st.unlocked === 4);
L.collect(store, st, { cn_name: '演示收集' });
L.explore(store, st, { id: 'JX-2' }, [{ id: 'JX-2', region: '赣西' }], [], true);
t('演示期：进度增长到 2/2', st.fossils.length === 2 && st.found.length === 2);
st = L.setDemo(store, st, false);
t('关闭演示：解锁回到 1', st.unlocked === 1);
t('关闭演示：收集回到演示前', st.fossils.length === 1 && st.fossils[0] === '正式收集');
t('关闭演示：勘探回到演示前', st.found.length === 1 && st.found[0] === 'JX-1');
const reloaded = L.load(store);
t('刷新后仍是回滚后的进度',
  reloaded.unlocked === 1 && reloaded.fossils.length === 1 && reloaded.found.length === 1);

console.log('=== 3. 首次自动开演示也应完整回滚 ===');
const freshStore = memStore();
let first = L.load(freshStore);
first = L.setDemo(freshStore, first, true);   // 模拟首次自动开
L.collect(freshStore, first, { cn_name: '仅演示收集' });
L.explore(freshStore, first, { id: 'JX-9' }, [{ id: 'JX-9', region: '赣西' }], [], true);
first = L.setDemo(freshStore, first, false);
t('首次演示关掉后是干净初始态',
  first.unlocked === 1 && first.fossils.length === 0 && first.found.length === 0);

console.log('=== 4. 存储禁用降级（静态检查）===');
const html = fs.readFileSync(path.join(__dirname, '..', 'atlas.html'), 'utf8');
t('atlas.html 用 try 包住 localStorage 读取',
  /try\s*\{\s*store\s*=\s*window\.localStorage;?\s*\}\s*catch/.test(html));
t('提供内存版 getItem/setItem 兜底',
  html.indexOf('getItem:function(k)') >= 0 && html.indexOf('setItem:function(k,v)') >= 0);

console.log('\n健壮性验证：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
