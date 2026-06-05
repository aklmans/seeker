/**
 * 运行时适配层契约(Runtime Adapter Contract)
 * ------------------------------------------------------------------
 * 前端**永远只依赖这组接口**,绝不直接 fetch 外网、绝不直接碰 SQLite
 * 表结构或密钥。两端各有一套实现:
 *   · 桌面(desktop) → Tauri invoke → Rust 核(SQLite / 钥匙串 / reqwest / sidecar)
 *   · 网页(web)     → 后端代理 / IndexedDB / 会话内存
 *
 * 铁律(从类型层面固化):
 *   1. 密钥与隐私字段**永不进前端**。{@link SecretApi} 故意没有 `get()`——
 *      明文无法从类型上回到 WebView;前端只能 `status()` 看到 configured/empty。
 *   2. 能力缺失时,适配器让 `available()` 返回 false,UI 优雅隐藏入口,
 *      而不是抛错。具体方法被调用时若该端不支持,才抛 {@link NotImplementedError}。
 *
 * M0:仅定义契约 + 空实现。真实落地见 #1(ai)/#3(db)/#2(capability)/#4(secret)。
 */

export type Platform = 'desktop' | 'web';

/** 可探测的能力键;`available()` 据此决定 UI 是否显示入口。 */
export type Feature =
  | 'db'
  | 'ai'
  | 'secret'
  | 'capability'
  | 'voice'
  | 'tray'
  | 'globalShortcut'
  | 'deepLink'
  | 'autoUpdate';

// ── 数据仓库(rt.db)──────────────────────────────────────────────
// 弹性 schema:每条记录 = 骨架列 + data_json(见「数据层与迁移方案」)。
// 前端只认「集合名 + 记录」,不认表结构。

/** 业务集合名(对应数据层的表/仓库)。domain 通过它定位数据,不碰 SQL。 */
export type Collection =
  | 'jobs'
  | 'skills'
  | 'actions'
  | 'resumes'
  | 'iv_records'
  | 'messages'
  | 'settings';
//  注:'profile'(隐私字段)与 'secrets'(密钥)**不在此**——前者走独立隔离仓库、
//  AI 永不读取;后者只进钥匙串(见 SecretApi)。

export interface Record {
  id: string;
  [field: string]: unknown;
}

export interface Query {
  /** 过滤条件(字段精确匹配);复杂查询后续扩展。 */
  where?: { [field: string]: unknown };
  orderBy?: string;
  desc?: boolean;
  limit?: number;
  offset?: number;
}

export interface DbApi {
  list(collection: Collection, query?: Query): Promise<Record[]>;
  get(collection: Collection, id: string): Promise<Record | null>;
  /** 新增或更新(无 id 则创建)。返回写入后的完整记录。 */
  upsert(collection: Collection, record: Partial<Record>): Promise<Record>;
  /**
   * 删除——**破坏性操作**。返回被删记录(快照)→ 前端 toastUndo 撤销(经 upsert 还原)。
   * 无论调用者是 UI、Agent 还是 widget,都走同一护栏。
   */
  remove(collection: Collection, id: string): Promise<Record | null>;
  /** 全量导出到本地文件(redact=true 剔除 profile 供分享);返回文件路径。 */
  export(redact: boolean): Promise<string>;
  /** 从 JSON 字符串导入(校验版本 + 导入前快照 + 合并 upsert);返回各集合导入条数。 */
  import(json: string): Promise<{ [collection: string]: number }>;
  /** 即时备份(VACUUM INTO);返回备份文件路径。 */
  backup(): Promise<string>;
}

// ── 隐私字段(rt.profile)── 隐私红线 ─────────────────────────────
// profile 与 db 物理隔离:Collection 不含 'profile';此接口**无任何"导出给 AI"的方法**。

export interface ProfileApi {
  /** 读取全部隐私字段(k→v)。 */
  getAll(): Promise<{ [k: string]: string }>;
  set(k: string, v: string): Promise<void>;
}

// ── AI 网关(rt.ai)───────────────────────────────────────────────
// 前端只发文字、收 token 流;出网与密钥都在 Rust。提示组装时**排除 profile**。

export interface AiRequest {
  /** 用户文本——前端只发文字。 */
  userText: string;
  /** 会话 id(缺省由适配器生成):流式事件路由 + 取消。 */
  sessionId?: string;
  /** 任务类型(智能匹配 / 简历改写 / 面试反馈 …),选择系统提示;由 domain/prompts 配置驱动。 */
  task?: string;
  /** 业务上下文(白名单);网关组装提示时**结构上不含 profile 隐私字段**。 */
  context?: unknown;
}

/** show_widget 下发载荷(不可信 HTML,前端在 sandbox iframe + srcDoc 内 CSP 渲染)。 */
export interface WidgetPayload {
  id: string;
  /** 已过平台核 sanitize 的自包含 HTML(仍视为不可信,只进沙箱)。 */
  html: string;
  title: string;
  minHeight: number;
}

export interface AiResult {
  text: string;
  /** 结束原因:stop | cancelled | length … */
  stopReason?: string;
  /** 模型返回的工具调用(交给 Rust 工具层执行,含 show_widget)。G3。 */
  toolCalls?: Array<{ id: string; name: string; input: unknown }>;
  /** 本轮渲染的 widget(show_widget 工具产出)。 */
  widgets?: WidgetPayload[];
}

export interface AiStreamHandlers {
  onToken?: (token: string) => void;
  /** 工具循环活动(G3 / #2·C1):一次工具被调用(id/name + 成功与否)。 */
  onTool?: (tool: { id: string; name: string; ok: boolean }) => void;
  /** show_widget(#2·W1):一张沙箱 widget 待渲染。调用方据此插入对话流。 */
  onWidget?: (widget: WidgetPayload) => void;
  onDone?: (result: AiResult) => void;
  onError?: (err: Error) => void;
}

/** 流式调用的句柄:可取消;`done` 在结束时 resolve。 */
export interface AiStream {
  cancel(): void;
  done: Promise<AiResult>;
}

export interface AiConfig {
  baseUrl: string;
  /** 当前启用的模型(active)。 */
  model: string;
  /** 嵌入模型名(BYO `/embeddings`;长期记忆 / RAG 用)。空 = 未配置。 */
  embedModel: string;
  /** 同一协议下已保存的模型名(active = model,必在此列表内)。 */
  models: string[];
  /** key 是否已配置(钥匙串);**绝不含明文**。 */
  keyStatus: SecretStatus;
}

export interface AiApi {
  /** 流式补全(SSE/chunk → 逐 token 回灌)。 */
  stream(req: AiRequest, handlers?: AiStreamHandlers): AiStream;
  /** 非流式补全(= stream 收齐)。 */
  complete(req: AiRequest): Promise<AiResult>;
  /** 一次性抽取(块3):prompt(+可选图片 data-URL)→ 最终文本。无工具/历史/系统提示;供 AI 智能录入从截图/文本抽取岗位。 */
  extract(req: { prompt: string; imageDataUrl?: string | null }): Promise<string>;
  /** 读取非密钥 provider 配置 + key 状态(不含明文)。 */
  getConfig(): Promise<AiConfig>;
  /** 写非密钥配置(baseUrl/model/embedModel);model 非空 = 加入已存列表 + 设为当前;key 走 rt.secret.set 进钥匙串。 */
  setConfig(patch: { baseUrl?: string; model?: string; embedModel?: string }): Promise<void>;
  /** 一协议多模型:从已保存列表选当前使用的模型。 */
  selectModel(model: string): Promise<void>;
  /** 删除一个已保存模型(删当前则改用剩余第一个)。 */
  removeModel(model: string): Promise<void>;
}

// ── 密钥(rt.secret)── 隐私红线 ─────────────────────────────────
// 明文密钥**只进系统钥匙串**,绝不回前端。故此接口**没有 get()**。

export type SecretStatus = 'configured' | 'empty';

export interface SecretApi {
  /** 前端只能查「是否已配置」,拿不到明文。 */
  status(key: string): Promise<SecretStatus>;
  /** 写入(value 直送 Rust → 钥匙串,绝不被回显 / 入库 / 进日志)。 */
  set(key: string, value: string): Promise<void>;
  clear(key: string): Promise<void>;
  // ⚠️ 故意不提供 get():明文从类型层面就无法回到 WebView。
}

// ── 能力层(rt.capability)──────────────────────────────────────
// RAG/记忆/向量/MCP/ACP/Skills/show_widget 均实现统一 Capability 契约,注册即生效。

export interface CapabilityInfo {
  id: string;
  available: boolean;
  /** 暴露给 LLM 的工具描述(JSON Schema)。 */
  schema?: unknown;
}

export interface CapabilityApi {
  list(): Promise<CapabilityInfo[]>;
  available(id: string): Promise<boolean>;
  invoke(id: string, input: unknown): Promise<unknown>;
}

/** 长期记忆条目(查看用 · **不含 embedding**)。 */
export interface MemoryEntry {
  id: string;
  fact: string;
  ts: number;
}

/** 长期记忆的用户掌控(#4):查看 / 清除全部 / 删一条。网页端降级为空。 */
export interface MemoryApi {
  list(): Promise<MemoryEntry[]>;
  clear(): Promise<number>;
  remove(id: string): Promise<void>;
  /** 撤销最近一次清除/单删(后端 trash 还原,向量不出后端)。返回还原条数。 */
  undo(): Promise<number>;
}

/** 一篇文档(列表用 · 不含 embedding / 全文)。 */
export interface DocInfo {
  docId: string;
  name: string;
  chunks: number;
  ts: number;
}

/** RAG-over-docs(#2):加文档(后端切块+嵌入)/ 列出 / 删一篇 / 清空。网页端降级。 */
export interface DocsApi {
  add(name: string, text: string): Promise<{ docId: string; name: string; chunks: number }>;
  list(): Promise<DocInfo[]>;
  remove(docId: string): Promise<number>;
  clear(): Promise<number>;
  /** 撤销最近一次删/清(后端 DocTrash 还原,向量不出后端)。返回还原片段数。 */
  undo(): Promise<number>;
}

/** 一个 MCP server 的状态(列表用)。 */
export interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  enabled: boolean;
  /** 是否已连接(enabled 且握手成功)。 */
  connected: boolean;
  toolCount: number;
  tools: Array<{ name: string; description: string; readOnly: boolean }>;
  /** 连接失败时的错误(否则 null)。 */
  error: string | null;
}

/**
 * MCP 开放扩展(#2 C4):server 管理 + 工具调用确认回传。
 * **server = 用户主动安装的不可信程序**(本机 spawn、非沙箱);模型每次调用 MCP 工具都经 guardrail
 * 确认、结果标 Untrusted。网页端不支持(需 spawn 子进程)→ 列空、其余降级。
 */
export interface McpApi {
  list(): Promise<McpServerInfo[]>;
  /** 添加一个 server(会本机 spawn 程序——调用方须已取得用户知情同意)。 */
  add(name: string, command: string, args: string[]): Promise<void>;
  remove(name: string): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
  /** 连接测试:连一次、列工具、断开。 */
  probe(
    command: string,
    args: string[],
  ): Promise<{ ok: boolean; toolCount: number; tools: Array<{ name: string; description: string; inputSchema: unknown; readOnly: boolean }> }>;
  /** 模型想调用某 MCP 工具时,前端经 guardrail 取得允许/拒绝后回传(唤醒挂起的网关)。 */
  confirmResolve(confirmId: string, approved: boolean): Promise<void>;
}

// ── 顶层 Runtime ────────────────────────────────────────────────

export interface RuntimeApi {
  readonly platform: Platform;
  /** 该端是否支持某能力;false → UI 优雅隐藏入口(不报错)。 */
  available(feature: Feature): boolean;
  readonly db: DbApi;
  readonly profile: ProfileApi;
  readonly ai: AiApi;
  readonly secret: SecretApi;
  readonly capability: CapabilityApi;
  readonly memory: MemoryApi;
  readonly docs: DocsApi;
  readonly mcp: McpApi;
}

// 运行时**值**(createRuntime / rt / NotImplementedError)由 ./index.js 与
// ./errors.js 用 JSDoc 提供并绑定到以上类型;本文件只承载纯类型契约。
