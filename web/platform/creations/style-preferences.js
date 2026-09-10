// @ts-check
import {normalizeStyle} from './style.js';
export const CREATION_STYLE_PREF='seeker-creation-style';
/** A copied default, written only by trusted Settings. Existing creations retain their own style. */
export function creationStylePreference(){
  try{const raw=JSON.parse(localStorage.getItem(CREATION_STYLE_PREF)||'{}');return {name:typeof raw.name==='string'?raw.name.slice(0,100):'',style:normalizeStyle(raw.style&&typeof raw.style==='object'?raw.style:{})};}
  catch{return {name:'',style:normalizeStyle()};}
}
export const defaultCreationStyle=()=>normalizeStyle({...creationStylePreference().style,theme:undefined});
/** Chat widgets inherit the app unless the user explicitly saved a personal default. */
export function defaultWidgetStyle(){
  const preference=creationStylePreference();
  return preference.name?preference.style:normalizeStyle({theme:'auto'});
}
/** @param {string} name @param {{[k:string]:unknown}} style */
export function saveCreationStylePreference(name,style){
  localStorage.setItem(CREATION_STYLE_PREF,JSON.stringify({name:name.slice(0,100),style:normalizeStyle(style)}));
}
