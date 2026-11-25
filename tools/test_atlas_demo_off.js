/* 验证「图鉴页已取消演示模式」这件事，分两层：
   ① 静态层：atlas.html 里不能再出现演示开关元素与"新访客默认开演示"的代码；
   ② 行为层：从页面里抽出真实的 DEMO-SWITCH 代码块执行，确认老存档里的
      demo=true 会被退回正式进度，而不是继续全解锁。
   行为层直接跑页面里的那段代码（不是手抄一份），页面改了测试会跟着变。 */
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var BASE = path.dirname(__dirname);
var pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('✔ ' + name); } else { fail++; console.log('✘ ' + name); } }

var L = require(path.join(BASE, 'atlas-logic.js'));
var html = fs.readFileSync(path.join(BASE, 'atlas.html'), 'utf8');

/* ---------- ① 静态检查 ---------- */
t('页面不再有演示模式开关元素', html.indexOf('id="demoMode"') === -1);
t('页面不再出现"演示模式（答辩用"文案', html.indexOf('演示模式（答辩用') === -1);
t('页面不再有"新访客默认开演示"的判断',
  html.indexOf("store.getItem(L.K.demo) === null") === -1);
t('页面保留 DEMO-SWITCH 标记（供演示版派生脚本定位）',
  /\/\* DEMO-SWITCH-START \*\//.test(html) && /\/\* DEMO-SWITCH-END \*\//.test(html));

/* ---------- ② 行为检查：抽取页面里的真实代码 ---------- */
var m = html.match(/\/\* DEMO-SWITCH-START \*\/([\s\S]*?)\/\* DEMO-SWITCH-END \*\//);
t('能从页面抽出 DEMO-SWITCH 代码块', !!m);

function memStore(initial) {
  var s = {};
  Object.keys(initial || {}).forEach(function (k) { s[k] = initial[k]; });
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null; },
    setItem: function (k, v) { s[k] = String(v); },
    removeItem: function (k) { delete s[k]; },
    _dump: function () { return s; }
  };
}

/* 与页面完全一致的执行方式：state 是页面作用域里的变量，代码直接给它赋值 */
function applySwitch(store, state) {
  var ctx = vm.createContext({ L: L, store: store, state: state });
  vm.runInContext(m[1], ctx);
  return ctx.state;
}

// 1) 全新访客：不再自动进入演示态，从第一区开始闯关
var s1 = memStore();
var st1 = applySwitch(s1, L.load(s1));
t('全新访客默认不是演示态', st1.demo === false);
t('全新访客只解锁第一区', st1.unlocked === 1 && L.canEnter(st1, 0) && !L.canEnter(st1, 3));

// 2) 老访客的浏览器里被旧版写过 demo=true（且存过演示前进度 3 区）→ 退回正式进度
var s2 = memStore();
var st2 = L.load(s2);
st2.unlocked = 2; st2.found = ['a', 'b'];              // 真实进度：解锁 2 区、探索 2 处
st2 = L.setDemo(s2, st2, true);                        // 旧版自动进演示 → 全解锁
st2.found = ['a', 'b', 'demo-only'];                   // 演示期内又探了一处
var st2b = applySwitch(s2, st2);
t('老存档 demo=true 被关闭', st2b.demo === false);
t('退回演示前的解锁数（2 区）', st2b.unlocked === 2);
t('演示期多探的那处不带入正式进度',
  st2b.found.length === 2 && st2b.found.indexOf('demo-only') === -1);
t('退回后可正常闯关（第三区仍锁）', L.canEnter(st2b, 1) && !L.canEnter(st2b, 2));

// 3) demo=true 但没存过 preDemo（旧数据残缺）→ 兜底回到第一区，不报错
var s3 = memStore({ gbsy_atlas_demo: 'true' });
var st3 = applySwitch(s3, L.load(s3));
t('残缺存档也能安全退回', st3.demo === false && st3.unlocked === 1);

// 4) 正常存档（demo=false、解锁 3 区）不被打扰
var s4 = memStore({ gbsy_atlas_unlocked: '3', gbsy_atlas_found: '["x"]',
                    gbsy_atlas_fossils: '[]', gbsy_atlas_demo: 'false',
                    gbsy_atlas_level: '"normal"' });
var st4 = applySwitch(s4, L.load(s4));
t('正常存档原样保留', st4.demo === false && st4.unlocked === 3 && st4.found.length === 1);

/* ---------- ③ 演示版派生 ---------- */
var demoPath = path.join(BASE, 'atlas-demo.html');
if (fs.existsSync(demoPath)) {
  var demo = fs.readFileSync(demoPath, 'utf8');
  var dm = demo.match(/\/\* DEMO-SWITCH-START \*\/([\s\S]*?)\/\* DEMO-SWITCH-END \*\//);
  t('演示版把开关改成强制开启', !!dm && dm[1].indexOf('setDemo(store, state, true)') > -1);
  var s5 = memStore();
  var ctx5 = vm.createContext({ L: L, store: s5, state: L.load(s5) });
  vm.runInContext(dm[1], ctx5);
  t('演示版打开即全解锁', ctx5.state.demo === true && ctx5.state.unlocked === 4);
} else {
  console.log('· 未生成 atlas-demo.html，跳过演示版检查（python tools/make_demo_page.py）');
}

console.log('\n==== PASS=' + pass + ' FAIL=' + fail + ' ====');
process.exit(fail ? 1 : 0);
