// @ts-check
/** 平台 · Scheduled tasks 数据仓(proposal-scheduled-tasks SC1)—— `platform_schedules` 集合的内存缓存 + rt.db 读写。
 *  镜像 skill-store:①boot(`seeker-rt-ready`)水合 ②CRUD 同步更新缓存(调度器 tick 同步读)③管理面每次渲染重水合。
 *  ★红线:调度 CRUD **只在能力中心管理面**(§4-2 不可经对话改);永不注册可写本集合的 capability/app-tool
 *  (第95轮 [建议]-强,详见 schedule-model.js 头注)。 */
import { normSchedule } from './schedule-model.js';

const rt = () => /** @type {any} */ (window).SeekerRT;
const COLL = 'platform_schedules';

/** @type {ReturnType<typeof normSchedule>[]} */
let _cache = [];
const byUpdated = (/** @type {any} */ a, /** @type {any} */ b) => (b.updated_at || 0) - (a.updated_at || 0);

/** 同步读缓存(调度器 tick 用)。返回副本防外部改缓存。 */
export function listSchedules() {
  return _cache.slice();
}

/** 从 rt.db 重水合缓存;失败留空、绝不抛。@returns {Promise<boolean>} 读取是否成功。 */
export async function hydrateSchedules() {
  try {
    _cache = (await rt().db.list(COLL)).map(normSchedule).sort(byUpdated);
    return true;
  } catch (_e) {
    _cache = [];
    return false;
  }
}

/** 写一条(新建/编辑/fire 写回):rt.db.upsert + 同步更新缓存。
 *  @param {any} rec @returns {Promise<ReturnType<typeof normSchedule>>} */
export async function saveSchedule(rec) {
  const s = normSchedule(rec);
  await rt().db.upsert(COLL, rec);
  _cache = [s, ..._cache.filter((x) => x.id !== s.id)].sort(byUpdated);
  return s;
}

/** 删一条:rt.db.remove + 缓存移除;返回被删快照供 toastUndo(经 saveSchedule 还原)。
 *  @param {string} id @returns {Promise<ReturnType<typeof normSchedule>|null>} */
export async function removeSchedule(id) {
  const snap = _cache.find((x) => x.id === id) || null;
  await rt().db.remove(COLL, id);
  _cache = _cache.filter((x) => x.id !== id);
  return snap;
}

// boot 水合(同 skill-store 时序法)。
window.addEventListener('seeker-rt-ready', () => {
  hydrateSchedules();
});
