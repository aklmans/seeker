// @ts-check
/** Actual shell appearance; creation styles live separately. */
export function themeMode(){
  try{const v=localStorage.getItem('jh-theme');return v==='light'||v==='system'?v:'dark';}catch{return 'dark';}
}
export function applyTheme(){
  document.documentElement.dataset.theme=themeMode()==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):themeMode();
}
/** @param {string} value */
export function setThemeMode(value){
  if(!['light','dark','system'].includes(value))return;
  localStorage.setItem('jh-theme',value);applyTheme();
}
export function applyAppearance(){
  /** @type {Record<string,unknown>} */
  let prefs={};try{prefs=JSON.parse(localStorage.getItem('jh-settings')||'{}')||{};}catch{}
  const root=document.documentElement;
  root.style.setProperty('--body-font-size',(['13','14','15','16'].includes(String(prefs.fontsize))?prefs.fontsize:'14')+'px');
  root.dataset.density=['compact','cozy'].includes(String(prefs.density))?String(prefs.density):'standard';
  root.dataset.reduceMotion=prefs.motion==='off'?'off':'on';
  applyTheme();
}
/** @param {{fontsize?:string,density?:string,motion?:string}} patch */
export function saveAppearance(patch){
  let previous={};try{previous=JSON.parse(localStorage.getItem('jh-settings')||'{}')||{};}catch{}
  localStorage.setItem('jh-settings',JSON.stringify({...previous,...patch}));applyAppearance();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(themeMode()==='system')applyTheme();});
