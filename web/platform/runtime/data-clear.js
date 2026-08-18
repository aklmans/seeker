// @ts-check
/**
 * 壳层破坏性清空的窄契约。真正的“先备份、后事务删除”由各运行时实现；这里拒绝旧式逐行
 * best-effort 删除，也拒绝没有返回可恢复路径的假成功。
 * @param {import('./types').RuntimeApi} rt
 * @param {string[]} collections
 * @returns {Promise<{backupPath:string,deleted:number}>}
 */
export async function clearCollectionsSafely(rt, collections) {
  if (!rt || !rt.db || typeof rt.db.clear !== 'function') throw new Error('当前运行时不支持安全清空');
  const unique = [...new Set(collections.filter((c) => typeof c === 'string' && c))];
  if (!unique.length) throw new Error('没有要清空的数据集合');
  const result = await rt.db.clear(/** @type {any} */ (unique));
  if (!result || typeof result.backupPath !== 'string' || !result.backupPath) {
    throw new Error('备份未返回可恢复路径，已拒绝清空');
  }
  return { backupPath: result.backupPath, deleted: Number(result.deleted) || 0 };
}
