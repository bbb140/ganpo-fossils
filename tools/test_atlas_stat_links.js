/* 图鉴页四个统计项必须都是可点入口，并且演示版同步。
   node tools/test_atlas_stat_links.js */
const fs = require('fs');
const path = require('path');

const BASE = path.dirname(__dirname);
let pass = 0, fail = 0;
function t(name, ok, extra) {
  if (ok) { pass++; console.log('✔ ' + name + (extra ? ' → ' + extra : '')); }
  else { fail++; console.log('✘ ' + name + (extra ? ' → ' + extra : '')); }
}

const html = fs.readFileSync(path.join(BASE, 'atlas.html'), 'utf8');
const a = html.indexOf('<div class="hud">');
const b = html.indexOf('<div class="lvbar">');
const hud = a > -1 && b > a ? html.slice(a, b) : '';
const script = html.slice(html.lastIndexOf('<script>'), html.lastIndexOf('</script>'));

const targets = [...hud.matchAll(/<button[^>]*class="stat"[^>]*data-go="([^"]+)"/g)]
  .map(function (m) { return m[1]; });
t('四个统计项都是可点按钮', targets.join(',') === 'found,fossil,area,badge', targets.join(','));
t('按钮类型不会误提交表单', (hud.match(/type="button"/g) || []).length === 4);
t('每项都有进入箭头', (hud.match(/class="go"/g) || []).length === 4);
t('鼠标悬停与键盘焦点都有反馈',
  /\.stat:hover\{/.test(html) && /\.stat:focus-visible\{/.test(html));

t('已探索产地清单已实现', /function openFound\(/.test(script));
t('分区总览已实现', /function openAreas\(/.test(script));
t('图鉴本与徽章墙入口复用已有弹窗',
  /go==='fossil'\)\s*openAtlas\(\)/.test(script) &&
  /go==='badge'\)\s*openBadges\(\)/.test(script));
t('四项都接上了跳转',
  ['found', 'fossil', 'area', 'badge'].every(function (go) {
    return script.indexOf("go==='" + go + "'") > -1;
  }));
t('产地清单条目直达地图', /map\.html\?code=/.test(script));
t('锁定分区不给进入', /site:not\(\.locked\)/.test(script));

const demo = path.join(BASE, 'atlas-demo.html');
if (fs.existsSync(demo)) {
  const d = fs.readFileSync(demo, 'utf8');
  t('本地演示版已同步统计入口', d.indexOf('data-go="found"') > -1);
  t('演示版仍是全解锁态', /setDemo\(\s*store\s*,\s*state\s*,\s*true\s*\)/.test(d));
}

console.log('\n==== PASS=' + pass + ' FAIL=' + fail + ' ====');
process.exit(fail ? 1 : 0);
