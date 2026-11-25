/* 测试：图鉴弹窗滚动锁定 + 详情侧栏滚动链阻断
   覆盖用户反馈「弹出小卡片后滑动，背景主页面也跟着动」 */
const fs=require('fs'),vm=require('vm');
let pass=0,fail=0;
function ok(c,m){if(c){pass++;console.log('PASS '+m)}else{fail++;console.log('FAIL '+m)}}

const html=fs.readFileSync('atlas.html','utf8');

// 1) CSS 层：滚动链阻断与 body 锁样式存在
ok(/html\.modal-open,body\.modal-open\{overflow:hidden\}/.test(html),
   'CSS 有 html/body 滚动锁');
ok(/\.modal,\.sitelist,\.bwall\{overscroll-behavior:contain\}/.test(html),
   'CSS 弹窗滚动容器 overscroll-behavior:contain');

// 2) JS 层：用最小 DOM 桩跑 open/close/setBodyLock，验证锁状态随弹窗开关切换
const documentElement={style:{overflow:''}};
const body={style:{overflow:''}};
const mask={
  cls:{},
  classList:{
    add:function(c){this._o.cls[c]=1;this._o._cb&&this._o._cb();},
    remove:function(c){delete this._o.cls[c];this._o._cb&&this._o._cb();},
    contains:function(c){return !!this._o.cls[c];}
  }
};
mask.classList._o=mask;
mask.classList.add=function(c){mask.cls[c]=1;mask._cb&&mask._cb();};
mask.classList.remove=function(c){delete mask.cls[c];mask._cb&&mask._cb();};
mask.classList.contains=function(c){return !!mask.cls[c];};
const modal={innerHTML:''};
const document={
  documentElement:documentElement,body:body,
  getElementById:function(id){return id==='mask'?mask:(id==='modal'?modal:{});}
};
const obsBox={cb:null};
function MutationObserver(cb){obsBox.cb=cb;}
MutationObserver.prototype.observe=function(){};
const sandbox={
  document:document,
  MutationObserver:MutationObserver,
  console:console,
  setTimeout:setTimeout,
  window:{localStorage:{getItem:function(){return null},setItem:function(){},removeItem:function(){}}}
};
// 抽出被测函数片段（从 setBodyLock 到 close 定义结束）
const m=html.match(/  function setBodyLock\(on\)\{[\s\S]*?function close\(\)\{[^}]*\}/);
ok(!!m,'抽取滚动锁定代码片段');
if(m){
  sandbox.obsBox=obsBox;
  sandbox.$=function(id){return document.getElementById(id);};
  vm.runInNewContext(m[0]+';globalThis.__open=open;globalThis.__close=close;',sandbox);
  ok(documentElement.style.overflow==='' && body.style.overflow==='','初始未锁');
  sandbox.__open('<p>x</p>');
  ok(documentElement.style.overflow==='hidden'&&body.style.overflow==='hidden','open() 锁住 html+body');
  sandbox.__close();
  ok(documentElement.style.overflow===''&&body.style.overflow==='','close() 释放 html+body');
  // 模拟 8 处内联 × 按钮：直接 classList.remove('show')，观察器应同步解锁
  sandbox.__open('<p>y</p>');
  ok(body.style.overflow==='hidden','再次 open 锁住');
  mask.classList.remove('show');
  if(obsBox.cb)obsBox.cb(); // 观察器回调：mask 已无 show → 应解锁
  ok(body.style.overflow==='','内联关闭经观察器同步解锁');
}

// 3) 地图详情侧栏 CSS
const css=fs.readFileSync('css/style.css','utf8');
const detailBlock=css.match(/\.gbsy-detail\s*\{[\s\S]*?\n\}/);
const dlistBlock=css.match(/\.gbsy-detail \.d-list\s*\{[\s\S]*?\n\}/);
ok(detailBlock&&/overscroll-behavior:\s*contain/.test(detailBlock[0]),'.gbsy-detail 滚动链阻断');
ok(dlistBlock&&/overscroll-behavior:\s*contain/.test(dlistBlock[0]),'.d-list 滚动链阻断');

console.log('==== PASS='+pass+' FAIL='+fail+' ====');
process.exit(fail?1:0);
