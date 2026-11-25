/* 徽章图案验证：确认 10 枚徽章的 icon 都配齐、互不重复，
   并输出到首页徽章条与徽章墙圆形奖牌两处。node tools/test_atlas_badge_icon.js */
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var BASE = path.dirname(__dirname);
var pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

var html = fs.readFileSync(path.join(BASE, 'atlas.html'), 'utf8');
var species = JSON.parse(fs.readFileSync(path.join(BASE, 'data', 'species.json'), 'utf8'));
var L = require(path.join(BASE, 'atlas-logic.js'));

/* ---- 1. 数据层：10 枚全配齐、互不重复 ---- */
var withIcon = L.BADGES.filter(function (b) { return b.icon; });
t('全部 10 枚徽章都配了图案', withIcon.length === L.BADGES.length && L.BADGES.length === 10);
var icons = withIcon.map(function (b) { return b.icon; });
t('图案互不重复', new Set(icons).size === icons.length);

var fresh = L.fresh();
var bs = L.badges(fresh, species);
t('badges() 每项都带 icon 字段', bs.every(function (b) { return Object.prototype.hasOwnProperty.call(b, 'icon'); }));
t('badges() 带出全部 10 枚图案', bs.filter(function (b) { return b.icon; }).length === 10);
t('图案内容正确', bs.find(function (b) { return b.id === 'scout'; }).icon === '🔍' &&
  bs.find(function (b) { return b.id === 'hunter'; }).icon === '💎' &&
  bs.find(function (b) { return b.id === 'master'; }).icon === '🏆' &&
  bs.find(function (b) { return b.id === 'dino'; }).icon === '🦕' &&
  bs.find(function (b) { return b.id === 'invert'; }).icon === '🐚');

/* ---- 2. UI 层：用最小 DOM 桩跑真实内联脚本，检查渲染输出 ---- */
function El(id) {
  this.id = id || ''; this._html = ''; this._text = ''; this._cls = {};
  this._attrs = {}; this.childNodes = []; this.disabled = false; this.checked = false;
  this.style = {};
  var self = this;
  this.classList = {
    add: function (c) { self._cls[c] = 1; }, remove: function (c) { delete self._cls[c]; },
    toggle: function (c, on) { if (on) self._cls[c] = 1; else delete self._cls[c]; },
    contains: function (c) { return !!self._cls[c]; }
  };
}
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); this.childNodes = []; parseInto(this); }
});
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this._text; }, set: function (v) { this._text = String(v); }
});
El.prototype.getAttribute = function (k) { return this._attrs[k] == null ? null : this._attrs[k]; };
El.prototype.setAttribute = function (k, v) { this._attrs[k] = String(v); };
El.prototype.appendChild = function (c) { this.childNodes.push(c); };
El.prototype.querySelectorAll = function () { return []; };
var registry = {};
function parseInto(host) {
  var re = /<(\w+)([^>]*)>/g, m;
  while ((m = re.exec(host._html))) {
    var idm = /id="([^"]+)"/.exec(m[2]);
    var clsm = /class="([^"]+)"/.exec(m[2]);
    var el = new El(idm ? idm[1] : '');
    if (clsm) clsm[1].split(/\s+/).forEach(function (c) { el.classList.add(c); });
    if (idm) registry[idm[1]] = el;
    host.childNodes.push(el);
  }
}
function $(id) { return registry[id] || (registry[id] = new El(id)); }
var mem = {};
var store = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); }
};
var sandbox = {
  window: {
    localStorage: store, ATLAS_SITES: [], ATLAS_SPECIES: species,
    ATLAS_LOGIC: L,
    ATLAS_QUIZ: require(path.join(BASE, 'atlas-quiz.js')),
    ATLAS_MYSTERY: require(path.join(BASE, 'atlas-mystery.js'))
  },
  document: {
    getElementById: $,
    querySelectorAll: function () { return []; },
    createElement: function () { return new El(); }
  },
  localStorage: store,
  confirm: function () { return true; },
  setTimeout: function () {},
  encodeURIComponent: encodeURIComponent,
  console: console
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
var m = html.match(/<script>\s*\(function\(\)\{[\s\S]*?\}\)\(\);\s*<\/script>/);
t('找到 atlas.html 内联主脚本', !!m);
vm.runInContext(m[0].replace(/^<script>/, '').replace(/<\/script>$/, ''), sandbox);

/* 首页徽章条：10 枚图案全输出，无 ✓/· 占位 */
var barHtml = $('badges')._html;
icons.forEach(function (ic) { t('首页徽章条输出 ' + ic, barHtml.indexOf(ic) >= 0); });
t('首页徽章条用 ico 容器', (barHtml.match(/class="ico"/g) || []).length === 10);
t('首页无占位字符残留', !/class="medal">[✓·]</.test(barHtml));

/* 徽章墙弹窗：openBadges 通过 badgeBtn 触发，10 枚圆章全带图案 */
$('badgeBtn').onclick();
var wallHtml = $('modal')._html;
icons.forEach(function (ic) { t('徽章墙输出 ' + ic, wallHtml.indexOf(ic) >= 0); });
t('徽章墙用圆形奖牌卡片', wallHtml.indexOf('class="bwall"') >= 0 &&
  wallHtml.indexOf('class="bmedal"') >= 0 && wallHtml.indexOf('class="bcard ') >= 0);
t('徽章墙输出全部 10 枚', (wallHtml.match(/class="bcard /g) || []).length === 10);
t('徽章墙 10 枚圆章全带图案', (wallHtml.match(/class="bico"/g) || []).length === 10);

/* 样式：圆形奖牌 + 未获得灰度 */
t('圆形奖牌是正圆', html.indexOf('.bmedal{') >= 0 && html.indexOf('border-radius:50%') >= 0);
t('未获得图案有灰度样式', html.indexOf('.badge:not(.got) .medal .ico{filter:grayscale(1)') >= 0 &&
  html.indexOf('.bcard:not(.got) .bmedal .bico{filter:grayscale(1)') >= 0);

console.log('徽章图案验证：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
