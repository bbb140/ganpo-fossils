/* 化石图鉴探索原型的核心逻辑（纯函数，可被 node 测试） */
(function (root) {
  'use strict';

  var AREAS = ['赣西北', '赣东北', '赣西', '赣东南'];
  /* 门槛强度：need=每区需通过的产地数，quiz=每处需答对的题数 */
  var LEVELS = {
    easy:   { need: 3, quiz: 1, label: '轻松', desc: '每区 3 处 × 每处 1 题' },
    normal: { need: 3, quiz: 2, label: '标准', desc: '每区 3 处 × 每处 2 题' },
    hard:   { need: 4, quiz: 2, label: '挑战', desc: '每区 4 处 × 每处 2 题' }
  };
  var NEED = 3;                 // 兼容旧引用：默认每区 3 处
  var K = {
    unlocked: 'gbsy_atlas_unlocked',
    found: 'gbsy_atlas_found',
    fossils: 'gbsy_atlas_fossils',
    demo: 'gbsy_atlas_demo',
    level: 'gbsy_atlas_level',
    preDemo: 'gbsy_atlas_preDemo'   // 进入演示前的解锁进度，关闭演示时还原
  };

  var BADGES = [
    { id: 'scout',    name: '初探者',        desc: '探索满 3 处产地',       test: function (s) { return s.found.length >= 3; } },
    { id: 'first',    name: '化石发现者',    desc: '收入第 1 条化石图鉴',   test: function (s) { return s.fossils.length >= 1; } },
    { id: 'hunter',   name: '寻龙者',        desc: '收入 5 条化石图鉴',     test: function (s) { return s.fossils.length >= 5; } },
    { id: 'traveler', name: '走遍赣鄱',      desc: '解锁全部 4 个分区',     test: function (s) { return s.unlocked >= 4; } },
    /* 大师徽章按「可探索获得的图鉴数」判定，不加固定数字——以后加化石自动跟随 */
    { id: 'master',   name: '赣鄱化石大师',  desc: '集齐全部可探索图鉴',   test: function (s, collectable) { return s.fossils.length >= (collectable || 14) && (collectable || 14) > 0; } }
  ];

  function fresh() {
    return { unlocked: 1, found: [], fossils: [], demo: false, level: 'normal', preDemo: 1 };
  }
  function needOf(s) {
    return (LEVELS[s && s.level] || LEVELS.normal).need;
  }
  function quizOf(s) {
    return (LEVELS[s && s.level] || LEVELS.normal).quiz;
  }

  function load(store) {
    function get(k, def) {
      try { var v = store.getItem(k); return v === null ? def : JSON.parse(v); }
      catch (e) { return def; }
    }
    var s = fresh();
    s.unlocked = Math.min(4, Math.max(1, get(K.unlocked, 1) || 1));
    s.found = get(K.found, []) || [];
    s.fossils = get(K.fossils, []) || [];
    s.demo = !!get(K.demo, false);
    s.preDemo = Math.min(4, Math.max(1, get(K.preDemo, 1) || 1));
    var lv = get(K.level, 'normal');
    s.level = LEVELS[lv] ? lv : 'normal';
    return s;
  }

  function save(store, s) {
    try {
      store.setItem(K.unlocked, JSON.stringify(s.unlocked));
      store.setItem(K.found, JSON.stringify(s.found));
      store.setItem(K.fossils, JSON.stringify(s.fossils));
      store.setItem(K.demo, JSON.stringify(s.demo));
      store.setItem(K.level, JSON.stringify(s.level));
      store.setItem(K.preDemo, JSON.stringify(s.preDemo));
    } catch (e) {}
  }
  function setLevel(store, s, level) {
    s.level = LEVELS[level] ? level : 'normal';
    save(store, s);
    return s;
  }

  function reset(store) {
    var s = fresh();
    save(store, s);
    return s;
  }

  function setDemo(store, s, on) {
    on = !!on;
    if (on && !s.demo) {
      s.preDemo = s.unlocked;   // 记住进入演示前的进度
      s.unlocked = 4;           // 演示态：全部解锁
    } else if (!on && s.demo) {
      s.unlocked = Math.min(4, Math.max(1, s.preDemo || 1));  // 关闭：还原
    }
    s.demo = on;
    save(store, s);
    return s;
  }

  function canEnter(s, areaIndex) {
    return s.demo || areaIndex < s.unlocked;
  }

  /* 某区已探索的产地数（用于解锁判定） */
  function foundIn(s, area, sites) {
    var ids = {};
    s.found.forEach(function (id) { ids[id] = 1; });
    return sites.filter(function (r) { return r.region === area && ids[r.id]; }).length;
  }

  /* 探索一处产地：passed=本次知识小考是否全部答对（默认 true 以兼容旧调用）
     未通过则不计入探索、不掉落、不解锁——这是门槛的核心。 */
  function explore(store, s, site, sites, species, passed) {
    if (s.found.indexOf(site.id) > -1) {
      return { already: true, fossils: [], unlockedAreas: [] };
    }
    if (passed === false) {
      return { failed: true, fossils: [], unlockedAreas: [] };
    }
    s.found.push(site.id);
    var dropped = species.filter(function (f) { return f.tapho_link === site.id; });
    var opened = [];
    var need = needOf(s);
    AREAS.forEach(function (area, i) {
      if (i + 1 < 4 && i + 1 === s.unlocked && foundIn(s, area, sites) >= need) {
        s.unlocked = i + 2;
        opened.push(AREAS[i + 1]);
      }
    });
    save(store, s);
    return { already: false, fossils: dropped, unlockedAreas: opened };
  }

  function collect(store, s, fossil) {
    if (!fossil || s.fossils.indexOf(fossil.cn_name) > -1) return false;
    s.fossils.push(fossil.cn_name);
    save(store, s);
    return true;
  }

  /* 一条化石能否被探索获得，取决于它有没有绑定产地编号 */
  function collectableCount(species) {
    return species.filter(function (f) { return !!f.tapho_link; }).length;
  }

  function badges(s, species) {
    var total = collectableCount(species || []);
    return BADGES.map(function (b) {
      return {
        id: b.id, name: b.name,
        desc: b.id === 'master' ? ('集齐 ' + total + ' 条可探索图鉴') : b.desc,
        got: b.test(s, total)
      };
    });
  }

  function stats(s, species) {
    return {
      found: s.found.length,
      fossils: s.fossils.length,
      total: species.length,
      collectable: collectableCount(species),
      unlocked: s.unlocked,
      need: needOf(s),
      badges: badges(s, species).filter(function (b) { return b.got; }).length
    };
  }

  var api = {
    AREAS: AREAS, NEED: NEED, LEVELS: LEVELS, BADGES: BADGES, K: K,
    fresh: fresh, load: load, save: save, reset: reset, setDemo: setDemo,
    needOf: needOf, quizOf: quizOf, setLevel: setLevel,
    canEnter: canEnter, foundIn: foundIn, explore: explore,
    collect: collect, badges: badges, stats: stats, collectableCount: collectableCount
  };

  root.ATLAS_LOGIC = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : global);
