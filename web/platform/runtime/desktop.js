// @ts-check
/**
 * 桌面端运行时(Tauri)。
 * 落地方式:Tauri invoke → Rust 核(SQLite / 钥匙串 / reqwest 流式 / sidecar)。
 * M0:仅契约 + 空实现。真实命令在 #1(ai)/#3(db)/#4(secret)/#2(capability) 接入。
 */
import { NotImplementedError, notImpl } from './errors.js';

/** 桌面端「全功能」:所有能力都在。 */
const FEATURES = new Set(
  /** @type {import('./types').Feature[]} */ ([
    'db', 'ai', 'secret', 'capability',
    'voice', 'tray', 'globalShortcut', 'deepLink', 'autoUpdate',
  ]),
);

/**
 * 封装 Tauri invoke(withGlobalTauri=true → window.__TAURI__ 注入)。
 * 现在未被任何空实现调用;留作 #1+ 真实命令接入点。
 * @param {string} cmd
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<unknown>}
 */
// eslint-disable-next-line no-unused-vars
function invoke(cmd, args) {
  const tauri = /** @type {any} */ (globalThis).__TAURI__;
  if (!tauri?.core?.invoke) {
    return Promise.reject(new Error('Tauri 运行时不可用:window.__TAURI__ 缺失'));
  }
  return tauri.core.invoke(cmd, args);
}

/** @returns {import('./types').RuntimeApi} */
export function createDesktopRuntime() {
  return {
    platform: 'desktop',
    available: (feature) => FEATURES.has(feature),

    db: {
      list: () => notImpl('rt.db.list', 'desktop'),          // → invoke('db_list', …)   @ #3
      get: () => notImpl('rt.db.get', 'desktop'),            // → invoke('db_get', …)    @ #3
      upsert: () => notImpl('rt.db.upsert', 'desktop'),      // → invoke('db_upsert', …) @ #3
      remove: () => notImpl('rt.db.remove', 'desktop'),      // → 经 guardrail 预览+确认+撤销 @ #3
    },

    ai: {
      // 流式返回同步句柄,故此处同步抛错(不能返回 rejected Promise)。
      stream: () => {
        throw new NotImplementedError('rt.ai.stream', 'desktop'); // → invoke + event 回灌 @ #1
      },
      complete: () => notImpl('rt.ai.complete', 'desktop'),
    },

    secret: {
      status: () => notImpl('rt.secret.status', 'desktop'),  // → 钥匙串查 configured/empty @ #4
      set: () => notImpl('rt.secret.set', 'desktop'),        // → 直送钥匙串,不回显 @ #4
      clear: () => notImpl('rt.secret.clear', 'desktop'),
    },

    capability: {
      list: () => notImpl('rt.capability.list', 'desktop'),
      available: () => notImpl('rt.capability.available', 'desktop'),
      invoke: () => notImpl('rt.capability.invoke', 'desktop'),
    },
  };
}
