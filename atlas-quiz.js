/* 化石图鉴探索 · 产地知识小考（纯函数，可被 node 测试）
   设计红线：题目、正确答案、干扰项全部取自 sites 的真实字段，
   一个字都不编。干扰项来自其它产地的真实取值，且与该题答案不同。 */
(function (root) {
  'use strict';

  var FIELDS = [
    { key: 'geological_age',   label: '地质年代', q: '的地质年代是？' },
    { key: 'fossil_group',     label: '化石门类', q: '的主要化石门类是？' },
    { key: 'protection_level', label: '保护级别', q: '的保护级别是？' },
    { key: 'city_county',      label: '所在县市', q: '位于哪个县市？' }
  ];

  function hash(s) {
    var h = 2166136261;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function rng(seed) {
    var st = seed >>> 0;
    return function () { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  }

  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function clean(v) {
    v = String(v == null ? '' : v).trim();
    return (v && v !== '无' && v !== 'None' && v !== '-') ? v : '';
  }

  /* 为某产地生成 count 道题。同一产地每次题目一致（种子确定），便于测试与复盘。 */
  function make(site, sites, count) {
    count = count || 1;
    var seed = hash(site.id || site.name);
    var rnd = rng(seed);
    var order = shuffle(FIELDS, rnd);           // 不同产地题目顺序不同，增加探索感
    var out = [];
    order.forEach(function (f) {
      if (out.length >= count) return;
      var ans = clean(site[f.key]);
      if (!ans) return;
      var pool = {};
      sites.forEach(function (s) {
        var v = clean(s[f.key]);
        if (v && v !== ans) pool[v] = 1;
      });
      var others = Object.keys(pool);
      if (!others.length) return;               // 没有干扰项就不出这题
      var opts = shuffle([ans].concat(shuffle(others, rng(seed ^ hash(f.key))).slice(0, 3)), rnd);
      out.push({
        field: f.key,
        label: f.label,
        q: '「' + site.name + '」' + f.q,
        options: opts,
        answer: ans,
        tip: '线索就在上方信息卡「' + f.label + '」一栏：' + ans
      });
    });
    return out;
  }

  function check(question, chosen) {
    return !!question && chosen === question.answer;
  }

  var api = { FIELDS: FIELDS, make: make, check: check, hash: hash };
  root.ATLAS_QUIZ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
