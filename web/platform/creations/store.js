// @ts-check
import {creationDraft} from '../runtime/creation-model.js';
import {defaultWidgetStyle} from './style-preferences.js';
/** @typedef {import('../runtime/types').CreationRecord} Creation */
export const newCreationId=()=> 'cr_'+crypto.randomUUID();
export function creationsChanged(){window.dispatchEvent(new CustomEvent('seeker-creations-changed'));}
/** @param {import('../runtime/types').CreationDraft} draft @param {number} expected */
export async function saveCreation(draft,expected){
  const saved=await window.SeekerRT.creations.save(creationDraft(draft),expected);
  creationsChanged();return saved;
}
/** @param {string} id @returns {Promise<Creation|null>} */
export async function getCreation(id){
  const raw=await window.SeekerRT.db.get('platform_creations',id);
  if(!raw)return null;
  creationDraft(raw);
  if(!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1||!Array.isArray(raw.history))throw new Error('作品记录损坏 / Invalid creation record');
  return /** @type {Creation} */(/** @type {unknown} */(raw));
}
/** @param {import('../runtime/types').WidgetPayload} widget @param {{conversationId?:string,projectId?:string,turnId?:string}} scope */
export async function saveGeneratedWidget(widget,scope,style=defaultWidgetStyle()){
  return saveCreation({id:newCreationId(),kind:'widget',title:(widget.title||'Widget').slice(0,200),content:{html:widget.html},style,
    source:{type:'chat',conversationId:scope.conversationId||'',turnId:scope.turnId||''},projectId:scope.projectId||'',deleted:false},0);
}
