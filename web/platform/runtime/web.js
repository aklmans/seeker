// @ts-check
/**
 * 网页端运行时。
 * 数据走 **IndexedDB**(#3 D4):rt.db / rt.profile 在浏览器本地持久化,与桌面同契约;
 * 导出/导入用 Blob 下载 / 文件读入。AI 与 secret 仍降级(需自有后端代理 / 服务端代管,未实现)。
 * 「可降级子集」:系统集成类能力(托盘/全局快捷键/深链/自动更新)在网页端不可用。
 */
import { NotImplementedError, notImpl } from './errors.js';

const FEATURES = new Set(
  /** @type {import('./types').Feature[]} */ (['db', 'ai', 'secret', 'capability']),
);

// ── IndexedDB 数据层(同一 Repository 契约的网页实现)─────────────
const DB_NAME = 'seeker';
const DB_VERSION = 2; // v2:阶段4 assets_* 集合(onupgradeneeded 增量建 store,既有数据不动)
/** 业务集合(keyPath 'id');与桌面 table_for 白名单一致 —— profile 不在其中。 */
const COLLECTIONS = ['jobs', 'skills', 'actions', 'resumes', 'iv_records', 'messages', 'assets_prompts', 'assets_notes', 'platform_skills'];
const KV_STORES = ['profile', 'settings', 'meta'];

/** @type {Promise<any> | null} */
let dbPromise = null;
/** @returns {Promise<any>} IDBDatabase */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const idb = /** @type {any} */ (globalThis).indexedDB;
    if (!idb) { reject(new Error('IndexedDB 不可用')); return; }
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      COLLECTIONS.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' }); });
      KV_STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'k' }); });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('打开 IndexedDB 失败'));
  });
  return dbPromise;
}
/** @param {any} req @returns {Promise<any>} */
function reqDone(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
/** @param {string} name @param {IDBTransactionMode} mode @returns {Promise<any>} IDBObjectStore */
function store(name, mode) {
  return openDb().then((db) => db.transaction(name, mode).objectStore(name));
}
/** 集合白名单守卫(与桌面 table_for 一致:profile/settings 不可经通用 db_*)。
 *  @param {string} c @returns {Promise<never> | null} */
function guard(c) {
  return COLLECTIONS.includes(c) ? null : Promise.reject(new Error('未知或受保护的集合: ' + c));
}
/** @param {string} name @returns {Promise<any[]>} */
async function listAll(name) {
  const s = await store(name, 'readonly');
  return /** @type {any[]} */ ((await reqDone(s.getAll())) || []);
}
/** @param {string} name @returns {Promise<{[k:string]:string}>} */
async function kvAll(name) {
  /** @type {{[k:string]:string}} */
  const o = {};
  (await listAll(name)).forEach((r) => { if (r && typeof r.k === 'string') o[r.k] = String(r.v); });
  return o;
}
/** @param {any} obj @param {string} filename @returns {string} */
function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
/** @param {boolean} redact @returns {Promise<any>} */
async function bundleAll(redact) {
  /** @type {any} */
  const collections = {};
  for (const c of COLLECTIONS) collections[c] = await listAll(c);
  return {
    schemaVersion: DB_VERSION,
    exportedAt: Date.now(),
    redacted: !!redact,
    collections,
    settings: await kvAll('settings'),
    profile: redact ? {} : await kvAll('profile'),
  };
}

/** @returns {import('./types').RuntimeApi} */
export function createWebRuntime() {
  return {
    platform: 'web',
    available: (feature) => FEATURES.has(feature),

    db: {
      list: async (collection) => guard(collection) || listAll(collection),
      get: async (collection, id) => {
        const bad = guard(collection);
        if (bad) return bad;
        const s = await store(collection, 'readonly');
        return (await reqDone(s.get(id))) ?? null;
      },
      upsert: async (collection, record) => {
        const bad = guard(collection);
        if (bad) return bad;
        const s = await store(collection, 'readwrite');
        await reqDone(s.put(record));
        return /** @type {any} */ (record);
      },
      remove: async (collection, id) => {
        const bad = guard(collection);
        if (bad) return bad;
        const s1 = await store(collection, 'readonly');
        const snap = (await reqDone(s1.get(id))) ?? null;
        const s2 = await store(collection, 'readwrite');
        await reqDone(s2.delete(id));
        return snap;
      },
      export: async (redact) => downloadJson(await bundleAll(redact), 'seeker-export' + (redact ? '-redacted' : '') + '-' + Date.now() + '.json'),
      import: async (json) => {
        const bundle = JSON.parse(json);
        /** @type {{[c:string]:number}} */
        const counts = {};
        const cols = (bundle && bundle.collections) || {};
        for (const c of COLLECTIONS) {
          const arr = Array.isArray(cols[c]) ? cols[c] : [];
          if (!arr.length) continue;
          const s = await store(c, 'readwrite');
          let n = 0;
          for (const rec of arr) { if (rec && rec.id !== undefined) { await reqDone(s.put(rec)); n++; } }
          counts[c] = n;
        }
        for (const kv of ['profile', 'settings']) {
          const obj = (bundle && bundle[kv]) || {};
          const s = await store(kv, 'readwrite');
          for (const k of Object.keys(obj)) await reqDone(s.put({ k, v: String(obj[k]) }));
        }
        return counts;
      },
      backup: async () => downloadJson(await bundleAll(false), 'seeker-backup-' + Date.now() + '.json'),
    },

    profile: {
      getAll: () => kvAll('profile'),
      set: async (k, v) => { const s = await store('profile', 'readwrite'); await reqDone(s.put({ k, v: String(v) })); },
    },

    ai: {
      stream: () => {
        throw new NotImplementedError('rt.ai.stream', 'web'); // → 浏览器→自有后端代理 @ #1
      },
      complete: () => notImpl('rt.ai.complete', 'web'),
      generate: () => { throw new NotImplementedError('rt.ai.generate', 'web'); }, // 生成是桌面能力(同 stream)
      appToolResult: () => notImpl('rt.ai.appToolResult', 'web'), // app-tool 协议是桌面能力(块 T0)
      extract: () => notImpl('rt.ai.extract', 'web'),
      getConfig: () => notImpl('rt.ai.getConfig', 'web'),
      setConfig: () => notImpl('rt.ai.setConfig', 'web'),
      selectModel: () => notImpl('rt.ai.selectModel', 'web'),
      removeModel: () => notImpl('rt.ai.removeModel', 'web'),
    },

    secret: {
      status: () => notImpl('rt.secret.status', 'web'), // → 会话内存 / 服务端代管(不落浏览器)@ #4
      set: () => notImpl('rt.secret.set', 'web'),
      clear: () => notImpl('rt.secret.clear', 'web'),
    },

    capability: {
      list: () => notImpl('rt.capability.list', 'web'),
      available: () => notImpl('rt.capability.available', 'web'),
      invoke: () => notImpl('rt.capability.invoke', 'web'),
      // web 端无能力层 / AI 工具循环 → D3 强制点无对象;noop(非 notImpl:开关变化会常态调用)。
      setAiReadable: () => Promise.resolve(),
    },

    // 网页端暂无本地长期记忆(BYO 嵌入 + SQLite 为桌面能力)→ 优雅降级:空列表、清除无操作。
    memory: {
      list: () => Promise.resolve([]),
      // ★刀2b-1:销毁命令的降级返回须与桌面同形 —— { deleted, undoToken }。
      //   deleted:0 + undoToken:null ⇒ 前端「提供撤销 ⇔ 销毁确已发生」据此**不给撤销**;
      //   undo 返回 0 ⇒ restoreFn 如实上报 false ⇒ toast.js 不报「已撤销」。
      //   (第61轮 [建议]2:降级路径如实上报,安全性不让「web 端不可达」这个偶然前提承重。)
      clear: () => Promise.resolve({ deleted: 0, undoToken: null }),
      // web 端本无行 ⇒ 无损坏行、估算 0 字节 ⇒ 可撤销(与桌面判据同源、同形)
      clearUndoable: () => Promise.resolve({ undoable: true, reason: 'ok' }),
      remove: () => Promise.resolve({ deleted: 0, undoToken: null }),
      removeCorrupt: () => Promise.resolve({ deleted: 0, undoToken: null }), // 无行可损坏 ⇒ 诚实 no-op
      repairCorrupt: () => Promise.resolve({ repaired: false, reason: 'missing', aiReadable: false, recallBroken: false }),
      undo: (_token) => Promise.resolve(0), // 环内无此次销毁 ⇒ 还原 0 条(前端据此 staleUndo,不报「已撤销」)
    },

    // 网页端暂无本地知识库(切块/嵌入/SQLite 为桌面能力)→ 列空、加文档不支持、删/清无操作。
    docs: {
      add: () => notImpl('rt.docs.add', 'web'),
      list: () => Promise.resolve([]),
      remove: () => Promise.resolve({ deleted: 0, undoToken: null }), // 与桌面同形(刀2b-1)
      removeUndoable: () => Promise.resolve({ undoable: true, reason: 'ok' }), // 同形:{undoable, reason}
      removeCorrupt: () => Promise.resolve({ deleted: 0, undoToken: null }), // 无片段可损坏 ⇒ 诚实 no-op
      repairCorrupt: () => Promise.resolve({ repaired: false, reason: 'missing', aiReadable: false, recallBroken: false }),
      clear: () => Promise.resolve({ deleted: 0, undoToken: null }),
      clearUndoable: () => Promise.resolve({ undoable: true, reason: 'ok' }),
      undo: (_token) => Promise.resolve(0),
      pdfText: () => notImpl('rt.docs.pdfText', 'web'),
    },

    // MCP:本地需 spawn 子进程、远程需平台核出网,web 端均不支持 → 列表空、其余降级。
    mcp: {
      list: () => Promise.resolve([]),
      add: () => notImpl('rt.mcp.add', 'web'),
      setAuth: () => notImpl('rt.mcp.setAuth', 'web'),
      setEnv: () => notImpl('rt.mcp.setEnv', 'web'),
      remove: () => Promise.resolve(),
      setEnabled: () => Promise.resolve(),
      probe: () => notImpl('rt.mcp.probe', 'web'),
      confirmResolve: () => Promise.resolve(),
    },
    // .docx 渲染在 Rust 核;web 端无 → 降级(domain 仍可走 Markdown 导出/复制)。
    render: {
      docx: () => notImpl('rt.render.docx', 'web'),
    },
    // 网页抓取需平台核出网;web 端无 → 降级(出口红线:前端绝不直接出网)。
    web: {
      fetch: () => notImpl('rt.web.fetch', 'web'),
      // web 端:在新标签打开(浏览器原生);noopener 防被开页反向操控。
      // 镜像桌面 open_external 的 scheme 闸:仅 http/https(防他处传 javascript:/data: 等)。
      open: (url) => {
        const s = String(url == null ? '' : url);
        if (!/^https?:\/\//i.test(s)) return Promise.reject(new Error('仅支持 http / https'));
        try { window.open(s, '_blank', 'noopener,noreferrer'); } catch (_e) { /* 弹窗拦截 */ }
        return Promise.resolve();
      },
      // web 端无平台核出网 → 验链降级返空(domain 视作未验,照常展示)。
      verifySources: () => Promise.resolve([]),
    },
  };
}
