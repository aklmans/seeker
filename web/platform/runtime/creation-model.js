// @ts-check
/** Bounded, portable records. No HTML is ever inserted into the parent document. */
export const CREATION_KINDS = ['widget','mindmap','card','comparison','timeline','style'];
const fail = () => { throw new Error('作品格式无效或内容过长 / Invalid or oversized creation'); };
/** @param {unknown} input @returns {import('./types').CreationDraft} */
export function creationDraft(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail();
  const d = /** @type {import('./types').CreationDraft} */ (input);
  if (typeof d.id !== 'string' || !/^cr_[a-zA-Z0-9_-]{1,80}$/.test(d.id) || !CREATION_KINDS.includes(d.kind) ||
      typeof d.title !== 'string' || !d.title.trim() || [...d.title].length > 200 ||
      typeof d.projectId !== 'string' || new TextEncoder().encode(d.projectId).length > 200 || typeof d.deleted !== 'boolean') return fail();
  for (const o of [d.content,d.style,d.source]) if (!o || typeof o !== 'object' || Array.isArray(o)) return fail();
  const clean = {id:d.id,kind:d.kind,title:d.title,content:d.content,style:d.style,source:d.source,projectId:d.projectId,deleted:d.deleted};
  if (new TextEncoder().encode(JSON.stringify(clean)).length > 262144) return fail();
  if (d.kind === 'widget' && (typeof d.content.html !== 'string' || !d.content.html.trim() || new TextEncoder().encode(d.content.html).length > 65536)) return fail();
  return JSON.parse(JSON.stringify(clean));
}
/** Validate a persisted record before treating imported data as an editable creation.
 * @param {unknown} input @returns {import('./types').CreationRecord} */
export function creationRecord(input){
  creationDraft(input);
  const r=/** @type {import('./types').CreationRecord} */(input);
  if(!Number.isSafeInteger(r.revision)||r.revision<1||!Number.isSafeInteger(r.createdAt)||!Number.isSafeInteger(r.updatedAt)||!Array.isArray(r.history)||r.history.length>20)return fail();
  for(const snapshot of r.history){
    creationDraft(snapshot);
    if(snapshot.id!==r.id||snapshot.kind!==r.kind||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<1||!Number.isSafeInteger(snapshot.updatedAt))return fail();
  }
  if(new TextEncoder().encode(JSON.stringify(r)).length>6000000)return fail();
  return r;
}
/** JSON object key order is not part of snapshot identity. @param {unknown} a @param {unknown} b @returns {boolean} */
function sameJSON(a,b){
  if(a===b)return true;
  if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
  const x=/** @type {{[k:string]:unknown}} */(a),y=/** @type {{[k:string]:unknown}} */(b);
  return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>Object.hasOwn(y,k)&&sameJSON(x[k],y[k]));
}
/** Only flip the deletion flag of an existing personal style; malformed fields remain recoverable.
 * Compare the complete snapshot because damaged imports may have no revision.
 * @param {import('./types').Record} expected @param {boolean} deleted @param {unknown} prior
 * @returns {import('./types').Record} */
export function nextStyleDeleted(expected,deleted,prior){
  if(!expected||expected.kind!=='style'||typeof deleted!=='boolean'||
    !(typeof expected.id==='string'||(typeof expected.id==='number'&&Number.isFinite(expected.id))))return fail();
  if(!sameJSON(expected,prior))throw Error('样式记录已变化，请重新打开设置 / Style changed; reopen settings');
  return {...expected,deleted};
}
/** Produce a new version from the exact record read inside the write transaction.
 * @param {unknown} draft @param {number} expected @param {import('./types').CreationRecord|null} prior @param {number} [now]
 * @returns {import('./types').CreationRecord} */
export function nextCreation(draft, expected, prior, now = Date.now()) {
  const clean = creationDraft(draft);
  if(prior && (!Number.isSafeInteger(prior.revision)||prior.revision<1||!Array.isArray(prior.history)||!Number.isSafeInteger(prior.createdAt)||!Number.isSafeInteger(prior.updatedAt)))return fail();
  if (!Number.isSafeInteger(expected) || expected < 0 || expected >= Number.MAX_SAFE_INTEGER || (prior?.revision ?? 0) !== expected || (prior && prior.id !== clean.id))
    throw new Error('作品已有新版本，请重新打开后再编辑 / Creation changed; reopen before editing');
  if (prior && prior.kind !== clean.kind) return fail();
  const history = prior ? [...(Array.isArray(prior.history) ? prior.history : []), {...creationDraft(prior),revision:prior.revision,updatedAt:prior.updatedAt}].slice(-20) : [];
  const next = {...clean,revision:expected+1,createdAt:prior?.createdAt ?? now,updatedAt:now,history};
  if (new TextEncoder().encode(JSON.stringify(next)).length > 6000000) return fail();
  return next;
}
