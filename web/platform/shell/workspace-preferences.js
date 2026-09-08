// @ts-check
/** Device preferences are only written from trusted settings UI, never from chat. */
export const WORKSPACE_PREF_KEY='seeker-workspace';
/** @param {unknown} raw */
export function normalizeWorkspacePreferences(raw){
  const r=/** @type {Record<string,unknown>} */(raw&&typeof raw==='object'?raw:{});
  return {
    name:typeof r.name==='string'?r.name.trim().slice(0,80):'',
    startPage:typeof r.startPage==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(r.startPage)?r.startPage:'home',
    showMaterials:r.showMaterials!==false,
    showTasks:r.showTasks!==false,
  };
}
export function workspacePreferences(){
  try{return normalizeWorkspacePreferences(JSON.parse(localStorage.getItem(WORKSPACE_PREF_KEY)||'{}'));}
  catch{return normalizeWorkspacePreferences(null);}
}
/** @param {unknown} value */
export function saveWorkspacePreferences(value){
  const next=normalizeWorkspacePreferences(value);
  localStorage.setItem(WORKSPACE_PREF_KEY,JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('seeker-workspace-preferences-changed'));
}
