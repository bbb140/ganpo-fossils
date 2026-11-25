/* ============================================================
   js/species.js —— 物种图鉴渲染层（B 岗数据接入点）

   作用：把 data/species.json（当前 162 条图鉴，55 条有产地编号）渲染到两处：
     · 首页四个分区的 .species-cards
     · 地图页筛选结果的 #species-list

   设计原则（务必保持）：
   1) 数据为空 / 0 字节 / 缺字段时，has() 返回 false，
      首页与地图页各自回退到原来的「按门类聚合」，现在能看到的效果一点不变；
   2) 不依赖 fields.js / leaflet，自带字段别名层，独立可用；
   3) 在线版 fetch data/species.json；离线版读内联 window.SPECIES_DATA（file:// 不能 fetch）；
   4) 数据到达后派发 gbsy:species 事件，让已渲染的页面重新填图鉴区。

   ------------------------------------------------------------
   B 岗填写 data/species.json 的字段契约（数组，每条一个对象）：
     genus         属名（拉丁，首字母大写）        如 "Qianzhousaurus"
     species       种加词（拉丁，小写）            如 "sinensis"
     author_year   命名人 + 年份                   如 "Lü et al., 2014"
     cn_name       中文名                         如 "中华虔州龙"
     age           地质年代                       如 "晚白垩世"
     region        所属大区（赣西北/赣东北/赣西/赣东南）
     taxa          门类（与产地表的 fossil_group 用词一致，用于关联）
     classification 分类位置（纲/目/科）          如 "兽脚亚目 暴龙超科"
     features      鉴定要点（150–200 字正文）
     reference     参考文献（Zotero 条目）
     tapho_link    关联产地编号（对应 sites.json 的 id，多个用顿号分隔）
   中文字段名同样识别（见下方 F 别名表）。
   ============================================================ */
(function () {
  'use strict';

  /* 字段别名：英文优先，中文兜底。与 fields.js 的写法一致 */
  const F = {
    genus:   ['genus', '属名', '属'],
    species: ['species', '种加词', '种'],
    author:  ['author_year', 'author', '命名人', '命名人年份'],
    cn:      ['cn_name', 'name_cn', '中文名', '中名'],
    age:     ['age', 'geological_age', '地质年代', '时代'],
    region:  ['region', '保护分区', '大区'],
    taxa:    ['taxa', 'fossil_group', '门类', '化石门类'],
    cls:     ['classification', '分类位置', '分类'],
    features:['features', '鉴定要点', '特征', '形态特征'],
    ref:     ['reference', 'ref', '参考文献', '文献'],
    site:    ['tapho_link', 'site_code', '关联产地', '产地编号', '编号']
  };

  let items = [];

  function normalizeKey(k) {
    return String(k).replace(/[（(][^）)]*[）)]/g, '').replace(/[\s\u00a0]/g, '');
  }
  function pick(s, names) {
    if (!s || typeof s !== 'object') return '';
    for (let i = 0; i < names.length; i++) {
      const v = s[names[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    const keys = Object.keys(s);
    for (let i = 0; i < keys.length; i++) {
      const nk = normalizeKey(keys[i]);
      for (let j = 0; j < names.length; j++) {
        if (nk === normalizeKey(names[j])) {
          const v = s[keys[i]];
          if (v !== undefined && v !== null && v !== '') return v;
        }
      }
    }
    return '';
  }
  function val(s, names) {
    const v = pick(s, names);
    return (v === undefined || v === null) ? '' : String(v).trim();
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cut(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /* 容错解析：0 字节 / 非 JSON / 非数组 / 字段全空 都当无数据 */
  function normalize(raw) {
    let arr = raw;
    if (typeof raw === 'string') {
      if (!raw.trim()) return [];
      try { arr = JSON.parse(raw); } catch (e) { return []; }
    }
    if (arr && !Array.isArray(arr)) arr = arr.items || arr.species || arr.data || [];
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (it) {
      if (!it || typeof it !== 'object') return false;
      /* 一条图鉴至少要能叫出名字，否则视为空骨架 */
      return val(it, F.cn) || val(it, F.genus) || val(it, F.cls);
    });
  }

  /* 一条图鉴是否与当前这批产地相关：
     ① 有 tapho_link → 编号精确匹配（唯一可靠的关联方式）
     ② 无 link 但有 region → 仅在全表无编号条目极少（<=2，早期斑嵴龙那种特例）
        且整批 sites 同属一个大区时按大区匹配；图鉴扩容到 107 条无编号文献条目后
        此分支自动失效。
     ③ 早期还有"按门类交集"的宽松回退，现已移除：107 条无编号化石会让每个分区
        都挂上上百张"具体不详"卡片（实测 110–131 张），与"代表物种"语义严重不符，
        也违背"不推测关联"的约定。无编号化石只在图鉴探索页作文献条目展示。 */
  function related(item, sites) {
    if (!sites || !sites.length) return false;
    const link = val(item, F.site);
    if (link) {
      const codes = link.split(/[、，,；;]/).map(function (x) { return x.trim(); }).filter(Boolean);
      return codes.some(function (c) {
        return sites.some(function (s) { return val(s, ['id', '记录编号']) === c; });
      });
    }
    const fewNoLink = items.length > 0 &&
                      items.filter(function (it) { return !val(it, F.site); }).length <= 2;
    const rg = val(item, F.region);
    if (rg && fewNoLink) {
      const areas = {};
      sites.forEach(function (s) {
        const a = val(s, ['region', '保护分区', '大区']).replace(/大区|\s/g, '');
        if (a) areas[a] = 1;
      });
      /* 整批产地同属一个大区、且与图鉴 region 一致 → 按大区关联。
         要求 sites.length > 1：单条产地（点地图/精确筛选）不挂"产地不详"的图鉴，
         否则任何一条赣东南产地都会错误地显示斑嵴龙。 */
      const keys = Object.keys(areas);
      if (sites.length > 1 && keys.length === 1 &&
          keys[0].indexOf(rg.replace(/大区|\s/g, '')) > -1) return true;
    }
    /* 不再按门类猜测关联：无编号条目已达 107 条，按门类会把每个分区都塞满
       "具体不详"卡片。只有编号精确匹配才挂到产地，其余留给图鉴探索页。 */
    return false;
  }

  function cardHTML(it) {
    const cn = val(it, F.cn), genus = val(it, F.genus),
          species = val(it, F.species), author = val(it, F.author);
    const sci = [genus, species].filter(Boolean).join(' ');
    let name = '';
    if (cn) name += '<strong class="sp-cn">' + esc(cn) + '</strong>';
    if (sci) {
      name += (name ? '<br>' : '') + '<em class="sp-sci">' + esc(sci) + '</em>' +
              (author ? ' <span class="sp-author">' + esc(author) + '</span>' : '');
    }
    if (!name) name = '<strong>' + esc(val(it, F.cls) || '图鉴条目') + '</strong>';

    const meta = [val(it, F.cls), val(it, F.age)].filter(Boolean);
    const feat = val(it, F.features), ref = val(it, F.ref), link = val(it, F.site);
    let html = '<div class="species-card">' + name;
    if (meta.length) html += '<div class="sp-meta">' + esc(meta.join(' · ')) + '</div>';
    if (feat && feat !== '无') html += '<p class="sp-feat">' + esc(cut(feat, 64)) + '</p>';
    if (link) {
      const code = link.split(/[、，,；;]/)[0].trim();
      html += '<a class="sp-link" href="map.html?code=' + encodeURIComponent(code) + '">地图定位 →</a>';
    } else {
      /* 无产地编号：明确标注"具体不详"，不编造定位，也不显示地图定位链接。
         如斑嵴龙正模为匿名捐赠，原文仅记「赣州附近 Hongcheng 盆地」，无工地可对。 */
      const rg = val(it, F.region);
      html += '<span class="sp-unknown">产地：' + esc(rg || '未详') + '（具体不详）</span>';
    }
    if (ref && ref !== '无') html += '<div class="sp-ref">' + esc(cut(ref, 52)) + '</div>';
    return html + '</div>';
  }

  /* 渲染入口：main.js / filter.js 调用。sites 是当前分区 / 当前筛选的产地数组。
     返回 true 表示确实渲染了图鉴；false 表示本范围无关联条目，
     调用方据此回退到门类聚合，避免空白。 */
  function renderCards(container, sites) {
    if (!container) return false;
    const picked = items.filter(function (it) { return related(it, sites || []); });
    if (!picked.length) return false;
    container.innerHTML = picked.map(cardHTML).join('');
    return true;
  }

  function has() { return items.length > 0; }
  function get() { return items; }

  function announce() {
    if (typeof document === 'undefined' || !document.dispatchEvent) return;
    try {
      const ev = typeof CustomEvent === 'function'
        ? new CustomEvent('gbsy:species', { detail: { count: items.length } })
        : null;
      if (ev) document.dispatchEvent(ev);
    } catch (e) { /* 老环境无 CustomEvent，忽略：调用方仍会在渲染时看到 has() */ }
  }

  function load() {
    /* 离线版：build_offline.py 内联的数据，同步可用 */
    if (typeof window !== 'undefined' && window.SPECIES_DATA !== undefined) {
      items = normalize(window.SPECIES_DATA);
      return Promise.resolve(items);
    }
    if (typeof fetch !== 'function') return Promise.resolve(items);
    return fetch('./data/species.json')
      .then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (t) { items = normalize(t); announce(); return items; })
      .catch(function () { items = []; return items; });
  }

  window.GBSYSpecies = {
    has: has, get: get, load: load, normalize: normalize,
    renderCards: renderCards, related: related, _fields: F
  };

  load();
})();
