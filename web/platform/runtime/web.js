// @ts-check
/**
 * 网页端运行时。
 * 落地方式:后端代理(AI 出网,不暴露 key)/ IndexedDB(数据)/ 会话内存或服务端代管(密钥)。
 * 「可降级子集」:系统集成类能力(托盘/全局快捷键/深链/自动更新)在网页端不可用,
 * available() 返回 false,UI 优雅隐藏入口。
 * M0:仅契约 + 空实现。
 */
import { NotImplementedError, notImpl } from './errors.js';

/** 网页端可用能力子集(系统集成类不在其中)。 */
const FEATURES = new Set(
  /** @type {import('./types').Feature[]} */ ([
    'db', 'ai', 'secret', 'capability',
  ]),
);

/** @returns {import('./types').RuntimeApi} */
export function createWebRuntime() {
  return {
    platform: 'web',
    available: (feature) => FEATURES.has(feature),

    db: {
      list: () => notImpl('rt.db.list', 'web'),          // → IndexedDB / 远端 API @ #3
      get: () => notImpl('rt.db.get', 'web'),
      upsert: () => notImpl('rt.db.upsert', 'web'),
      remove: () => notImpl('rt.db.remove', 'web'),
    },

    ai: {
      stream: () => {
        throw new NotImplementedError('rt.ai.stream', 'web'); // → 浏览器→自有后端代理 @ #1
      },
      complete: () => notImpl('rt.ai.complete', 'web'),
      getConfig: () => notImpl('rt.ai.getConfig', 'web'),
      setConfig: () => notImpl('rt.ai.setConfig', 'web'),
    },

    secret: {
      status: () => notImpl('rt.secret.status', 'web'),  // → 会话内存 / 服务端代管(不落浏览器)@ #4
      set: () => notImpl('rt.secret.set', 'web'),
      clear: () => notImpl('rt.secret.clear', 'web'),
    },

    profile: {
      getAll: () => notImpl('rt.profile.getAll', 'web'),
      set: () => notImpl('rt.profile.set', 'web'),
    },

    capability: {
      list: () => notImpl('rt.capability.list', 'web'),
      available: () => notImpl('rt.capability.available', 'web'),
      invoke: () => notImpl('rt.capability.invoke', 'web'),
    },
  };
}
