// @ts-check

/** @param {unknown} rt */
export function dbPersistenceAvailable(rt) {
  if (!rt || typeof rt !== 'object') return false;
  const runtime = /** @type {any} */ (rt);
  if (!runtime.db || typeof runtime.db.list !== 'function' || typeof runtime.db.upsert !== 'function' || typeof runtime.db.remove !== 'function') return false;
  try { return typeof runtime.available !== 'function' || runtime.available('db') === true; } catch (_e) { return false; }
}

/** profile 继续走物理隔离的 rt.profile,不因 Web 持久化而串入通用 rt.db。 @param {unknown} rt */
export function profilePersistenceAvailable(rt) {
  if (!rt || typeof rt !== 'object') return false;
  const profile = /** @type {any} */ (rt).profile;
  return !!profile && typeof profile.getAll === 'function' && typeof profile.set === 'function';
}
