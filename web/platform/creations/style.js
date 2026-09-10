// @ts-check
/** Output styles are data, not arbitrary CSS. Editing a style never rewrites content. */
export const STYLE_PRESETS = [
  {id:'minimal',zh:'极简',en:'Minimal',background:'#ffffff',foreground:'#202124',accent:'#466b83',surface:'#f4f6f7',font:'sans',size:16,spacing:20,radius:4,edge:'curve'},
  {id:'business',zh:'商务',en:'Business',background:'#f5f7fa',foreground:'#172b4d',accent:'#235c9a',surface:'#ffffff',font:'sans',size:16,spacing:20,radius:2,edge:'line'},
  {id:'handdrawn',zh:'手绘',en:'Hand-drawn',background:'#fffaf0',foreground:'#3c352f',accent:'#a85b3b',surface:'#fffdf7',font:'serif',size:17,spacing:24,radius:18,edge:'sketch'},
  {id:'soft',zh:'柔和',en:'Soft',background:'#f5f0f7',foreground:'#463b52',accent:'#806392',surface:'#fffcff',font:'sans',size:16,spacing:24,radius:20,edge:'curve'},
  {id:'editorial',zh:'杂志',en:'Editorial',background:'#f8f3e9',foreground:'#28221e',accent:'#ad492c',surface:'#eee5d6',font:'serif',size:18,spacing:28,radius:0,edge:'line'},
  {id:'dark',zh:'深色',en:'Dark',background:'#1e2530',foreground:'#edf1f5',accent:'#91bfde',surface:'#2b3543',font:'sans',size:16,spacing:22,radius:8,edge:'curve'},
];
/** @typedef {{preset:string,background:string,foreground:string,accent:string,surface:string,font:string,size:number,spacing:number,radius:number,edge:string,theme?:'auto'}} CreationStyle */
/** @param {{[k:string]:unknown}} [input] @returns {CreationStyle} */
export function normalizeStyle(input = {}) {
  const p = STYLE_PRESETS.find(p=>p.id===input.preset) || STYLE_PRESETS[0];
  const color = (/** @type {string} */ key) => typeof input[key] === 'string' && /^#[0-9a-f]{6}$/i.test(/** @type {string} */(input[key])) ? String(input[key]) : /** @type {any} */(p)[key];
  const num = (/** @type {string} */ key,/** @type {number} */ min,/** @type {number} */ max) => typeof input[key]==='number' && Number.isFinite(input[key]) ? Math.max(min,Math.min(max,Number(input[key]))) : Number(/** @type {any} */(p)[key]);
  return {...(input.theme==='auto'?{theme:/** @type {const} */('auto')} : {}),preset:p.id,background:color('background'),foreground:color('foreground'),accent:color('accent'),surface:color('surface'),
    font:['sans','serif','mono'].includes(String(input.font))?String(input.font):p.font,size:num('size',12,28),spacing:num('spacing',8,48),radius:num('radius',0,32),edge:['curve','line','sketch'].includes(String(input.edge))?String(input.edge):p.edge};
}
/** @param {{[k:string]:unknown}} input */
export function styleCSS(input) {
  const s=normalizeStyle(input);
  return `:root{--bg:${s.background};--bg-elevated:${s.background};--bg-subtle:${s.surface};--ink:${s.foreground};--ink-2:${s.foreground};--ink-3:${s.foreground};--ink-mute:${s.foreground};--accent:${s.accent};--accent-soft:${s.surface};--border:${s.accent}44;--border-strong:${s.accent}88;--creation-gap:${s.spacing}px;--creation-radius:${s.radius}px}
    body{background:var(--bg);color:var(--ink);font-family:var(--font-${s.font});font-size:${s.size}px;padding:${s.spacing}px;line-height:1.65}
    h1,h2,h3,h4,h5,h6{font-family:inherit}h1{font-size:1.75em}h2{font-size:1.35em}h3{font-size:1.15em}
    table,input,select,textarea,button{font-family:inherit;font-size:inherit}.card,.box,.panel,button,input,select,textarea{border-radius:var(--creation-radius)}
    .card,.box,.panel{padding:var(--creation-gap);background:var(--bg-subtle)}
    ${s.edge==='sketch'?'.card,.box,.panel{border-style:dashed;border-width:1.5px}':''}`;
}
