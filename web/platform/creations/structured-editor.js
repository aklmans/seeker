// @ts-check
import {tt} from '../shell/i18n.js';
import {comparison,timeline} from './structured-model.js';
import {escapeHTML as esc} from './content.js';
/** @param {HTMLElement} host @param {'comparison'|'timeline'} kind @param {{[k:string]:unknown}} initial @param {()=>void} changed */
export function mountStructuredEditor(host,kind,initial,changed){
  const clean=(/** @type {unknown} */raw)=>kind==='comparison'?comparison(raw):timeline(raw);
  let content=clean(initial),typing=false;
  /** @type {(import('./structured-model').Comparison|import('./structured-model').Timeline)[]} */const undo=[];
  function read(){
    if(kind==='comparison')return {columns:[...host.querySelectorAll('[data-table-col]')].map(e=>/** @type {HTMLInputElement} */(e).value),rows:[...host.querySelectorAll('[data-table-row]')].map(row=>[...row.querySelectorAll('textarea')].map(e=>e.value))};
    return {events:[...host.querySelectorAll('[data-event]')].map(row=>({when:/** @type {HTMLInputElement} */(row.querySelector('[data-event-when]')).value,title:/** @type {HTMLInputElement} */(row.querySelector('[data-event-title]')).value,detail:/** @type {HTMLTextAreaElement} */(row.querySelector('textarea')).value}))};
  }
  const value=()=>clean(read());
  function mutate(/** @type {(value:any)=>void} */fn){try{const before=value(),next=structuredClone(before);fn(next);content=clean(next);undo.push(before);if(undo.length>20)undo.shift();paint();changed();}catch(e){const status=host.querySelector('[data-structured-status]');if(status)status.textContent=String(e);}}
  function paint(){
    typing=false;
    if(kind==='comparison'){
      const c=/** @type {import('./structured-model').Comparison} */(content);
      host.innerHTML=`<p>${tt('修改列标题与单元格。最多 6 列、80 行。删除后可撤销。','Edit headers and cells. Up to 6 columns and 80 rows. Removals are undoable.')}</p><div class="creation-table-editor"><table><thead><tr>${c.columns.map((col,i)=>`<th><input class="input" data-table-col="${i}" maxlength="100" aria-label="${tt('第 '+(i+1)+' 列标题','Column '+(i+1)+' header')}" value="${esc(col)}"><button class="btn-text" data-table-remove-col="${i}" ${c.columns.length<=2?'disabled':''}>${tt('移除此列','Remove column')}</button></th>`).join('')}<th></th></tr></thead><tbody>${c.rows.map((row,i)=>`<tr data-table-row="${i}">${row.map((cell,j)=>`<td><textarea class="input" rows="2" maxlength="500" aria-label="${tt('第 '+(i+1)+' 行第 '+(j+1)+' 列','Row '+(i+1)+', column '+(j+1))}">${esc(cell)}</textarea></td>`).join('')}<td><button class="btn-text" data-table-remove-row="${i}" ${c.rows.length<=1?'disabled':''}>${tt('移除此行','Remove row')}</button></td></tr>`).join('')}</tbody></table></div><div class="creation-toolbar"><button class="btn" data-table-add-row ${c.rows.length>=80?'disabled':''}>${tt('+ 增加一行','+ Add row')}</button><button class="btn" data-table-add-col ${c.columns.length>=6?'disabled':''}>${tt('+ 增加一列','+ Add column')}</button></div>`;
      for(const b of host.querySelectorAll('[data-table-remove-col]'))/** @type {HTMLButtonElement} */(b).onclick=()=>mutate(c=>{const i=Number(b.getAttribute('data-table-remove-col'));c.columns.splice(i,1);c.rows.forEach((/** @type {string[]} */row)=>row.splice(i,1));});
      for(const b of host.querySelectorAll('[data-table-remove-row]'))/** @type {HTMLButtonElement} */(b).onclick=()=>mutate(c=>c.rows.splice(Number(b.getAttribute('data-table-remove-row')),1));
      /** @type {HTMLButtonElement} */(host.querySelector('[data-table-add-row]')).onclick=()=>mutate(c=>c.rows.push(c.columns.map(()=>'')));
      /** @type {HTMLButtonElement} */(host.querySelector('[data-table-add-col]')).onclick=()=>mutate(c=>{c.columns.push(tt('新方案','New option'));c.rows.forEach((/** @type {string[]} */r)=>r.push(''));});
    }else{
      const c=/** @type {import('./structured-model').Timeline} */(content);
      host.innerHTML=`<p>${tt('按展示顺序编辑事件；时间可以是日期或“第一步”等文字。最多 80 条。','Edit events in display order. Time can be a date or text such as Step 1. Up to 80 events.')}</p>${c.events.map((event,i)=>`<div class="creation-event-editor" data-event="${i}"><label>${tt('时间 / 阶段','Time / stage')}<input class="input" data-event-when maxlength="80" value="${esc(event.when)}"></label><label>${tt('事件标题','Event title')}<input class="input" data-event-title maxlength="200" value="${esc(event.title)}"></label><label>${tt('事件说明','Details')}<textarea class="input" rows="3" maxlength="2000">${esc(event.detail)}</textarea></label><div class="creation-toolbar"><button class="btn-text" data-event-move="${i}" ${i===0?'disabled':''}>${tt('上移','Move up')}</button><button class="btn-text" data-event-remove="${i}" ${c.events.length<=1?'disabled':''}>${tt('移除此事件','Remove event')}</button></div></div>`).join('')}<button class="btn" data-event-add ${c.events.length>=80?'disabled':''}>${tt('+ 增加事件','+ Add event')}</button>`;
      for(const b of host.querySelectorAll('[data-event-remove]'))/** @type {HTMLButtonElement} */(b).onclick=()=>mutate(c=>c.events.splice(Number(b.getAttribute('data-event-remove')),1));
      for(const b of host.querySelectorAll('[data-event-move]'))/** @type {HTMLButtonElement} */(b).onclick=()=>mutate(c=>{const i=Number(b.getAttribute('data-event-move'));[c.events[i-1],c.events[i]]=[c.events[i],c.events[i-1]];});
      /** @type {HTMLButtonElement} */(host.querySelector('[data-event-add]')).onclick=()=>mutate(c=>c.events.push({when:'',title:tt('新事件','New event'),detail:''}));
    }
    const back=document.createElement('button');back.className='btn';back.textContent=tt('撤销修改','Undo change');back.disabled=!undo.length;back.onclick=()=>{const prior=undo.pop();if(prior){content=prior;paint();changed();}};
    for(const input of host.querySelectorAll('input,textarea')){
      input.addEventListener('input',()=>{if(!typing){undo.push(content);if(undo.length>20)undo.shift();}typing=true;content=read();back.disabled=false;changed();});
      input.addEventListener('blur',()=>{typing=false;});
    }
    const status=document.createElement('p');status.setAttribute('role','status');status.dataset.structuredStatus='';host.append(back,status);
  }
  paint();return {value};
}
