/* 盲盒猜物种题库单测：node tools/test_atlas_mystery.js */
const fs = require('fs');
const path = require('path');
const M = require('../atlas-mystery.js');

const species = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'species.json'), 'utf8'));
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.error('  ✗ ' + msg); } }
function head(t) { console.log('\n# ' + t); }

head('1. 全量出题：每条化石都能生成盲盒题');
const all = M.make(species, species.length, 'gbsy');
ok(all.length === species.length, '题目数应等于物种数 ' + species.length + '，实际 ' + all.length);
ok(all.every(q => q.clue && q.answer && q.options.length === 4), '每题都有线索/答案/四选项');

head('2. 红线：线索逐字出自 features 原文，不编造');
all.forEach((q, i) => {
  const src = species.find(f => f.cn_name === q.answer);
  ok(src.features.indexOf(q.clue) >= 0, '第' + (i + 1) + '题「' + q.answer + '」线索须为 features 逐字片段');
  ok(q.source === 'features', '第' + (i + 1) + '题标注来源 features');
});

head('3. 线索不泄露答案名（中文全名/拉丁名/词源解释核心词）');
/* 词源解释句会把答案字面说出来，例如斑嵴龙「属名斑嵴即由此而来」——这类句子必须排除。
   取中文名去掉「龙/蛋/兽/石」尾字后的核心词做子串检查。 */
function coreWord(name) { return name.replace(/(龙|蛋|兽|石)$/, ''); }
all.forEach((q, i) => {
  const src = species.find(f => f.cn_name === q.answer);
  [q.clue].concat(q.moreClues || []).forEach((clue, k) => {
    ok(clue.indexOf(src.cn_name) < 0, '第' + (i + 1) + '题线索' + k + '不应出现中文全名 ' + src.cn_name);
    if (src.genus) ok(clue.toLowerCase().indexOf(src.genus.toLowerCase()) < 0, '第' + (i + 1) + '题线索' + k + '不应出现属名');
    if (src.species) ok(clue.toLowerCase().indexOf(src.species.toLowerCase()) < 0, '第' + (i + 1) + '题线索' + k + '不应出现种加词');
    const core = coreWord(src.cn_name);
    if (core.length >= 2) ok(clue.indexOf(core) < 0, '第' + (i + 1) + '题线索' + k + '不应泄露核心词「' + core + '」');
  });
});

head('4. 选项：答案唯一、四选项互不重复、干扰项全是真实物种名');
const names = species.map(f => f.cn_name);
all.forEach((q, i) => {
  ok(q.options.filter(x => x === q.answer).length === 1, '第' + (i + 1) + '题答案恰好出现一次');
  ok(new Set(q.options).size === 4, '第' + (i + 1) + '题四选项互不重复');
  q.options.forEach(op => ok(names.indexOf(op) >= 0, '第' + (i + 1) + '题选项「' + op + '」是真实物种名'));
});

head('5. 干扰项同类群优先');
all.forEach((q, i) => {
  const sameCount = species.filter(f => f.taxa === q.taxa).length - 1;   // 同门类可当干扰项的数量
  if (sameCount >= 3) {
    const distractors = q.options.filter(x => x !== q.answer);
    const sameDistractors = distractors.filter(n => species.find(f => f.cn_name === n && f.taxa === q.taxa));
    ok(sameDistractors.length === 3, '第' + (i + 1) + '题「' + q.answer + '」同类群充足时三个干扰项应都同类群(' + q.taxa + ')');
  }
});

head('6. 判定正确');
all.forEach((q, i) => {
  ok(M.check(q, q.answer) === true, '第' + (i + 1) + '题选答案应判对');
  ok(M.check(q, q.options.find(x => x !== q.answer)) === false, '第' + (i + 1) + '题选干扰项应判错');
  ok(M.check(null, 'x') === false, '空题判错');
});

head('7. 数据驱动：新增化石自动进题库，大师徽章门槛无关写死条数');
const extra = species.concat([{ cn_name: '测试新种', genus: 'Testus', species: 'novus', taxa: '恐龙', features: '这是一段用于测试的鉴别特征描述，某种结构非常特殊且与其它类群形成对比，长度足够进入线索筛选。', reference: 'x' }]);
const withExtra = M.make(extra, extra.length, 'gbsy');
ok(withExtra.length === species.length + 1, '加一条化石后题目数自动 +1');
ok(withExtra.some(q => q.answer === '测试新种'), '新化石自动出现在题库');
ok(M.make([], 5, 'x').length === 0, '空数据不报错、返回空数组');
ok(M.make(species, 3, 'gbsy').length === 3, 'count 参数限制题数');

head('8. 换一批：不同 seed 题目/选项顺序变化，同 seed 确定');
const s1 = M.make(species, species.length, 'A');
const s2 = M.make(species, species.length, 'B');
const s1b = M.make(species, species.length, 'A');
ok(JSON.stringify(s1.map(q => q.answer)) !== JSON.stringify(s2.map(q => q.answer)), '不同 seed 题目顺序应不同');
ok(JSON.stringify(s1) === JSON.stringify(s1b), '相同 seed 结果应完全确定');

head('9. 兜底：字段缺失不崩');
const partial = M.make([{ cn_name: '残缺种', features: '' }, { cn_name: '无特征名' }], 5, 'x');
ok(partial.length === 0, '无 features 的物种不出题（避免空线索）');

console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
