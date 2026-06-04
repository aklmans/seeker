// @ts-check
/**
 * 桌面端运行时(Tauri)。
 * 落地:Tauri invoke / event → Rust 核(钥匙串 / reqwest 流式 / …)。
 * G1 已接:ai(流式对话)、secret(钥匙串)、ai.getConfig/setConfig(provider 配置)。
 * db / capability 仍占位(#3 / #2)。
 */
import { notImpl } from './errors.js';

/** 桌面端「全功能」:所有能力都在。 */
const FEATURES = new Set(
  /** @type {import('./types').Feature[]} */ ([
    'db', 'ai', 'secret', 'capability',
    'voice', 'tray', 'globalShortcut', 'deepLink', 'autoUpdate',
  ]),
);

/** Tauri 全局(withGlobalTauri 注入)。 @returns {any} */
function tauri() {
  const t = /** @type {any} */ (globalThis).__TAURI__;
  if (!t || !t.core) throw new Error('Tauri 运行时不可用:window.__TAURI__ 缺失');
  return t;
}

/** @param {string} cmd @param {Record<string, unknown>} [args] @returns {Promise<any>} */
function invoke(cmd, args) {
  return tauri().core.invoke(cmd, args);
}

function genSessionId() {
  return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * 流式对话:**先订阅 ai_chunk/ai_done/ai_error,后 invoke ai_chat**(防丢首包)。
 * @param {import('./types').AiRequest} req
 * @param {import('./types').AiStreamHandlers} [handlers]
 * @returns {import('./types').AiStream}
 */
function aiStream(req, handlers = {}) {
  const sessionId = req.sessionId || genSessionId();
  const ev = tauri().event;
  /** @type {Array<() => void>} */
  let unlisten = [];
  let acc = '';
  /** @type {NonNullable<import('./types').AiResult['toolCalls']>} */
  const toolCalls = [];
  /** @type {NonNullable<import('./types').AiResult['widgets']>} */
  const widgets = [];
  const cleanup = () => {
    unlisten.forEach((u) => { try { if (u) u(); } catch (_e) { /* ignore */ } });
    unlisten = [];
  };

  const done = (async () => {
    /** @type {(r: import('./types').AiResult) => void} */
    let resolveDone = () => {};
    /** @type {(e: Error) => void} */
    let rejectDone = () => {};
    /** @type {Promise<import('./types').AiResult>} */
    const p = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });

    const hit = (/** @type {any} */ e) => e && e.payload && e.payload.sessionId === sessionId;
    unlisten = await Promise.all([
      ev.listen('ai_chunk', (/** @type {any} */ e) => {
        if (!hit(e)) return;
        acc += e.payload.text;
        if (handlers.onToken) handlers.onToken(e.payload.text);
      }),
      ev.listen('ai_tool', (/** @type {any} */ e) => {
        if (!hit(e)) return;
        // 工具循环活动(#2 · C1):记入结果 toolCalls,供 UI 可选展示「正在查询数据…」。
        toolCalls.push({ id: e.payload.id, name: e.payload.name, input: undefined });
        if (handlers.onTool) handlers.onTool({ id: e.payload.id, name: e.payload.name, ok: !!e.payload.ok });
      }),
      ev.listen('ai_widget', (/** @type {any} */ e) => {
        if (!hit(e)) return;
        // show_widget(#2 · W1):一张沙箱 widget 待渲染,交调用方插入对话流。
        const w = { id: e.payload.id, html: e.payload.html, title: e.payload.title, minHeight: e.payload.minHeight };
        widgets.push(w);
        if (handlers.onWidget) handlers.onWidget(w);
      }),
      ev.listen('ai_done', (/** @type {any} */ e) => {
        if (!hit(e)) return;
        cleanup();
        const r = { text: acc, stopReason: e.payload.stopReason, toolCalls, widgets };
        if (handlers.onDone) handlers.onDone(r);
        resolveDone(r);
      }),
      ev.listen('ai_error', (/** @type {any} */ e) => {
        if (!hit(e)) return;
        cleanup();
        const err = new Error(e.payload.message || 'AI 网关错误');
        if (handlers.onError) handlers.onError(err);
        rejectDone(err);
      }),
    ]);

    // 不 await:ai_chat 在流结束时才 resolve;真正的结束信号走 ai_done/ai_error。
    invoke('ai_chat', { sessionId, userText: req.userText, task: req.task || null })
      .catch((/** @type {any} */ err) => {
        cleanup();
        rejectDone(err instanceof Error ? err : new Error(String(err)));
      });
    return p;
  })();

  return {
    cancel: () => { invoke('ai_cancel', { sessionId }).catch(() => {}); },
    done,
  };
}

/** @returns {import('./types').RuntimeApi} */
export function createDesktopRuntime() {
  return {
    platform: 'desktop',
    available: (feature) => FEATURES.has(feature),

    db: {
      list: (collection, query) => invoke('db_list', { collection, query: query ?? null }),
      get: (collection, id) => invoke('db_get', { collection, id }),
      upsert: (collection, record) => invoke('db_upsert', { collection, record }),
      remove: (collection, id) => invoke('db_remove', { collection, id }), // 返快照 → toastUndo
      export: (redact) => invoke('db_export', { redact: !!redact }),
      import: (json) => invoke('db_import', { json }),
      backup: () => invoke('db_backup'),
    },

    profile: {
      // 隐私表,与 db 物理隔离;无"导出给 AI"的方法。
      getAll: () => invoke('profile_get_all'),
      set: (k, v) => invoke('profile_set', { k, v }),
    },

    ai: {
      stream: aiStream,
      complete: (req) => aiStream(req).done,
      getConfig: () => invoke('ai_config_get'),
      setConfig: (patch) =>
        invoke('ai_config_set', {
          baseUrl: patch.baseUrl ?? null,
          model: patch.model ?? null,
          embedModel: patch.embedModel ?? null,
        }),
      // 一协议多模型:选当前使用 / 删一个已存模型(配置完不清理)。
      selectModel: (model) => invoke('ai_model_select', { model }),
      removeModel: (model) => invoke('ai_model_remove', { model }),
    },

    secret: {
      // 仅状态/写入/清除;**没有 get**——明文密钥从命令层就回不到前端。
      status: (key) => invoke('secret_status', { account: key }),
      set: (key, value) => invoke('secret_set', { account: key, value }),
      clear: (key) => invoke('secret_clear', { account: key }),
    },

    capability: {
      // 能力层 registry(#2 · C1):列出 / 探测可用性 / 统一调用(破坏性能力被 Rust 侧拒,须走护栏)。
      list: () => invoke('cap_list'),
      available: (id) => invoke('cap_available', { id }),
      invoke: (id, input) => invoke('cap_invoke', { id, input: input ?? null }),
    },

    memory: {
      // 长期记忆的用户掌控(#4):查看(不含 embedding)/ 清除 / 删一条 / 撤销(后端 trash 还原,向量不出后端)。
      list: () => invoke('memory_list'),
      clear: () => invoke('memory_clear'),
      remove: (id) => invoke('memory_remove', { id }),
      undo: () => invoke('memory_undo'),
    },

    docs: {
      // RAG-over-docs(#2):加文档(切块+嵌入,后端做)/ 列出(名+片段数)/ 删一篇 / 清空。
      add: (name, text) => invoke('doc_add', { name, text }),
      list: () => invoke('doc_list'),
      remove: (docId) => invoke('doc_remove', { docId }),
      clear: () => invoke('doc_clear'),
    },
  };
}
