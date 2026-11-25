/* 盲盒玩法 UI 集成测试：用最小 DOM 桩跑 atlas.html 的真实内联脚本，
   验证按钮、出题、点选判定、下一题、成绩持久化、不碰探索进度。
   node tools/test_atlas_mystery_ui.js */
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var BASE = path.dirname(__dirname);
var pass = 0, fail = 0;
function t(name, ok) { if (ok) { pass++; } else { fail++; console.error('  ✗ ' + name); } }

var html = fs.readFileSync(path.join(BASE, 'atlas.html'), 'utf8');
var species = JSON.parse(fs.readFileSync(path.join(BASE, 'data', 'species.json'), 'utf8'));

/* ---- 最小 DOM 桩 ---- */
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
El.prototype.querySelectorAll = function (sel) { return query(this, sel); };

var registry = {};
function parseInto(host) {
  /* 从 innerHTML 里抽出 id="..." 与 class="..." data-v="..." 的按钮，构造桩元素 */
  var re = /<(\w+)([^>]*)>/g, m;
  while ((m = re.exec(host._html))) {
    var tag = m[1], attrs = m[2];
    var idm = /id="([^"]+)"/.exec(attrs);
    var clsm = /class="([^"]+)"/.exec(attrs);
    var vm2 = /data-v="([^"]*)"/.exec(attrs);
    var el = new El(idm ? idm[1] : '');
    if (clsm) clsm[1].split(/\s+/).forEach(function (c) { el.classList.add(c); });
    if (vm2) el.setAttribute('data-v', vm2[1]);
    el.tag = tag;
    if (idm) registry[idm[1]] = el;
    host.childNodes.push(el);
  }
}
function query(host, sel) {
  /* 简化：按 class 在整个 DOM 桩（registry 及其全部子节点）里筛，够本测试用。
     选项按钮由 open() 设进 modal.innerHTML，挂在 modal 的子节点上，脚本却从 myOpts 查询，
     所以这里忽略 host、全局收集，避免漏掉。 */
  var want = [];
  if (sel.charAt(0) === '.') want = sel.slice(1).split(/[\s\[]/).filter(Boolean);
  var all = [];
  Object.keys(registry).forEach(function (k) {
    all.push(registry[k]);
    all = all.concat(registry[k].childNodes);
  });
  return all.filter(function (el) {
    return want.every(function (w) { return el.classList.contains(w); });
  });
}
function $(id) { return registry[id] || (registry[id] = new El(id)); }

var mem = {};
var store = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); }
};

var sandbox = {
  window: {
    localStorage: store,
    ATLAS_SITES: [], ATLAS_SPECIES: species,
    ATLAS_LOGIC: require(path.join(BASE, 'atlas-logic.js')),
    ATLAS_QUIZ: require(path.join(BASE, 'atlas-quiz.js')),
    ATLAS_MYSTERY: require(path.join(BASE, 'atlas-mystery.js'))
  },
  document: {
    documentElement: { style: {} },
    body: { style: {} },
    getElementById: $,
    querySelectorAll: function (sel) { return query({ childNodes: Object.keys(registry).map(function (k) { return registry[k]; }) }, sel); },
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

/* ---- 抽取 atlas.html 的内联脚本（最后一个 <script> 块）并运行 ---- */
var m = html.match(/<script>\s*\(function\(\)\{[\s\S]*?\}\)\(\);\s*<\/script>/);
t('找到 atlas.html 内联主脚本', !!m);
vm.runInContext(m[0].replace(/^<script>/, '').replace(/<\/script>$/, ''), sandbox);

/* ---- 断言 ---- */
t('盲盒入口按钮已绑定', typeof $('mysteryBtn').onclick === 'function');
t('引入 atlas-mystery.js', html.indexOf('atlas-mystery.js') >= 0);

/* 点击盲盒入口：应出题并展示线索/选项 */
$('mysteryBtn').onclick();
t('盲盒弹窗打开（mask.show）', $('mask').classList.contains('show'));
t('显示第 1 题', $('modal')._html.indexOf('盲盒猜物种') >= 0);
t('显示线索原文', $('modal')._html.indexOf('鉴 定 特 征') >= 0);
t('渲染四个选项', ($('modal')._html.match(/class="opt"/g) || []).length === 4);

/* 从 DOM 桩查询入口取选项按钮（与实际绑定用的是同一套查询） */
function getOpts() {
  return query(null, '.opt').filter(function (el) { return el.getAttribute('data-v'); });
}
var optEls = getOpts();
t('选项按钮都带 data-v', optEls.length === 4 && optEls.every(function (e) { return e.getAttribute('data-v'); }));
var answerOpts = optEls.filter(function (e) { return species.some(function (f) { return f.cn_name === e.getAttribute('data-v'); }); });
t('选项均为真实物种名', answerOpts.length === 4);

/* 用第一个选项作答，验证判定与原文展示流程 */
optEls[0].onclick();
t('作答后显示对错结果', $('myFeedback')._html.indexOf('result') >= 0);
t('作答后展示原文出处', $('myFeedback')._html.indexOf('原文出处') >= 0);
t('出现下一题按钮', !!$('myNext') && typeof $('myNext').onclick === 'function');

/* 作答后：带 right 类的 opt 就是正确答案，被选中的 opt 带 sel/right 或 wrong */
var rightOpt = getOpts().filter(function (el) { return el.classList.contains('right'); })[0];
t('标注了正确答案项', !!rightOpt && species.some(function (f) { return f.cn_name === rightOpt.getAttribute('data-v'); }));
var pickedWasRight = (rightOpt && rightOpt.getAttribute('data-v') === optEls[0].getAttribute('data-v'));
t('所选答案对错标注正确',
  pickedWasRight ? $('myFeedback')._html.indexOf('答对') >= 0
                 : $('myFeedback')._html.indexOf('答案是') >= 0);

/* 下一题：应回到出题态 */
$('myNext').onclick();
t('下一题：仍在盲盒弹窗', $('modal')._html.indexOf('盲盒猜物种') >= 0);
t('下一题：出现重新渲染的线索', $('modal')._html.indexOf('鉴 定 特 征') >= 0);

/* 退出：答对过才写入最佳成绩（0 分不写是合理行为） */
var quit = $('myQuit');
if (quit && typeof quit.onclick === 'function') quit.onclick();
t('退出时按成绩写入 localStorage（答对写入，未答对不写）',
  pickedWasRight ? mem['gbsy_mystery_best'] === '1' : mem['gbsy_mystery_best'] == null);
t('盲盒状态与探索进度隔离（未写入 found/fossils）',
  mem['gbsy_atlas_found'] == null || mem['gbsy_atlas_found'] === '[]');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
