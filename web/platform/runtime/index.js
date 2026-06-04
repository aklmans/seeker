// @ts-check
/**
 * 运行时适配层入口。
 * 前端统一 `import { rt } from '.../platform/runtime/index.js'`,只依赖 {@link RuntimeApi}
 * 契约;由本模块按当前环境选择桌面 / 网页实现。换端只换实现,前端与业务不变。
 *
 * @typedef {import('./types').RuntimeApi} RuntimeApi
 */
import { createDesktopRuntime } from './desktop.js';
import { createWebRuntime } from './web.js';

export { NotImplementedError } from './errors.js';

/**
 * 环境探测:Tauri WebView 注入 `window.__TAURI__`(withGlobalTauri=true)→ 桌面;
 * 否则普通浏览器 → 网页。
 * @returns {boolean}
 */
function isTauri() {
  return typeof globalThis !== 'undefined'
    && !!(/** @type {any} */ (globalThis).__TAURI__);
}

/**
 * 创建运行时(按端选择实现)。
 * @returns {RuntimeApi}
 */
export function createRuntime() {
  return isTauri() ? createDesktopRuntime() : createWebRuntime();
}

/** 进程级单例。 */
export const rt = createRuntime();
