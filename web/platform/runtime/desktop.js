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
 * 流式对话:**先订阅 ai_chunk/ai_done/ai_error,后 invoke**(防丢首包)。
 * @param {import('./types').AiRequest | import('./types').AiGenerateRequest} req
 * @param {import('./types').AiStreamHandlers} [handlers]
 * @param {(sessionId: string) => Promise<any>} [startInvoke] 缺省 = ai_chat(带工具);生成模式传 ai_generate 的 invoker
 * @returns {import('./types').AiStream}
 */
function aiStream(req, handlers = {}, startInvoke) {
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

    // 不 await:命令在流结束时才 resolve;真正的结束信号走 ai_done/ai_error。
    //   startInvoke 缺省 = ai_chat(带工具循环);生成模式传入 ai_generate 的 invoker(结构性无工具)。
    (startInvoke ? startInvoke(sessionId) : invoke('ai_chat', { sessionId, userText: /** @type {import('./types').AiRequest} */ (req).userText, task: req.task || null }))
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
      // id 用 String() 兜底:记录可能用数值 id(种子/Math.max+1),后端 db_get/db_remove 形参是 String,
      // 不转则 Tauri 反序列化数值→String 失败,导致数值 id 记录无法 get/删除(删岗位等潜在 bug)。
      get: (collection, id) => invoke('db_get', { collection, id: String(id) }),
      upsert: (collection, record) => invoke('db_upsert', { collection, record }),
      remove: (collection, id) => invoke('db_remove', { collection, id: String(id) }), // 返快照 → toastUndo
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
      // ★块(i)·无工具流式生成(简历改写 / 面试反馈 / 出题)。走 ai_generate:后端命令签名**不接收
      //   registry/mcp/history** ⇒ 结构性无工具(注入的外部内容只能让模型说坏话,不能让它做事)。
      //   `untrusted`(JD / 待评估回答)在后端**必被 frame_untrusted 框定**(前置②,漏不掉)。
      //   复用 aiStream 的事件订阅(ai_chunk/ai_done/ai_error);ai_tool/ai_widget 在生成模式不会触发。
      generate: (req, handlers) => aiStream(req, handlers, (sessionId) =>
        invoke('ai_generate', {
          sessionId,
          task: req.task || null,
          instruction: req.instruction,
          untrusted: req.untrusted ?? null,
        })),
      // 一次性抽取(块3):prompt(+可选图片 data-URL)→ 最终文本;无工具/历史/系统提示。供 AI 智能录入。
      extract: (req) => invoke('ai_extract', { prompt: req.prompt, imageDataUrl: req.imageDataUrl ?? null }),
      getConfig: () => invoke('ai_config_get'),
      setConfig: (patch) =>
        invoke('ai_config_set', {
          baseUrl: patch.baseUrl ?? null,
          model: patch.model ?? null,
          embedModel: patch.embedModel ?? null,
          userAgent: patch.userAgent ?? null,
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
      // D3 三层闸能力层强制点:推入当前 AI 可读集(启用应用∩manifest∩授权),后端 sanitize 为 QUERYABLE 子集。
      setAiReadable: (collections) => invoke('set_ai_readable', { collections }),
    },

    memory: {
      // 长期记忆的用户掌控(#4):查看(不含 embedding)/ 清除 / 删一条 / 撤销(后端 trash 还原,向量不出后端)。
      list: () => invoke('memory_list'),
      // ★销毁命令返回 { deleted, undoToken }(undoToken=null ⇒ 无可撤销之物 ⇒ 前端不给撤销)。
      //   ★刀2b-2:undo 的 token **必填** —— 后端 `take(&str)` 已删掉「取最近一次」的 affordance,
      //   故一次撤销只能作用于它自己那一次销毁(还原错记录在类型层面不可能)。
      clear: () => invoke('memory_clear'),
      // 预检:这次清空是否可撤销 + **为什么不能**(`{undoable, reason}`;reason ∈ ok|corrupt|too_large)。
      // 供确认弹窗在用户做决定前说真话(评审第62轮 [应改];第64轮③ 加 corrupt 理由)。
      clearUndoable: () => invoke('memory_clear_undoable'),
      remove: (id) => invoke('memory_remove', { id }),
      // ★逃生口(第64轮③):销毁一条**不可映射(已损坏)**的记忆 —— 按 rowid 删,不快照、不发 token。
      //   后端**拒绝销毁健康行**(结构性守卫),故它不是「绕过快照直接删」的后门。
      removeCorrupt: (rowid) => invoke('memory_remove_corrupt', { rowid }),
      // ★修复优先于销毁(第66轮):`created_at` 有 schema `DEFAULT 0` ⇒ 归一化是忠实修复,零内容损失。
      //   其余列无默认值 ⇒ 不碰,销毁仍是它们唯一的逃生口。返回 {repaired, reason, aiReadable, recallBroken}。
      repairCorrupt: (rowid) => invoke('memory_repair_corrupt', { rowid }),
      undo: (token) => invoke('memory_undo', { token }),
    },

    docs: {
      // RAG-over-docs(#2):加文档(切块+嵌入,后端做)/ 列出(名+片段数)/ 删一篇 / 清空。
      add: (name, text) => invoke('doc_add', { name, text }),
      list: () => invoke('doc_list'),
      remove: (docId) => invoke('doc_remove', { docId }), // → { deleted, undoToken }
      // 预检:删这一篇是否可撤销(评审第64轮 [应改]:guardrail 建对话框时就印「执行后可撤销。」,
      // 故必须在**弹窗之前**问,而不是等 onConfirm 执行时才发现整篇超上限——那时话已出口)。
      removeUndoable: (docId) => invoke('doc_remove_undoable', { docId }),
      // ★逐片段逃生口(第65轮 [建议] 粒度对齐):销毁一个**不可映射**的片段 —— 按 rowid 删,不快照、不发 token。
      //   后端**拒绝销毁健康片段**(判据是快照代码 `doc_row_state`,不是谓词)⇒ 不是绕过快照的后门。
      //   删掉坏片段后,该篇立刻恢复「可撤销删除」,不必清空整个知识库。
      removeCorrupt: (rowid) => invoke('doc_remove_corrupt', { rowid }),
      repairCorrupt: (rowid) => invoke('doc_repair_corrupt', { rowid }), // 修复优先于销毁(第66轮)
      clear: () => invoke('doc_clear'), // → { deleted, undoToken }
      clearUndoable: () => invoke('doc_clear_undoable'),
      undo: (token) => invoke('doc_undo', { token }), // token 必填(后端 DocTrash 环按 token 还原,向量不出后端)
      // 块3b:从 PDF(data-URL 或 base64)提取纯文本(纯本地,不出网)。供 AI 录入把 PDF 转文本喂抽取路径。
      pdfText: (dataBase64) => invoke('pdf_extract_text', { dataBase64 }),
    },
    // MCP 开放扩展(#2 C4):server 管理 + 工具调用确认回传。本地 = spawn 程序,远程 = 连 HTTP 端点;
    // 令牌只进钥匙串(setAuth),前端不持明文。spec = { command,args }(本地)或 { url,auth }(远程)。
    mcp: {
      list: () => invoke('mcp_list'),
      add: (name, spec) => invoke('mcp_add', { name, ...(spec || {}) }),
      setAuth: (name, token) => invoke('mcp_set_auth', { name, token }),
      // stdio server 的环境变量:名 + 值 → 命令(值直送钥匙串;参数键 `var` 对齐 Rust 形参)。
      setEnv: (name, varName, value) => invoke('mcp_set_env', { name, var: varName, value }),
      remove: (name) => invoke('mcp_remove', { name }),
      setEnabled: (name, enabled) => invoke('mcp_set_enabled', { name, enabled }),
      probe: (spec) => invoke('mcp_probe', { ...(spec || {}) }),
      // 模型想调用某 MCP 工具时,前端经 guardrail 取得允许/拒绝后回传(唤醒挂起的网关)。
      confirmResolve: (confirmId, approved) => invoke('mcp_confirm_resolve', { confirmId, approved }),
    },
    // 导出/渲染(平台层 · 业务无关「文档模型 → 文件」)。.docx 零依赖手写,返回 base64。纯本地不出网。
    render: {
      docx: (doc) => invoke('export_docx', { doc }),
    },
    // 受控网页抓取(发现 agent · P0):出口只在 Rust 核(SSRF 护栏 + 限额),前端不出网。
    web: {
      fetch: (url) => invoke('web_fetch', { url }),
      open: (url) => invoke('open_external', { url }),
      verifySources: (urls) => invoke('verify_sources', { urls }),
    },
  };
}
