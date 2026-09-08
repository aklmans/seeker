// @ts-check
/** @typedef {{columns:string[],rows:string[][]}} Comparison */
/** @typedef {{events:{when:string,title:string,detail:string}[]}} Timeline */
const fail=()=>{throw Error('作品结构无效或内容过长 / Invalid or oversized content');};
/** @param {unknown} value @param {number} max @param {boolean} [required] */
function label(value,max,required=false){if(typeof value!=='string'||[...value].length>max||(required&&!value.trim()))return fail();return value;}
/** @param {unknown} raw @returns {Comparison} */
export function comparison(raw){
  const r=/** @type {Comparison} */(raw);
  if(!r||!Array.isArray(r.columns)||r.columns.length<2||r.columns.length>6||!Array.isArray(r.rows)||!r.rows.length||r.rows.length>80)return fail();
  const columns=r.columns.map(c=>label(c,100,true));
  const rows=r.rows.map(row=>{if(!Array.isArray(row)||row.length!==columns.length)return fail();return row.map(c=>label(c,500));});
  return {columns,rows};
}
/** @param {unknown} raw @returns {Timeline} */
export function timeline(raw){
  const r=/** @type {Timeline} */(raw);if(!r||!Array.isArray(r.events)||!r.events.length||r.events.length>80)return fail();
  return {events:r.events.map(e=>{if(!e||typeof e!=='object')return fail();return {when:label(e.when,80),title:label(e.title,200,true),detail:label(e.detail,2000)};})};
}
