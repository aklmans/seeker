// @ts-check
/** 平台 · Project 数据仓(proposal-project PJ1)—— `platform_projects` 集合的内存缓存 + rt.db 读写。
 *  镜像 skill-store/schedule-store:①boot(`seeker-rt-ready`)水合 ②CRUD 同步更新缓存(PJ2 切换器同步读)
 *  ③管理面每次渲染重水合。
 *  ★红线:项目 CRUD **只在能力中心管理面**(§4-2):Agent 不能创建/改项目(自我提示注入通路缺席,
 *  第98轮;详见 project-model.js 头注);`platform_projects` 永不进 QUERYABLE。 */
import { normProject } from './project-model.js';

const rt = () => /** @type {any} */ (window).SeekerRT;
const COLL = 'platform_projects';

/** @type {ReturnType<typeof normProject>[]} */
let _cache = [];
const byUpdated = (/** @type {any} */ a, /** @type {any} */ b) => (b.updated_at || 0) - (a.updated_at || 0);

/** 同步读缓存(PJ2 切换器用)。返回副本防外部改缓存。 */
export function listProjects() {
  return _cache.slice();
}

/** 从 rt.db 重水合缓存;失败留空、绝不抛。@returns {Promise<boolean>} 读取是否成功。 */
export async function hydrateProjects() {
  try {
    _cache = (await rt().db.list(COLL)).map(normProject).sort(byUpdated);
    return true;
  } catch (_e) {
    _cache = [];
    return false;
  }
}

/** 写一条(新建/编辑/归档):rt.db.upsert + 同步更新缓存。
 *  @param {any} rec @returns {Promise<ReturnType<typeof normProject>>} */
export async function saveProject(rec) {
  const p = normProject(rec);
  await rt().db.upsert(COLL, rec);
  _cache = [p, ..._cache.filter((x) => x.id !== p.id)].sort(byUpdated);
  return p;
}

/** 删一条(PJ1 管理面**不暴露删除** —— §5.4 预裁 MVP 只归档;本函数仅供测试清理/未来 guardrail 批量档)。
 *  @param {string} id @returns {Promise<ReturnType<typeof normProject>|null>} */
export async function removeProject(id) {
  const snap = _cache.find((x) => x.id === id) || null;
  await rt().db.remove(COLL, id);
  _cache = _cache.filter((x) => x.id !== id);
  return snap;
}

// boot 水合(同 skill-store/schedule-store 时序法)。
window.addEventListener('seeker-rt-ready', () => {
  hydrateProjects();
});
