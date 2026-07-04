// @ts-nocheck —— 抽壳序1-d 过渡:引用 $/el(dom.js)结果含 Element|null,类型化留 3.y(须处理 null);逻辑零改动。
/** 平台 · 通知 toast/toastUndo(+lastUndo 供 Mod+Z 撤销)。依赖 $/el;挂全局 + 载序前置零回归(约束⑤)。 */
let lastUndo=null; /* 最近一次可撤销操作(供 Mod+Z);仅 toastUndo 类操作登记 */
function toast(msg){
  const t=el(`<div class="toast">${msg}</div>`);
  $('#toasts').appendChild(t);
  setTimeout(()=>{t.style.transition='opacity 300ms';t.style.opacity='0';setTimeout(()=>t.remove(),300);},2800);
}
function toastUndo(msg, restoreFn){
  const t=el(`<div class="toast" style="display:flex;align-items:center;gap:14px;">${msg}<button class="toast-undo">撤销</button></div>`);
  $('#toasts').appendChild(t);
  let gone=false; const close=()=>{if(gone)return;gone=true;t.style.transition='opacity 300ms';t.style.opacity='0';setTimeout(()=>t.remove(),300);};
  const doUndo=()=>{close();restoreFn();toast('已撤销');if(lastUndo===doUndo)lastUndo=null;};
  lastUndo=doUndo;                       /* 登记为「最近可撤销」,Mod+Z 触发 */
  $('.toast-undo',t).onclick=doUndo;
  setTimeout(()=>{close();if(lastUndo===doUndo)lastUndo=null;},6500);
}
