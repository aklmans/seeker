// @ts-check

/** @param {{enabled?:unknown,lastBackupAt?:unknown}|null|undefined} view */
export function normalizeBackupPolicy(view) {
  return {
    value: view && view.enabled === false ? 'off' : 'on',
    lastBackupAt: view && Number.isFinite(Number(view.lastBackupAt)) && Number(view.lastBackupAt) > 0
      ? Number(view.lastBackupAt)
      : null,
  };
}

/**
 * 保存失败时把旧值作为返回值交还 UI，防止乐观开关与 SQLite 真相分叉。
 * @param {'on'|'off'} previous
 * @param {'on'|'off'} next
 * @param {(enabled:boolean)=>Promise<{enabled?:unknown,lastBackupAt?:unknown}>} persist
 */
export async function persistBackupPolicy(previous, next, persist) {
  try {
    const view = await persist(next === 'on');
    return { ok: true, ...normalizeBackupPolicy(view), error: null };
  } catch (error) {
    return { ok: false, value: previous, lastBackupAt: null, error };
  }
}
