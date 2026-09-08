// @ts-check
import {mindMap} from './mindmap-model.js';
import {normalizeStyle} from './style.js';
import {escapeHTML as esc} from './content.js';
/** @typedef {import('./mindmap-model.js').MindNode} MindNode */
/** @typedef {{id:string,node:MindNode,x:number,y:number,width:number,height:number,lines:string[],side:number}} Box */
/** @param {string} text @param {number} maxWidth @param {number} size */
function wrap(text,maxWidth,size){
  const lines=[];let line='',width=0;
  for(const char of text){const w=(/^[\x20-\x7e]$/.test(char)?0.61:1.05)*size;if(char==='\n'||(width+w>maxWidth&&line)){lines.push(line);line='';width=0;if(char==='\n')continue;}line+=char;width+=w;}
  if(line||!lines.length)lines.push(line);return lines;
}
/** Layout uses real label lengths and includes every visible node, including long Chinese labels.
 * @param {import('./mindmap-model.js').MindMap} input @param {{[k:string]:unknown}} style */
export function layoutMindMap(input,style){
  const map=mindMap(input),s=normalizeStyle(style),width=map.layout==='outline'?560:220,gap=s.spacing+48;
  /** @type {Map<string,{height:number,ownHeight:number,lines:string[]}>} */const sizes=new Map();
  const measure=(/** @type {MindNode} */n)=>{
    const lines=wrap(n.text,width-32,s.size),ownHeight=Math.max(48,lines.length*s.size*1.5+28);
    const children=n.collapsed?[]:n.children;
    const sum=children.reduce((a,c)=>a+measure(c),0)+Math.max(0,children.length-1)*s.spacing;
    const height=Math.max(ownHeight,sum);sizes.set(n.id,{height,ownHeight,lines});return height;
  };measure(map.root);
  /** @type {Box[]} */const boxes=[];
  /** @type {[string,string][]} */const edges=[];
  const place=(/** @type {MindNode} */node,/** @type {number} */x,/** @type {number} */center,/** @type {number} */side)=>{
    const size=/** @type {NonNullable<ReturnType<typeof sizes.get>>} */(sizes.get(node.id));
    boxes.push({id:node.id,node,x,y:center-size.ownHeight/2,width,height:size.ownHeight,lines:size.lines,side});
    const children=node.collapsed?[]:node.children;
    let top=center-(children.reduce((a,c)=>a+(sizes.get(c.id)?.height||0),0)+Math.max(0,children.length-1)*s.spacing)/2;
    for(const child of children){const h=sizes.get(child.id)?.height||0;edges.push([node.id,child.id]);place(child,x+side*(width+gap),top+h/2,side);top+=h+s.spacing;}
  };
  if(map.layout==='outline'){
    let top=0;
    const outline=(/** @type {MindNode} */node,/** @type {number} */depth)=>{
      const size=/** @type {NonNullable<ReturnType<typeof sizes.get>>} */(sizes.get(node.id));
      boxes.push({id:node.id,node,x:depth*36,y:top,width,height:size.ownHeight,lines:size.lines,side:1});top+=size.ownHeight+s.spacing;
      if(!node.collapsed)node.children.forEach(child=>outline(child,depth+1));
    };outline(map.root,0);
  }else if(map.layout==='bilateral'){
    const root=map.root,children=root.collapsed?[]:root.children;
    const size=/** @type {NonNullable<ReturnType<typeof sizes.get>>} */(sizes.get(root.id));
    boxes.push({id:root.id,node:root,x:0,y:-size.ownHeight/2,width,height:size.ownHeight,lines:size.lines,side:1});
    for(const side of [1,-1]){
      const group=children.filter((_,i)=>(i%2===0?1:-1)===side);
      let top=-(group.reduce((a,c)=>a+(sizes.get(c.id)?.height||0),0)+Math.max(0,group.length-1)*s.spacing)/2;
      for(const child of group){const h=sizes.get(child.id)?.height||0;edges.push([root.id,child.id]);place(child,side*(width+gap),top+h/2,side);top+=h+s.spacing;}
    }
  }else place(map.root,0,0,1);
  const minX=Math.min(...boxes.map(b=>b.x)),minY=Math.min(...boxes.map(b=>b.y));
  for(const box of boxes){box.x+=32-minX;box.y+=32-minY;}
  return {boxes,edges,width:Math.max(...boxes.map(b=>b.x+b.width))+32,height:Math.max(...boxes.map(b=>b.y+b.height))+32};
}
/** Self-contained SVG contains only platform markup and escaped text; no script, event handlers or URLs.
 * @param {import('./mindmap-model.js').MindMap} map @param {{[k:string]:unknown}} style @param {string} [selected] */
export function mindMapSVG(map,style,selected=''){
  const s=normalizeStyle(style),layout=layoutMindMap(map,style),byId=new Map(layout.boxes.map(b=>[b.id,b]));
  const font={sans:"-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif",serif:"Georgia,'Songti SC',serif",mono:"Menlo,'Microsoft YaHei',monospace"}[s.font]||'sans-serif';
  const edges=layout.edges.map(([a,b])=>{const from=/** @type {Box} */(byId.get(a)),to=/** @type {Box} */(byId.get(b));const dir=to.side,x1=from.x+(dir===1?from.width:0),x2=to.x+(dir===1?0:to.width),y1=from.y+from.height/2,y2=to.y+to.height/2;
    const path=s.edge==='line'?`M${x1} ${y1}L${x2} ${y2}`:`M${x1} ${y1}C${(x1+x2)/2} ${y1},${(x1+x2)/2} ${y2},${x2} ${y2}`;
    return `<path d="${path}" fill="none" stroke="${s.accent}" stroke-width="1.5"${s.edge==='sketch'?' stroke-dasharray="5 3"':''}/>`;}).join('');
  const nodes=layout.boxes.map(box=>`<g data-mind-node="${esc(box.id)}" tabindex="0" role="button" aria-label="${esc(box.node.text)}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="${s.radius}" fill="${s.surface}" stroke="${s.accent}" stroke-width="${box.id===selected?3:1}"${s.edge==='sketch'?' stroke-dasharray="5 2"':''}/><text fill="${s.foreground}" font-family="${esc(font)}" font-size="${s.size}">${box.lines.map((line,i)=>`<tspan x="${box.x+16}" y="${box.y+20+s.size+i*s.size*1.5}">${esc(line)}</tspan>`).join('')}</text>${box.node.children.length?`<text x="${box.x+box.width-10}" y="${box.y+12}" text-anchor="middle" fill="${s.accent}" font-size="12">${box.node.collapsed?'+':'−'}</text>`:''}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" aria-label="${esc(map.root.text)}"><rect width="100%" height="100%" fill="${s.background}"/>${edges}${nodes}</svg>`;
}
