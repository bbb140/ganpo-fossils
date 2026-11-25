/* 化石图鉴探索 · 盲盒猜物种（纯函数，可被 node 测试）
   设计红线：线索逐字摘自 species.features 原文，答案与干扰项都是图鉴里真实的 cn_name，
   一个字都不编。干扰项同类群优先，答案唯一。新增化石后自动进题库，不写死条数。 */
(function (root) {
  'use strict';

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
  function uniq(arr) {
    var seen = {}, out = [];
    arr.forEach(function (x) { var k = String(x); if (!seen[k]) { seen[k] = 1; out.push(x); } });
    return out;
  }
  /* 按句号/分号/破折号切句，保留标点（不使用 lookbehind，兼容老浏览器）。
     破折号也要切：斑嵴龙「头冠呈阶梯状、两侧纵沟细纹——属名斑嵴即由此而来」
     前半是绝佳谜面，后半泄露答案，必须拆开才能只留前半。 */
  function splitSentences(text) {
    var s = String(text || ''), out = [], buf = '';
    for (var i = 0; i < s.length; i++) {
      buf += s.charAt(i);
      var c = s.charAt(i);
      if (c === '。' || c === '；' || c === '!') { if (buf.trim()) out.push(buf.trim()); buf = ''; }
      else if (c === '—' && s.charAt(i + 1) === '—') {  // 连吃两个破折号
        if (buf.trim()) out.push(buf.trim());
        buf = ''; i++;
      }
    }
    if (buf.trim()) out.push(buf.trim());
    return out;
  }

  var GOOD = /鉴别特征|最醒目|已知最小|区别于|形态与|形成对比|首次|唯一|最长|最短|标志|揭示|证明|呈|具/;
  var VIVID = /鹤鸵|头盔|泥潭|挣扎|獠牙|吉尼斯|阶梯状|纵沟|斜行|K.?形|方形凹槽|凹窝|角突/; // 形象、好记的描述
  var BAD = /正型标本|正模标本|编号|藏于|采自|馆藏|副型/;       // 标本保管信息不是线索
  var NAMEWORD = /属名|种名|命名|即由此而来|取自|源自/;          // 词源解释常把答案说出来，直接排除
  var COMPARE = /与.{1,10}(类似|相似|相同)/;                      // 提及其它物种，劣后
  var FIGREF = /[（(]图\s*\d/;                                     // 图册原文里的「（图4-1-1）」排版图号，读起来突兀，劣后
  var CITATION = /研究所|地质部|博物馆|\d{4}[a-z]?）/;            // 文献出处残句（切句后的尾巴），非鉴定特征，排除

  /* 从 features 原文挑出候选线索句（按辨识度排序），返回的是原文逐字片段。
     不报中文名/拉丁名，不取词源解释句——否则「斑嵴」这类答案字面就漏出来了。 */
  function cluesOf(f, limit) {
    f = f || {};
    var name = f.cn_name || '', genus = f.genus || '', species = f.species || '';
    var scored = [];
    splitSentences(f.features).forEach(function (s) {
      var low = s.toLowerCase();
      if (genus && low.indexOf(genus.toLowerCase()) >= 0) return;   // 不报拉丁属名
      if (species && low.indexOf(species.toLowerCase()) >= 0) return; // 不报种加词
      if (name && s.indexOf(name) >= 0) return;                      // 不报中文全名
      if (NAMEWORD.test(s)) return;                                  // 不报词源解释（会泄露答案字面）
      if (CITATION.test(s)) return;                                  // 不报文献出处残句（无鉴定信息）
      var n = s.length;
      if (n < 15 || n > 160) return;                                 // 太短没信息，太长不好读
      var score = 0;
      if (GOOD.test(s)) score += 4;
      if (VIVID.test(s)) score += 5;                                 // 形象描述优先，谜面更好猜
      if (/\d/.test(s) && !FIGREF.test(s)) score += 2;              // 具体数据加分；图号里的数字不算（否则带图号残句会胜出）
      if (BAD.test(s)) score -= 5;
      if (COMPARE.test(s)) score -= 3;
      if (FIGREF.test(s)) score -= 8;                              // 带排版图号的句子大幅劣后，谜面更干净
      if (n >= 25 && n <= 110) score += 1;
      scored.push({ s: s, score: score });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var out = scored.map(function (x) { return x.s; });
    if (!out.length) {                                               // 兜底：仍是原文逐字片段
      var text = String(f.features || '');
      if (text) out.push(text.slice(0, 90));
    }
    return limit == null ? out : out.slice(0, limit);
  }

  /* 兼容单句调用：取辨识度最高的一条 */
  function clueOf(f) { return cluesOf(f, 1)[0] || ''; }

  /* 生成一轮盲盒题。count 默认取全部物种；seed 变化时题目与选项顺序变化（可"换一批"）。
     同一 seed 结果确定，便于复盘与测试。 */
  function make(species, count, seed) {
    var arr = (species || []).filter(function (f) { return f && f.cn_name && f.features; });
    if (!arr.length) return [];
    var rnd = rng(hash(seed == null ? 'gbsy' : seed));
    var pool = shuffle(arr, rnd);
    var take = Math.min(count == null ? arr.length : count, pool.length);
    var out = [];
    pool.slice(0, take).forEach(function (f) {
      var ans = f.cn_name;
      var same = arr.filter(function (x) { return x.cn_name !== ans && x.taxa === f.taxa; })
                    .map(function (x) { return x.cn_name; });
      var others = shuffle(same, rnd);
      if (others.length < 3) {                                       // 同类群不足，用其它真实物种补
        var rest = arr.filter(function (x) {
          return x.cn_name !== ans && same.indexOf(x.cn_name) < 0;
        }).map(function (x) { return x.cn_name; });
        others = others.concat(shuffle(rest, rnd));
      }
      var options = shuffle(uniq([ans].concat(others.slice(0, 3))), rnd);
      var clues = cluesOf(f);
      out.push({
        clue: clues[0] || '',
        moreClues: clues.slice(1, 3),                                // 备选线索，用于「再给一条」提示
        source: 'features',                                          // 标注线索来源字段，便于核验
        answer: ans,
        options: options,
        taxa: f.taxa || '', age: f.age || '', region: f.region || '',
        detail: String(f.features || ''),                            // 答对后展示的科普原文
        reference: f.reference || ''
      });
    });
    return out;
  }

  function check(question, chosen) { return !!question && chosen === question.answer; }

  var api = { hash: hash, rng: rng, shuffle: shuffle, splitSentences: splitSentences,
              clueOf: clueOf, cluesOf: cluesOf, make: make, check: check };
  root.ATLAS_MYSTERY = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
