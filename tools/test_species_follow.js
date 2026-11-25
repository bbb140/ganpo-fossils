/* 地图页「代表物种」跟随性测试
   验证三件事：
     ① 检索/筛选 → 只显示命中产地的物种；
     ② 点开某条产地（含名录页 ?code= 跳转、点地图标记）→ 只显示该产地的物种；
        关闭侧栏 → 退回筛选结果；
     ③ 图鉴数据走 fetch 晚到时，首次渲染的"门类聚合"兜底会被自动替换成图鉴卡片。
   跑法：node tools/test_species_follow.js */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.dirname(__dirname);
const read = (p) => fs.readFileSync(path.join(BASE, p), 'utf8');
const SITES = JSON.parse(read('data/sites.json'));
const SPECIES = JSON.parse(read('data/species.json'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('PASS ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

/* ---------- 假 DOM ---------- */
function mkEl(id, tag) {
  return {
    id: id, tagName: tag || 'DIV', value: '', innerHTML: '', textContent: '',
    className: '', hidden: false, _h: {},
    addEventListener(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); },
    fire(ev, obj) {
      (this._h[ev] || []).forEach((fn) => fn(obj || { target: this, preventDefault() {} }));
    },
    appendChild() {}, setAttribute() {}, querySelector() { return null; },
    closest() { return null; }
  };
}

function makeSandbox(opts) {
  const els = {};
  [['flt-q', 'INPUT'], ['flt-area', 'SELECT'], ['flt-zone', 'SELECT'],
   ['flt-acc', 'SELECT'], ['flt-status', 'SELECT'], ['flt-reset', 'BUTTON'],
   ['flt-count', 'SPAN'], ['flt-hint', 'SPAN'], ['species-list', 'DIV'],
   ['species-title', 'H2'], ['species-scope', 'P']].forEach(function (p) {
    els[p[0]] = mkEl(p[0], p[1]);
  });

  const docL = {};
  const document = {
    getElementById(id) { return els[id] || null; },
    createElement(t) { return mkEl('', String(t || 'div').toUpperCase()); },
    addEventListener(ev, fn) { (docL[ev] = docL[ev] || []).push(fn); },
    dispatchEvent(e) { (docL[e.type] || []).forEach((fn) => fn(e)); }
  };
  function FakeCE(type, opt) { this.type = type; this.detail = opt && opt.detail; }

  const ctx = {
    console, document, CustomEvent: FakeCE,
    Promise, setTimeout, clearTimeout, JSON, Math, Date
  };
  ctx.window = ctx;                 // window === 全局，等价浏览器
  ctx.fetch = opts.fetch || function () { return Promise.reject(new Error('no fetch')); };
  if (opts.speciesInline !== undefined) ctx.SPECIES_DATA = opts.speciesInline;
  vm.createContext(ctx);

  vm.runInContext(read('js/fields.js'), ctx);
  vm.runInContext(read('js/species.js'), ctx);
  /* 用最小 GBSY 桩代替 map.js：filter.js 只用到 field / F / sites / applyFilter / show */
  ctx.__sites = SITES;
  vm.runInContext(
    'window.GBSY = {' +
    '  field: field, F: F, sites: __sites, show: __sites.length,' +
    '  applyFilter: function (fn) { var n = 0; __sites.forEach(function (s) { if (fn(s)) n++; }); return n; },' +
    '  focus: function () { return true; }' +
    '};', ctx);
  vm.runInContext(read('js/filter.js'), ctx);
  return { ctx: ctx, els: els, document: document, fire: (ev, d) => document.dispatchEvent({ type: ev, detail: d }) };
}

const cardNames = (html) => (html.match(/class="sp-cn">([^<]+)</g) || [])
  .map((s) => s.replace(/^class="sp-cn">/, '').replace(/<$/, ''));
const hasChips = (html) => /class="taxa-chip"/.test(html);

/* 取一条"有图鉴物种关联"的产地，和它名下的物种数 */
function pickSiteWithSpecies() {
  const linked = SPECIES.filter((s) => s.tapho_link);
  const code = linked[0].tapho_link.split(/[、，,；;]/)[0].trim();
  const site = SITES.find((s) => s.id === code);
  const expect = linked.filter((s) => s.tapho_link.split(/[、，,；;]/)
    .map((x) => x.trim()).indexOf(code) > -1).length;
  return { site: site, code: code, expect: expect, total: linked.length };
}

(async function run() {
  /* ================= 场景 A：内联数据 + 聚焦 ================= */
  console.log('--- 场景 A：检索 / 点产地 / 关闭侧栏');
  const A = makeSandbox({ speciesInline: SPECIES });
  A.fire('gbsy:ready', { sites: SITES });

  const boxA = A.els['species-list'];
  ok(cardNames(boxA.innerHTML).length === pickSiteWithSpecies().total,
     '初始显示全部关联物种 ' + cardNames(boxA.innerHTML).length + ' 条');
  ok(A.els['species-title'].textContent === '当前结果的代表物种', '初始标题为「当前结果的代表物种」');
  ok(/全部 \d+ 处产地/.test(A.els['species-scope'].textContent), '初始范围说明为全部产地');

  /* ① 关键词检索 */
  A.els['flt-q'].value = '珊瑚';
  A.els['flt-q'].fire('input');
  const nCoral = cardNames(boxA.innerHTML).length;
  ok(nCoral > 0 && nCoral < pickSiteWithSpecies().total,
     '检索「珊瑚」后卡片减少到 ' + nCoral + ' 条');
  ok(/已按条件筛选/.test(A.els['species-scope'].textContent), '范围说明切到「已按条件筛选」');

  /* ② 聚焦某条产地：只显示这家的物种 */
  const pick = pickSiteWithSpecies();
  A.fire('gbsy:sitefocus', { rec: pick.site });
  const namesFocused = cardNames(boxA.innerHTML);
  ok(namesFocused.length === pick.expect,
     '聚焦「' + pick.site.name + '」后只剩该产地物种 ' + namesFocused.length + ' 条（期望 ' + pick.expect + '）');
  ok(A.els['species-title'].textContent === '该产地的代表物种', '聚焦时标题切到「该产地的代表物种」');
  ok(/聚焦 /.test(A.els['species-scope'].innerHTML), '范围说明显示聚焦产地名');
  ok(/data-act="all-species"/.test(A.els['species-scope'].innerHTML), '提供「看全部筛选结果」返回入口');

  /* ③ 关闭侧栏 → 回到筛选结果 */
  A.fire('gbsy:siteblur', { rec: null });
  ok(cardNames(boxA.innerHTML).length === nCoral,
     '关闭侧栏后回到检索结果 ' + cardNames(boxA.innerHTML).length + ' 条');
  ok(A.els['species-title'].textContent === '当前结果的代表物种', '标题回到「当前结果的代表物种」');

  /* ④ 重新检索应解除聚焦 */
  A.fire('gbsy:sitefocus', { rec: pick.site });
  A.els['flt-q'].value = '恐龙';
  A.els['flt-q'].fire('input');
  ok(A.ctx.GBSYFilter._focused() === null, '改变检索条件会解除产地聚焦');
  ok(cardNames(boxA.innerHTML).length > 0, '解除聚焦后按新条件渲染 ' + cardNames(boxA.innerHTML).length + ' 条');

  /* ⑤ 无图鉴关联的产地：兜底门类，不空着；并给出手动扩展入口 */
  const bare = SITES.find(function (s) {
    return !SPECIES.some((sp) => (sp.tapho_link || '').indexOf(s.id) > -1);
  });
  if (bare) {
    A.fire('gbsy:sitefocus', { rec: bare });
    const html = boxA.innerHTML;
    ok(hasChips(html) && /该产地暂未关联到图鉴条目/.test(html),
       '无图鉴关联的产地（' + bare.name + '）回退到门类聚合并说明原因');

    const zoneSites = SITES.filter((s) => s.zone === bare.zone);
    if (zoneSites.length > 1) {
      ok(/data-act="zone"/.test(A.els['species-scope'].innerHTML),
         '同一小区有多处产地时，给出「看同小区其他化石」入口（不自动扩展）');
      const before = cardNames(boxA.innerHTML).length;
      ok(before === 0, '扩展前不会自动带出同小区物种（仍为门类聚合）');
      A.ctx.GBSYFilter._expand(true);
      ok(A.ctx.GBSYFilter._zoneExpand() === true, '点「看同小区其他化石」后进入扩展态');
      ok(A.els['species-title'].textContent === '同小区的代表物种', '扩展态标题为「同小区的代表物种」');
      const after = cardNames(boxA.innerHTML).length;
      ok(after > 0, '扩展后显示同小区已关联的物种 ' + after + ' 条');
      A.ctx.GBSYFilter._expand(false);
      ok(cardNames(boxA.innerHTML).length === 0, '「只看本产地」可退回单产地口径');
    }
  }

  /* ================= 场景 B：图鉴数据晚到 ================= */
  console.log('--- 场景 B：fetch 晚于首次渲染');
  const B = makeSandbox({
    fetch: function () {
      return Promise.resolve({ ok: true, text: function () { return Promise.resolve(JSON.stringify(SPECIES)); } });
    }
  });
  B.fire('gbsy:ready', { sites: SITES });
  const boxB = B.els['species-list'];
  ok(hasChips(boxB.innerHTML), '图鉴未到时先按门类聚合兜底（不空白）');

  await new Promise((r) => setTimeout(r, 60));      // 等 fetch/微任务链跑完
  ok(cardNames(boxB.innerHTML).length > 0,
     '图鉴数据到达后自动补渲染成图鉴卡片 ' + cardNames(boxB.innerHTML).length + ' 条');

  /* 补渲染后仍能跟随聚焦 */
  const pick2 = pickSiteWithSpecies();
  B.fire('gbsy:sitefocus', { rec: pick2.site });
  ok(cardNames(boxB.innerHTML).length === pick2.expect,
     '补渲染后聚焦产地仍只显示该地物种 ' + cardNames(boxB.innerHTML).length + ' 条');

  console.log('==== PASS=' + pass + ' FAIL=' + fail + ' ====');
  process.exit(fail ? 1 : 0);
})();
