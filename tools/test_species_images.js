/* 测试：化石标本照片接入
   1) 数据：image/images 指向真实文件，封面在列表首位
   2) 卡片：js/species.js 有图渲染缩略图，无图不渲染 img
   3) 图鉴详情：atlas.html 有主图/多角度切换/来源标注
   4) 盲盒：答完展示标本照 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.dirname(__dirname);
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('PASS ' + m)) : (fail++, console.log('FAIL ' + m)); };

const species = JSON.parse(fs.readFileSync(path.join(BASE, 'data', 'species.json'), 'utf8'));
const withPic = species.filter(x => Array.isArray(x.images) && x.images.length);

// 1) 数据完整性
ok(withPic.length === 43, '有图物种 43 条（实际 ' + withPic.length + '）');
let missing = [], notFirst = [], badCredit = 0;
withPic.forEach(x => {
  if (x.images[0] !== x.image) notFirst.push(x.cn_name);
  if (!x.image_credit) badCredit++;
  x.images.forEach(rel => {
    if (!fs.existsSync(path.join(BASE, rel))) missing.push(x.cn_name + ':' + rel);
  });
});
ok(missing.length === 0, '图片文件全部存在' + (missing.length ? '：' + missing.slice(0, 3).join(',') : ''));
ok(notFirst.length === 0, 'image 与 images[0] 一致（封面首位）');
ok(badCredit === 0, '每条有图物种都有来源标注');
const totalPic = withPic.reduce((n, x) => n + x.images.length, 0);
ok(totalPic === 93, '图片总数 93（实际 ' + totalPic + '）');
ok(withPic.every(x => /^assets\/fossils\/[0-9]+_\d+\.webp$/.test(x.images[0])), '图片路径为 ASCII 规范名');

// 2) species.js 卡片
const code = fs.readFileSync(path.join(BASE, 'js', 'species.js'), 'utf8');
function renderCard(rec, sites) {
  const box = { _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; } };
  const w = { SPECIES_DATA: [rec] };
  vm.runInNewContext(code, { window: w, document: { dispatchEvent() {} }, fetch: () => Promise.resolve({ ok: false }), console, CustomEvent: null });
  const hit = w.GBSYSpecies.renderCards(box, sites);
  return { hit, html: box.innerHTML };
}
const withImg = withPic.find(x => x.tapho_link);
const site = { id: withImg.tapho_link.split(/[、，,]/)[0].trim() };
const r1 = renderCard(withImg, [site]);
ok(r1.hit, '有编号+有图物种能被 renderCards 命中');
ok(/<img class="sp-thumb" src="assets\/fossils\//.test(r1.html), '卡片渲染缩略图');
ok(r1.html.indexOf(withImg.image) > -1, '缩略图用封面图');
const noImg = species.find(x => x.tapho_link && !(x.images && x.images.length));
const r2 = renderCard(noImg, [{ id: noImg.tapho_link.split(/[、，,]/)[0].trim() }]);
ok(r2.hit && !/sp-thumb/.test(r2.html), '无图物种不渲染空 img');

// 3) atlas.html 详情与图鉴本
const atlas = fs.readFileSync(path.join(BASE, 'atlas.html'), 'utf8');
ok(/function photoHTML\(f\)/.test(atlas), '详情有 photoHTML 渲染函数');
ok(/fossil-hero/.test(atlas) && /fpMain/.test(atlas), '详情主图容器');
ok(/fp-thumbs/.test(atlas) && /bindPhotoSwitch/.test(atlas), '多角度缩略图与切换');
ok(/图片来源：/.test(atlas), '详情标注图片来源');
ok(/class="thumb"/.test(atlas), '图鉴本格子有缩略图');
ok(/mystery-photo/.test(atlas), '盲盒答完展示标本照');
ok(/class="slot '\+cls\+'"/.test(atlas) || /slot '\+cls\+'/.test(atlas), '未解锁仍走问号分支（不剧透）');

// 4) 样式
const css = fs.readFileSync(path.join(BASE, 'css', 'style.css'), 'utf8');
ok(/\.species-card \.sp-thumb\s*\{[\s\S]{0,200}aspect-ratio:\s*4\s*\/\s*3/.test(css), '卡片缩略图 4:3 裁切');

console.log('==== PASS=' + pass + ' FAIL=' + fail + ' ====');
process.exit(fail ? 1 : 0);
