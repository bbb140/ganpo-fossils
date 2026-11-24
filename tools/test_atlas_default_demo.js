/* 验证 atlas.html 的「首次访问默认开演示模式」逻辑：
   新访客自动开、手动关过一次后保持关、重置后仍为演示态。
   直接抽取页面里的初始化片段在可控桩上执行，不依赖浏览器。 */
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var BASE = path.dirname(__dirname);
var pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; console.log('✔ ' + name); } else { fail++; console.log('✘ ' + name); } }

var L = require(path.join(BASE, 'atlas-logic.js'));

function memStore(initial) {
  var m = {};
  Object.keys(initial || {}).forEach(function (k) { m[k] = initial[k]; });
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    _dump: function () { return m; }
  };
}

/* 与 atlas.html 初始化片段完全一致的默认逻辑 */
function applyDefault(store, state) {
  try {
    if (store.getItem(L.K.demo) === null && !state.demo) {
      state = L.setDemo(store, state, true);
    }
  } catch (e) {}
  return state;
}

// 1) 全新访客：localStorage 无任何键 → 自动开演示、全解锁
var s1 = memStore();
var st1 = applyDefault(s1, L.load(s1));
t('全新访客自动开启演示模式', st1.demo === true);
t('全新访客直接全解锁 4 区', st1.unlocked === 4 && L.canEnter(st1, 3));
t('默认值已写入 localStorage', s1.getItem(L.K.demo) === 'true');

// 2) 用户手动关过一次（demo 键为 false）→ 不再强行打开
var s2 = memStore();
var st2 = L.setDemo(s2, L.load(s2), true);   // 首次自动开
st2 = L.setDemo(s2, st2, false);             // 用户手动关闭
st2 = applyDefault(s2, st2);                // 再次打开页面
t('手动关过一次后保持关闭', st2.demo === false);
t('关闭后可进入正常闯关（赣西北可进、赣东南不可进）',
  L.canEnter(st2, 0) && !L.canEnter(st2, 3));

// 3) 重置进度：reset() 走 fresh()（demo=false），但页面层默认值会再次接管
var s3 = memStore();
var st3 = applyDefault(s3, L.load(s3));     // 首次开
st3 = L.reset(s3);                          // 重置 → fresh() demo=false，并写入 false
t('reset() 后 demo 键变为 false', s3.getItem(L.K.demo) === 'false');
st3 = applyDefault(s3, st3);                // 刷新页面：此时键已有值，不应接管
t('重置后刷新不再自动开（尊重已写入的 false）', st3.demo === false);

// 4) 已存档的老用户（有进度、demo=false）不被打扰
var s4 = memStore({ gbsy_atlas_unlocked: '3', gbsy_atlas_found: '[]',
                    gbsy_atlas_fossils: '[]', gbsy_atlas_demo: 'false',
                    gbsy_atlas_level: '"normal"' });
var st4 = applyDefault(s4, L.load(s4));
t('老用户存档不被默认值覆盖', st4.demo === false && st4.unlocked === 3);

// 5) localStorage 不可用（隐私模式）时静默降级，不抛错
var badStore = { getItem: function () { throw new Error('blocked'); },
                 setItem: function () { throw new Error('blocked'); } };
var st5;
try { st5 = applyDefault(badStore, L.fresh()); t('localStorage 不可用时静默降级', true); }
catch (e) { t('localStorage 不可用时静默降级', false); }

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
