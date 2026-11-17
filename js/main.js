/* ============================================================
   js/main.js —— 首页四大分区渲染
   数据源：window.SITES_DATA（dist 离线版）优先，否则 fetch ./data/sites.json
   职责：把 index.html 里 4 个 section[data-region] 填满
        （副标题 / 导语 / 产地表 / 代表门类卡片），一个数字都不写死。

   为什么不在 HTML 里硬编码：
   v1.2 一刷、A-05 升级坐标、以后扩档到 45 条，首页数字都会变；
   写死就意味着每次改数据还要改 HTML，两边迟早不一致。
   ============================================================ */
(function () {
  'use strict';

  const AREA_ORDER = ['赣西北', '赣东北', '赣西', '赣东南'];
  /* 字段层统一由 js/fields.js 提供（不再自带一份，避免三处各写一遍） */
  const F = window.GBSYFields.F;
  const fieldG = window.GBSYFields.field;
  function get(rec, alts) { return String(fieldG(rec, alts) || '').trim(); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 把「奥陶纪 / 志留纪」这类长词拆成可计数的原子（顿号、逗号、分号都算分隔） */
  function parts(v) {
    return String(v || '').split(/[、，,；;]/).map(function (x) {
      return x.trim();
    }).filter(Boolean);
  }
  function topN(list, n) {
    const c = {};
    list.forEach(function (k) { if (k) c[k] = (c[k] || 0) + 1; });
    return Object.keys(c)
      .sort(function (a, b) { return c[b] - c[a] || a.length - b.length; })
      .slice(0, n)
      .map(function (k) { return { key: k, n: c[k] }; });
  }

  function render(recs) {
    const total = recs.length;
    const st = document.getElementById('stat-total');
    if (st) st.textContent = total;

    const zones = {};
    recs.forEach(function (r) {
      const z = get(r, F.zone);
      /* 只数 12 个标准小区：「其它（…）」「未定（…）」「待确认」都不算覆盖 */
      if (z && !/^(其它|未定|待确认)/.test(z)) zones[z.split('（')[0]] = 1;
    });
    const sz = document.getElementById('stat-zones');
    if (sz) sz.textContent = Object.keys(zones).length;

    document.querySelectorAll('section[data-region]').forEach(function (sec) {
      const area = sec.getAttribute('data-region');
      const rows = recs.filter(function (r) {
        /* 必须精确比较：用 indexOf 会让「赣西」把「赣西北」也算进来 */
        return get(r, F.region).replace(/大区|\s/g, '') === area;
      });

      /* 副标题：取本区前两个「年代 + 门类」组合，纯事实拼接，不做文学加工 */
      const ages = topN(rows.map(function (r) { return get(r, F.age); }), 2);
      const taxaAll = rows.map(function (r) { return get(r, F.taxa); });
      const taxaFlat = [];
      taxaAll.forEach(function (t) { parts(t).forEach(function (x) { taxaFlat.push(x); }); });
      const taxaTop = topN(taxaFlat, 2);

      const h2 = sec.querySelector('h2');
      if (h2) {
        h2.textContent = area + (taxaTop.length
          ? ' · ' + taxaTop.map(function (t) { return t.key; }).join('与')
          : '');
      }

      /* 导语：条数 + 小区 + 门类 + 坐标口径，一句话说清，不编故事 */
      const zs = {};
      rows.forEach(function (r) {
        const z = get(r, F.zone);
        if (z) zs[z] = (zs[z] || 0) + 1;
      });
      const zText = Object.keys(zs).map(function (k) { return k + ' ' + zs[k] + ' 条'; }).join('、');
      const lead = sec.querySelector('.region-lead');
      if (lead) {
        lead.textContent = rows.length
          ? '本站已收录本区 ' + rows.length + ' 条记录（' + zText + '）；' +
            '年代以' + (ages.length ? ages.map(function (a) { return a.key; }).join('、') : '待补') +
            '为主，代表门类为' + (taxaTop.length ? taxaTop.map(function (t) { return t.key; }).join('、') : '待补') +
            '。坐标均为行政驻地占位，误差范围见地图页说明。'
          : '本区暂无已收录记录，规划口径见《保护规划》表 1。';
      }

      /* 产地表：按编号排序，保证每次刷新顺序一致 */
      const tb = sec.querySelector('tbody');
      if (tb) {
        if (!rows.length) {
          tb.innerHTML = '<tr><td colspan="5" class="empty-row">暂无记录</td></tr>';
        } else {
          tb.innerHTML = rows.slice().sort(function (a, b) {
            return get(a, F.code).localeCompare(get(b, F.code));
          }).map(function (r) {
            const lv = get(r, F.dstat) || '—';
            return '<tr>' +
              '<td>' + esc(get(r, F.name)) + '</td>' +
              '<td>' + esc(get(r, F.county)) + '</td>' +
              '<td>' + esc(get(r, F.age)) + '</td>' +
              '<td>' + esc(get(r, F.taxa)) + '</td>' +
              '<td>' + esc(lv) + '</td>' +
              '</tr>';
          }).join('');
        }
      }

      /* 代表门类卡片：B 岗图鉴数据到位则渲染图鉴，否则按门类聚合兜底 */
      const cards = sec.querySelector('.species-cards');
      if (cards) {
        function fallbackCards() {
          cards.innerHTML = taxaTop.length
            ? taxaTop.map(function (t) {
                const example = rows.filter(function (r) {
                  return get(r, F.taxa).indexOf(t.key) > -1;
                })[0];
                return '<div class="taxa-card"><strong>' + esc(t.key) + '</strong>' +
                       '<span>' + t.n + ' 条记录</span>' +
                       (example ? '<em>' + esc(get(example, F.name).slice(0, 18)) + '</em>' : '') +
                       '</div>';
              }).join('')
            : '<div class="taxa-card"><span>门类待补</span></div>';
        }
        const sp = window.GBSYSpecies;
        if (!(sp && sp.has() && sp.renderCards(cards, rows))) fallbackCards();
      }
    });

    console.log('[赣鄱石语] 首页已渲染：' + total + ' 条记录 / ' +
                document.querySelectorAll('section[data-region]').length + ' 个分区');
  }

  function fail(err) {
    console.error('[赣鄱石语] 首页数据读取失败：', err);
    document.querySelectorAll('section[data-region] .region-lead').forEach(function (p) {
      p.textContent = '数据未载入：若地址栏是 file://，请用 Live Server 打开，或使用 dist 离线版。';
    });
  }

  const src = (typeof window !== 'undefined' && window.SITES_DATA)
    ? Promise.resolve(window.SITES_DATA)
    : fetch('./data/sites.json').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });

  let lastRecs = [];
  src.then(function (raw) {
    const recs = Array.isArray(raw) ? raw : (raw.sites || raw.data || []);
    lastRecs = recs;
    render(recs);
  }).catch(fail);

  /* 图鉴数据若晚到（fetch 比 sites 慢），数据就绪后重绘一次，避免停在门类聚合兜底 */
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('gbsy:species', function () { render(lastRecs); });
  }
})();
