// @ts-check
/**
 * 便携备份允许携带的 localStorage 偏好。
 *
 * 白名单刻意窄化：访问码 `jh-democode`、未来令牌或任意应用私有键都不会因为“遍历整个
 * localStorage”而混入备份。Rust 侧还有同一白名单的第二道过滤，Web 端导入也只恢复这些键。
 */

const EXACT = new Set([
  'jh-settings',
  'jh-theme',
  'jh-lang',
  'jh-sbw',
  'jh-agentw',
  'jh-demonote',
  'jh-onboarded',
  'jh-demo',
  'jh-project',
  'seeker-apps',
]);

/** @param {string} key */
export function portablePreferenceKey(key) {
  if (EXACT.has(key)) return true;
  const suffix = key.startsWith('jh-seeded-') ? key.slice('jh-seeded-'.length) : '';
  return !!suffix && suffix.length <= 64 && /^[a-z0-9_-]+$/i.test(suffix);
}

/** @param {Storage} [storage] @returns {Record<string,string>} */
export function collectPortablePreferences(storage = globalThis.localStorage) {
  /** @type {Record<string,string>} */
  const out = {};
  if (!storage) return out;
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key || !portablePreferenceKey(key)) continue;
      const value = storage.getItem(key);
      if (value != null) out[key] = value;
    }
  } catch (_e) { /* 隐私模式 / 禁用存储：数据主体仍可备份 */ }
  return out;
}

/**
 * 恢复白名单内的字符串偏好；未知键和非字符串值一律丢弃。
 * @param {unknown} preferences
 * @param {Storage} [storage]
 * @returns {number} 实际恢复键数
 */
export function restorePortablePreferences(preferences, storage = globalThis.localStorage) {
  if (!storage || !preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return 0;
  let restored = 0;
  try {
    for (const [key, value] of Object.entries(/** @type {Record<string,unknown>} */ (preferences))) {
      if (!portablePreferenceKey(key) || typeof value !== 'string') continue;
      storage.setItem(key, value);
      restored++;
    }
  } catch (_e) { /* DB 数据已恢复；偏好存储不可用时不伪造更多成功数 */ }
  return restored;
}
