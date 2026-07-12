// @ts-check
/** 平台 · Skills 数据仓(proposal-skills.md S2b)—— `platform_skills` 集合的内存缓存 + rt.db 读写。
 *
 *  ★为何要缓存:命令面板 `cmdFilterList` 是**同步**的 ⇒ `platformSkills()` 须同步返回 ⇒ 读内存缓存。
 *  缓存新鲜三保证:①boot(`seeker-rt-ready`)水合;②每次 CRUD(saveSkill/removeSkill)同步更新缓存
 *  (命令面板即时可见新 Skill);③管理面 renderSkills 每次重水合(与存储对齐)。
 *
 *  ★不 import copilot-chrome(避环):本仓只管数据;命令项构建(需 runSkill)在 copilot-chrome 侧读 listSkills()。
 */
import { normSkill } from './skill-model.js';

const rt = () => /** @type {any} */ (window).SeekerRT;
const COLL = 'platform_skills';

/** @type {ReturnType<typeof normSkill>[]} */
let _cache = [];
const byUpdated = (/** @type {any} */ a, /** @type {any} */ b) => (b.updated_at || 0) - (a.updated_at || 0);

/** 同步读缓存(命令面板 platformSkills 用)。返回副本防外部改缓存。 */
export function listSkills() {
  return _cache.slice();
}

/** 从 rt.db 重水合缓存(boot + 管理面每次渲染);失败留空、绝不抛。
 *  @returns {Promise<boolean>} 读取是否成功(true=状态已知;false=读失败,调用方据此拒绝依赖当前 Skills 状态的行动,如 prompts 迁移的幂等判定)。 */
export async function hydrateSkills() {
  try {
    _cache = (await rt().db.list(COLL)).map(normSkill).sort(byUpdated);
    return true;
  } catch (_e) {
    _cache = [];
    return false;
  }
}

/** 写一条(新建/编辑):rt.db.upsert + 同步更新缓存(命令面板即时新鲜)。
 *  @param {any} rec @returns {Promise<ReturnType<typeof normSkill>>} */
export async function saveSkill(rec) {
  const s = normSkill(rec);
  await rt().db.upsert(COLL, rec);
  _cache = [s, ..._cache.filter((x) => x.id !== s.id)].sort(byUpdated);
  return s;
}

/** 删一条:rt.db.remove(返快照)+ 同步更新缓存;返回被删的缓存快照供 toastUndo(经 saveSkill 还原)。
 *  @param {string} id @returns {Promise<ReturnType<typeof normSkill>|null>} */
export async function removeSkill(id) {
  const snap = _cache.find((x) => x.id === id) || null;
  await rt().db.remove(COLL, id);
  _cache = _cache.filter((x) => x.id !== id);
  return snap;
}

// boot 水合(同 prompts 的 seeker-rt-ready 时序法;模块 eval 时注册监听,rt 就绪后填缓存)。
window.addEventListener('seeker-rt-ready', () => {
  hydrateSkills();
});
