// @ts-check
import {tt} from '../shell/i18n.js';
import {mindMap,findNode,parentNode,editMindMap,moveNode,newNodeId} from './mindmap-model.js';
import {layoutMindMap,mindMapSVG} from './mindmap-render.js';
/** @typedef {import('./mindmap-model.js').MindMap} MindMap */
/** @typedef {import('./mindmap-model.js').MindNode} MindNode */
/** A trusted SVG editor; arbitrary widget HTML never enters this surface.
 * @param {HTMLElement} host @param {MindMap} initial @param {()=>{[k:string]:unknown}} readStyle
 * @param {(map:MindMap)=>void} changed @param {((action:'expand'|'shorten',id:string)=>void)} [runAI] */
export function mountMindMapEditor(host,initial,readStyle,changed,runAI){
  let map=mindMap(initial),selected=map.root.id,zoom=1;
  /** @type {MindMap[]} */const undo=[];
  host.innerHTML=`<div class="mind-toolbar"><label>${tt('视图','View')} <select class="select" data-mind-view><option value="bilateral">${tt('双向导图','Two-sided map')}</option><option value="tree">${tt('单向树','Tree')}</option><option value="outline">${tt('大纲','Outline')}</option></select></label>
    <button class="btn" data-mind-fit>${tt('适应画布','Fit')}</button><button class="btn" data-mind-zoom="-1" aria-label="${tt('缩小','Zoom out')}">−</button><span data-mind-scale></span><button class="btn" data-mind-zoom="1" aria-label="${tt('放大','Zoom in')}">+</button><button class="btn" data-mind-undo>${tt('撤销编辑','Undo edit')}</button></div>
    <p class="mind-help">${tt('点击节点编辑，拖到另一个节点上调整所属分支。也可以用下方“移动到”选择父节点。','Select a node to edit. Drag it onto another node to reparent it, or use Move to below.')}</p>
    <div class="mind-viewport" tabindex="0" aria-label="${tt('思维导图画布','Mind map canvas')}" data-mind-canvas></div>
    <div class="mind-node-editor"><label>${tt('节点文字','Node text')}<textarea class="input" data-mind-text rows="3" maxlength="300"></textarea></label><div class="mind-toolbar">
    <button class="btn" data-mind-add="child">${tt('+ 子节点','+ Child')}</button><button class="btn" data-mind-add="sibling">${tt('+ 同级节点','+ Sibling')}</button><button class="btn" data-mind-fold></button><button class="btn" data-mind-remove>${tt('删除分支','Remove branch')}</button>
    <label>${tt('移动到','Move to')} <select class="select" data-mind-parent></select></label><button class="btn" data-mind-move>${tt('移动','Move')}</button>
    ${runAI?`<button class="btn" data-mind-ai="expand">${tt('AI 扩展分支','AI expand branch')}</button><button class="btn" data-mind-ai="shorten">${tt('AI 精简分支','AI shorten branch')}</button>`:''}</div><p role="status" data-mind-status></p></div>`;
  const canvas=/** @type {HTMLElement} */(host.querySelector('[data-mind-canvas]'));
  const label=/** @type {HTMLTextAreaElement} */(host.querySelector('[data-mind-text]'));
  const view=/** @type {HTMLSelectElement} */(host.querySelector('[data-mind-view]'));
  const parent=/** @type {HTMLSelectElement} */(host.querySelector('[data-mind-parent]'));
  const status=/** @type {HTMLElement} */(host.querySelector('[data-mind-status]'));
  function message(/** @type {unknown} */error){status.textContent=String(error instanceof Error?error.message:error);}
  function update(/** @type {MindMap} */next,record=true){
    try{next=mindMap(next);if(record)undo.push(map);if(undo.length>20)undo.shift();map=next;if(!findNode(map.root,selected))selected=map.root.id;label.setCustomValidity('');status.textContent='';changed(mindMap(map));paint();}
    catch(e){message(e);}
  }
  /** @param {(tree:MindMap)=>void} fn */
  function change(fn){try{update(editMindMap(map,fn));}catch(e){message(e);}}
  const selectedNode=()=>findNode(map.root,selected)||map.root;
  function fit(){const size=layoutMindMap(map,readStyle());zoom=Math.max(.1,Math.min(1,(canvas.clientWidth-24)/size.width,(canvas.clientHeight-24)/size.height));paintCanvas();}
  function paintCanvas(){
    const size=layoutMindMap(map,readStyle());canvas.innerHTML=mindMapSVG(map,readStyle(),selected);
    const svg=/** @type {SVGElement} */(canvas.querySelector('svg'));svg.classList.toggle('mind-outline',map.layout==='outline');svg.style.width=(size.width*zoom)+'px';svg.style.height=(size.height*zoom)+'px';svg.style.touchAction='none';
    const scale=host.querySelector('[data-mind-scale]');if(scale)scale.textContent=Math.round(zoom*100)+'%';
  }
  function paint(){
    view.value=map.layout;paintCanvas();const node=selectedNode();
    if(document.activeElement!==label)label.value=node.text;
    const flat=/** @type {MindNode[]} */([]);const visit=(/** @type {MindNode} */n)=>{flat.push(n);n.children.forEach(visit);};visit(map.root);
    parent.replaceChildren();
    for(const candidate of flat.filter(n=>!findNode(node,n.id))){const option=document.createElement('option');option.value=candidate.id;option.textContent=candidate.text;parent.appendChild(option);}
    parent.value=parentNode(map.root,selected)?.id||'';
    /** @type {HTMLButtonElement} */(host.querySelector('[data-mind-undo]')).disabled=!undo.length;
    /** @type {HTMLButtonElement} */(host.querySelector('[data-mind-remove]')).disabled=selected===map.root.id;
    /** @type {HTMLButtonElement} */(host.querySelector('[data-mind-add="sibling"]')).disabled=selected===map.root.id;
    /** @type {HTMLButtonElement} */(host.querySelector('[data-mind-move]')).disabled=selected===map.root.id;
    const fold=/** @type {HTMLButtonElement} */(host.querySelector('[data-mind-fold]'));fold.disabled=!node.children.length;fold.textContent=node.collapsed?tt('展开分支','Expand branch'):tt('折叠分支','Collapse branch');
  }
  function select(/** @type {string} */id){if(findNode(map.root,id)){selected=id;label.value=selectedNode().text;label.setCustomValidity('');paint();}}
  canvas.onclick=e=>{if(dragged){dragged=false;return;}const node=/** @type {Element|null} */(e.target)?.closest('[data-mind-node]');if(node)select(node.getAttribute('data-mind-node')||'');};
  canvas.onkeydown=e=>{const node=/** @type {Element|null} */(e.target)?.closest('[data-mind-node]');if(node&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(node.getAttribute('data-mind-node')||'');label.focus();}};
  let typing=false;
  label.oninput=()=>{
    if(!label.value.trim()){label.setCustomValidity(tt('节点文字不能为空','Node text is required'));message(tt('节点文字不能为空','Node text is required'));return;}
    label.setCustomValidity('');
    try{const next=editMindMap(map,m=>{const n=findNode(m.root,selected);if(n)n.text=label.value;});update(next,!typing);typing=true;}catch(e){message(e);}
  };label.onblur=()=>{typing=false;};
  view.onchange=()=>{change(m=>{m.layout=/** @type {MindMap['layout']} */(view.value);});fit();};
  /** @type {HTMLButtonElement} */(host.querySelector('[data-mind-fit]')).onclick=fit;
  for(const b of host.querySelectorAll('[data-mind-zoom]'))/** @type {HTMLButtonElement} */(b).onclick=()=>{zoom=Math.max(.1,Math.min(3,zoom+Number(b.getAttribute('data-mind-zoom'))*.1));paintCanvas();};
  /** @type {HTMLButtonElement} */(host.querySelector('[data-mind-undo]')).onclick=()=>{const prior=undo.pop();if(prior)update(prior,false);};
  for(const b of host.querySelectorAll('[data-mind-add]'))/** @type {HTMLButtonElement} */(b).onclick=()=>{
    const id=newNodeId();change(m=>{const p=b.getAttribute('data-mind-add')==='child'?findNode(m.root,selected):parentNode(m.root,selected);if(!p)throw Error('Cannot add here');p.children.push({id,text:tt('新节点','New node'),collapsed:false,children:[]});p.collapsed=false;});select(id);label.focus();label.select();
  };
  /** @type {HTMLButtonElement} */(host.querySelector('[data-mind-fold]')).onclick=()=>change(m=>{const node=findNode(m.root,selected);if(node)node.collapsed=!node.collapsed;});
  /** @type {HTMLButtonElement} */(host.querySelector('[data-mind-remove]')).onclick=()=>change(m=>{const p=parentNode(m.root,selected);if(!p)throw Error(tt('保留中心节点','Keep the root node'));p.children=p.children.filter(n=>n.id!==selected);selected=p.id;});
  /** @type {HTMLButtonElement} */(host.querySelector('[data-mind-move]')).onclick=()=>{try{update(moveNode(map,selected,parent.value));}catch(e){message(e);}};
  for(const b of host.querySelectorAll('[data-mind-ai]'))/** @type {HTMLButtonElement} */(b).onclick=()=>runAI?.(/** @type {'expand'|'shorten'} */(b.getAttribute('data-mind-ai')),selected);
  /** @type {{id:string,x:number,y:number}|null} */let drag=null;let dragged=false;
  canvas.onpointerdown=e=>{const target=/** @type {Element|null} */(e.target)?.closest('[data-mind-node]');if(target&&e.button===0){drag={id:target.getAttribute('data-mind-node')||'',x:e.clientX,y:e.clientY};dragged=false;canvas.setPointerCapture(e.pointerId);}};
  canvas.onpointermove=e=>{if(drag&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>8){dragged=true;canvas.classList.add('mind-dragging');}};
  canvas.onpointerup=e=>{
    if(!drag)return;const prior=drag;drag=null;canvas.classList.remove('mind-dragging');canvas.releasePointerCapture(e.pointerId);
    if(!dragged){select(prior.id);return;}
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-mind-node]');const id=target?.getAttribute('data-mind-node');
    if(id&&id!==prior.id){try{selected=prior.id;update(moveNode(map,prior.id,id));}catch(error){message(error);}}
  };
  canvas.onpointercancel=()=>{drag=null;dragged=false;canvas.classList.remove('mind-dragging');};
  paint();fit();
  return {value:()=>{if(!label.value.trim())throw Error(tt('节点文字不能为空','Node text is required'));return mindMap(map);},refresh:paint,select,
    replace:(/** @type {MindMap} */next)=>update(next)};
}
