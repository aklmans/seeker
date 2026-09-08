// @ts-check
/** Portable mind maps. IDs are local identifiers; labels always remain plain text. */
/** @typedef {{id:string,text:string,collapsed:boolean,children:MindNode[]}} MindNode */
/** @typedef {{root:MindNode,layout:'bilateral'|'tree'|'outline'}} MindMap */
export const MIND_LIMITS={nodes:200,depth:12,label:300};
export const newNodeId=()=> 'n_'+crypto.randomUUID();
/** @param {unknown} raw @returns {MindMap} */
export function mindMap(raw){
  const data=/** @type {any} */(raw);
  if(!data||typeof data!=='object'||!['bilateral','tree','outline'].includes(data.layout))throw Error('导图格式无效 / Invalid mind map');
  let count=0;const ids=new Set();
  const visit=(/** @type {any} */node,/** @type {number} */depth)=>{
    if(!node||typeof node!=='object'||++count>MIND_LIMITS.nodes||depth>MIND_LIMITS.depth||typeof node.id!=='string'||!/^n_[a-zA-Z0-9_-]{1,80}$/.test(node.id)||ids.has(node.id)||typeof node.text!=='string'||!node.text.trim()||[...node.text].length>MIND_LIMITS.label||!Array.isArray(node.children))throw Error('导图最多 200 个节点、12 层，每个节点最多 300 字 / Limit: 200 nodes, 12 levels, 300 characters per node');
    ids.add(node.id);
    return {id:node.id,text:node.text,collapsed:node.collapsed===true,children:node.children.map((/** @type {any} */n)=>visit(n,depth+1))};
  };
  return {root:visit(data.root,1),layout:data.layout};
}
/** @param {MindNode} root @param {string} id @returns {MindNode|null} */
export function findNode(root,id){if(root.id===id)return root;for(const node of root.children){const found=findNode(node,id);if(found)return found;}return null;}
/** @param {MindNode} root @param {string} id @returns {MindNode|null} */
export function parentNode(root,id){for(const node of root.children){if(node.id===id)return root;const parent=parentNode(node,id);if(parent)return parent;}return null;}
/** One mutation yields a validated new tree; failure never changes the original.
 * @param {MindMap} original @param {(tree:MindMap)=>void} change */
export function editMindMap(original,change){const next=mindMap(original);change(next);return mindMap(next);}
/** @param {MindMap} original @param {string} id @param {string} parentId @param {number} [index] */
export function moveNode(original,id,parentId,index=Infinity){
  return editMindMap(original,map=>{
    const node=findNode(map.root,id),oldParent=parentNode(map.root,id),target=findNode(map.root,parentId);
    if(!node||!oldParent||!target||findNode(node,parentId))throw Error('不能移入自身或子分支 / Cannot move into this branch');
    oldParent.children=oldParent.children.filter(n=>n.id!==id);
    target.children.splice(Math.max(0,Math.min(target.children.length,index)),0,node);target.collapsed=false;
  });
}
/** Markdown headings or a two-space indented list. Ordinary paragraphs remain whole nodes.
 * @param {string} title @param {string} outline @returns {MindMap} */
export function outlineToMindMap(title,outline){
  if([...outline].length>30000)throw Error('大纲最多 30,000 字符 / Outline limit: 30,000 characters');
  const root={id:newNodeId(),text:title.trim()||'Mind map',collapsed:false,children:/** @type {MindNode[]} */([])};
  /** @type {{depth:number,node:MindNode}[]} */const stack=[{depth:-1,node:root}];
  for(const raw of outline.split(/\r?\n/)){
    if(!raw.trim())continue;
    const heading=raw.match(/^(#{1,6})\s+(.+)$/);
    const spaces=(raw.match(/^\s*/)?.[0]||'').replaceAll('\t','  ').length;
    const depth=heading?heading[1].length-1:Math.floor(spaces/2);
    const label=(heading?heading[2]:raw.trim().replace(/^([-*+]\s+|\d+[.)]\s+)/,'')).trim();
    if(!label)continue;
    const node={id:newNodeId(),text:label,collapsed:false,children:/** @type {MindNode[]} */([])};
    while(stack.length>1&&stack[stack.length-1].depth>=depth)stack.pop();
    stack[stack.length-1].node.children.push(node);stack.push({depth,node});
  }
  return mindMap({root,layout:'bilateral'});
}
/** @param {MindMap} map */
export function mindMapMarkdown(map){
  const clean=mindMap(map);
  const escape=(/** @type {string} */s)=>s.replace(/\r?\n/g,' ').replace(/([\\`*_{}\[\]<>])/g,'\\$1');
  const lines=['# '+escape(clean.root.text),''];
  const visit=(/** @type {MindNode} */node,/** @type {number} */depth)=>{lines.push('  '.repeat(depth)+'- '+escape(node.text));node.children.forEach(n=>visit(n,depth+1));};
  clean.root.children.forEach(n=>visit(n,0));return lines.join('\n')+'\n';
}
