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
    // 进入演示前的进度快照：关闭演示时完整还原，避免"已收8条却只解锁1区"
    preDemo: 'gbsy_atlas_preDemo',
    preFound: 'gbsy_atlas_preFound',
    preFossils: 'gbsy_atlas_preFossils'
  };

  /* 地质年代归类：字段写法很杂（"晚白垩世"/"古新世（池江组）"/"始新世…"），
     按关键词归到三代，用于「穿越时空」徽章。返回 null 表示无法归类。 */
  function eraOf(age) {
    var a = String(age || '');
    if (/寒武|奥陶|志留|泥盆|石炭|二叠/.test(a)) return '古生代';
    if (/三叠|侏罗|白垩/.test(a)) return '中生代';
    if (/古近|新近|第四|古新|始新|渐新|中新|更新|全新/.test(a)) return '新生代';
    return null;
  }
  /* 门类归类：恐龙/恐龙蛋归"恐龙类"，笔石并入古无脊椎，其余按原 taxa */
  function kindOf(taxa) {
    var t = String(taxa || '');
    if (t === '恐龙' || t === '恐龙蛋') return '恐龙类';
    if (t === '笔石' || t === '古无脊椎动物') return '古无脊椎';
    if (t === '古脊椎动物' || t === '哺乳动物') return '古脊椎';
    return t;
  }

  var BADGES = [
    { id: 'scout',    name: '初探者',        icon: '🔍', desc: '探索满 3 处产地',       test: function (s) { return s.found.length >= 3; } },
    { id: 'first',    name: '化石发现者',    icon: '🦴', desc: '收入第 1 条化石图鉴',   test: function (s) { return s.fossils.length >= 1; } },
    { id: 'hunter',   name: '寻珍者',        icon: '💎', desc: '收入 5 条化石图鉴',     test: function (s) { return s.fossils.length >= 5; } },
    { id: 'traveler', name: '走遍赣鄱',      icon: '🗺️', desc: '解锁全部 4 个分区',     test: function (s) { return s.unlocked >= 4; } },
    /* 以下 5 枚为图鉴扩容（162 条）后新增，条件全部数据驱动，不写死条数。
       test 第三参 species：按已收集名字回查门类/年代/大区，判断覆盖面。 */
    { id: 'invert',   name: '无脊椎收藏家',  icon: '🐚', desc: '收入 10 条古无脊椎化石',
      test: function (s, total, sp) { return countKind(s, sp, '古无脊椎') >= 10; } },
    { id: 'dino',     name: '龙裔传人',      icon: '🦕', desc: '集齐全部可探索的恐龙类化石',
      test: function (s, total, sp) {
        var allDino = (sp || []).filter(function (f) { return f.tapho_link && kindOf(f.taxa) === '恐龙类'; });
        return allDino.length > 0 && s.fossils.length >= allDino.length &&
               allDino.every(function (f) { return s.fossils.indexOf(f.cn_name) > -1; });
      } },
    { id: 'time',     name: '穿越时空',      icon: '⏳', desc: '古生代、中生代、新生代各收 1 条',
      test: function (s, total, sp) {
        var eras = {};
        (sp || []).forEach(function (f) {
          if (s.fossils.indexOf(f.cn_name) > -1) { var e = eraOf(f.age); if (e) eras[e] = 1; }
        });
        return eras['古生代'] && eras['中生代'] && eras['新生代'];
      } },
    { id: 'quad',     name: '四方藏家',      icon: '🧭', desc: '赣西北、赣东北、赣西、赣东南各收 1 条',
      test: function (s, total, sp) {
        var areas = {};
        (sp || []).forEach(function (f) {
          if (s.fossils.indexOf(f.cn_name) > -1 && f.region) areas[f.region] = 1;
        });
        return AREAS.every(function (a) { return areas[a]; });
      } },
    { id: 'half',     name: '半壁江山',      icon: '📚', desc: '收入全部可探索图鉴的一半',
      test: function (s, total) { return total > 0 && s.fossils.length >= Math.ceil(total / 2); } },
    /* 大师徽章按「可探索获得的图鉴数」判定，不加固定数字——以后加化石自动跟随 */
    { id: 'master',   name: '赣鄱化石大师',  icon: '🏆', desc: '集齐全部可探索图鉴',   test: function (s, collectable) { return s.fossils.length >= (collectable || 14) && (collectable || 14) > 0; } }
  ];

  /* 已收集化石里属于某门类的条数 */
  function countKind(s, sp, kind) {
    var n = 0;
    (sp || []).forEach(function (f) {
      if (s.fossils.indexOf(f.cn_name) > -1 && kindOf(f.taxa) === kind) n++;
    });
    return n;
  }

  function fresh() {
    return { unlocked: 1, found: [], fossils: [], demo: false, level: 'normal',
             preDemo: 1, preFound: [], preFossils: [] };
  }
  /* localStorage 里可能被塞进非数组/非数字（旧版残留、手工改过、脚本写错）。
     读取时一律归一化，避免 foundIn()/collect() 在 forEach/indexOf 处抛错白屏。 */
  function arr(v) {
    return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x; }) : [];
  }
  function boundedInt(v, def, lo, hi) {
    var n = Number(v);
    return (isFinite(n) && n >= lo && n <= hi) ? Math.floor(n) : def;
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
    s.unlocked = boundedInt(get(K.unlocked, 1), 1, 1, 4);
    s.found = arr(get(K.found, []));
    s.fossils = arr(get(K.fossils, []));
    s.demo = !!get(K.demo, false);
    s.preDemo = boundedInt(get(K.preDemo, 1), 1, 1, 4);
    s.preFound = arr(get(K.preFound, []));
    s.preFossils = arr(get(K.preFossils, []));
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
      store.setItem(K.preFound, JSON.stringify(s.preFound || []));
      store.setItem(K.preFossils, JSON.stringify(s.preFossils || []));
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
      s.preDemo = s.unlocked;              // 记住进入演示前的进度
      s.preFound = (s.found || []).slice();
      s.preFossils = (s.fossils || []).slice();
      s.unlocked = 4;                      // 演示态：全部解锁
    } else if (!on && s.demo) {
      s.unlocked = Math.min(4, Math.max(1, s.preDemo || 1));
      s.found = arr(s.preFound);           // 演示期勘探/收集不带入正式进度
      s.fossils = arr(s.preFossils);
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
    var dinoTotal = (species || []).filter(function (f) {
      return f.tapho_link && kindOf(f.taxa) === '恐龙类';
    }).length;
    return BADGES.map(function (b) {
      var desc = b.desc;
      if (b.id === 'master') desc = '集齐 ' + total + ' 条可探索图鉴';
      if (b.id === 'dino' && dinoTotal) desc = '集齐 ' + dinoTotal + ' 条可探索恐龙类化石';
      if (b.id === 'half' && total) desc = '收入 ' + Math.ceil(total / 2) + ' 条（可探索的一半）';
      return { id: b.id, name: b.name, icon: b.icon || '', desc: desc, got: b.test(s, total, species || []) };
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
