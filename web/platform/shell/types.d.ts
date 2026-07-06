/**
 * 应用壳(shell)契约 · 多应用平台阶段1(docs/proposal-app-platform.md,D1–D7 已拍板)。
 * 小应用以 AppManifest 经 window.SeekerShell.register() 注册;应用间**禁止互相 import**。
 * 阶段1 为「适配器」形态:页面实现仍内联在 index.html,manifest 引用其全局渲染函数;
 * 阶段3 逐页迁入 apps/<appId>/ 后 manifest 形态不变、实现搬家。
 */

/** 双语文案。 */
export interface LString {
  zh: string;
  en: string;
}

/**
 * 页面声明 —— 与单体 PAGES 条目同构(便于零回归适配);字段语义见 index.html 的 buildNav/go。
 */
export interface ShellPage {
  /** 页面 id(DOM 容器 #page-<id>;Mod+1..9 按注册序绑定)。 */
  id: string;
  /** 中文名(L() 的主字段,沿用单体命名)。 */
  label: string;
  /** 英文名。 */
  en: string;
  /** 侧栏 rail 态单字缩写。 */
  abbr: string;
  /** 导航分组 key(须在某 manifest.groups 或壳分组里)。 */
  group: string;
  /** rail 态细线 SVG 图标(合设计语言:stroke 1.5px 圆角端)。 */
  icon: string;
  /** 页首 Mono 眉标(大写;部分页无)。 */
  eyebrow?: string;
  /** 静态徽标文本(无 liveCount 时回退)。 */
  count?: string;
  /** AI 标签(徽标位显示 AI)。 */
  ai?: boolean;
  /** 实时徽标(如 '12/20' / '7 待办');buildNav / syncNavCounts 调用。 */
  liveCount?: () => string;
  /** 页面渲染器:向自己的 #page-<id> 容器灌内容(阶段1 = 单体全局 renderX 的引用)。 */
  render?: () => void;
}

/** 对话卡注册项 —— 与单体 SEEKER_CARDS 条目同构(协议:AI 输出 ```seeker:<kind> JSON 块)。 */
export interface CardSpec {
  /** 校验块 JSON 是否可渲染。 */
  valid: (data: unknown) => boolean;
  /** 渲染卡进气泡宿主(bubble.parentElement)。 */
  show: (bubble: HTMLElement, data: unknown, who: string) => void;
  /** true = 视图卡随消息持久化、重启用实时数据重渲;提案卡省略(重渲会重复提议)。 */
  persist?: boolean;
}

/** 应用贡献的完整设置 tab(插入壳设置页 tab 栏)。 */
export interface SettingsTab {
  /** tab id(不可与壳 tab 重名:basic/profile/model/data/about)。 */
  id: string;
  label: LString;
  /** 渲染本 tab 内容,返回 HTML 字符串。 */
  render: () => string;
  /** 渲染后事件接线(每次 renderSettings 完成 DOM 替换后调用;元素不在当前 tab 时选择器为空、no-op)。 */
  wire?: () => void;
}

/** 应用的设置贡献:新增 tab + 追加进壳既有 tab 尾部的内容(不新增 tab 按钮)。 */
export interface AppSettingsSpec {
  /** 新增 tab(并集顺序插入壳 tab 之间)。 */
  tabs?: SettingsTab[];
  /** tab id → 追加内容(如壳 profile tab 尾部追加主简历资料、data tab 尾部追加"我的简历"行)。 */
  extend?: Record<string, { render: () => string; wire?: () => void }>;
}

/** Agent /命令面板项 —— 与单体 AGENT_CMDS 条目同构。 */
export interface CommandSpec {
  /** /斜杠命令(如 '/match');cmdFilterList 按此 + label + desc 模糊过滤。 */
  cmd: string;
  /** [中,英] 名。 */
  label: [string, string];
  /** [中,英] 说明。 */
  desc: [string, string];
  /** 执行(agentSend 查询 / 导航 / 打开;由应用自持,平台只透传调用)。 */
  run: () => void;
}

/** 小应用 manifest(D1–D7:集合白名单=声明并集;AI 可读三层闸;关=下架 UI+AI、数据保留)。 */
export interface AppManifest {
  /** ^[a-z][a-z0-9]*$(嵌入集合前缀 / 设置键 / 钥匙串不经它)。 */
  id: string;
  name: LString;
  /** 应用图标(细线 SVG;应用管理页用)。 */
  icon: string;
  /** 应用网格一句话简介。 */
  blurb: LString;
  /** 声明拥有的数据集合(D1:既有 5 集合由 jobseek 认领;新应用用 <appId>_ 前缀)。 */
  collections: string[];
  /** AI 可读默认档(三层闸第 2 层;健康类应用 default-off)。 */
  aiReadable: 'default-on' | 'default-off';
  /** 贡献的导航分组(key → 双语组名)。 */
  groups?: Record<string, LString>;
  /** 贡献的页面(注册序即导航序)。 */
  pages: ShellPage[];
  /** 贡献的对话卡(kind → CardSpec)。 */
  cards?: Record<string, CardSpec>;
  /** 意图框定器:命中返回框定后的 AI 输入,未命中返回原文(与单体 frameQuery 同约)。 */
  frameQuery?: (text: string) => string;
  /** 降级 mock 回复器:AI 不可用时的本地应答(命中返回 HTML 串,未命中空串;与单体 copReply 同约)。 */
  appReply?: (text: string) => string;
  /** 开场建议器:AI 面板开场白的建议 chips(命中返回非空字符串数组,未命中空数组;与单体 aiSuggs 同约)。 */
  appSuggs?: () => string[];
  /** /命令面板项:本应用贡献的 Agent 斜杠命令(与单体 AGENT_CMDS 同构);各应用命令在面板里并集同现。 */
  appCommands?: () => CommandSpec[];
  /** 重渲本应用的 Agent chrome 贡献(技能 chips → #agentCmds;随语言/初始化触发)。副作用、无返回。 */
  renderAppChips?: () => void;
  /** 设置页贡献:新增 tab(goals/weights 等)+ 追加进壳既有 tab(profile 尾部主简历资料、data 尾部简历行等)。 */
  settings?: () => AppSettingsSpec;
  /** 应用启动钩子:壳 INIT 末尾(壳装配+首页渲染后)调用,应用做自己的 boot 副作用(如 jobseek 抓演示种子、挂示例提示条)。 */
  init?: () => void;
  /** 「清空全部数据」确认后、reload 前调用:应用清自己的 app-local 状态(如 jobseek 退演示模式);数据集合本身由壳按 collections() 统一清。 */
  onDataCleared?: () => void;
  /** 集合 id 键规则:给无 id 的记录返回天然键(如 skills 用 name);无特殊规则返回 undefined,由通用引擎生成随机 id。 */
  collId?: (name: string, r: any) => string | undefined;
}

/** 壳自持内容(设置页等全局框架;排所有应用页之后)。 */
export interface ShellOwn {
  pages: ShellPage[];
  groups?: Record<string, LString>;
  /** 壳自持集合(如对话历史 messages)。 */
  collections?: string[];
}

/**
 * window.SeekerShell —— 应用注册表 + 装配组合。
 * classic IIFE(同 platform/keys/keys.js 先例):单体 INIT 在解析期同步消费,ES module 时序赶不上。
 */
export interface SeekerShellApi {
  register(manifest: AppManifest): void;
  /** 全部已注册应用(注册序)。 */
  list(): AppManifest[];
  /** 应用是否启用(持久化于 localStorage;缺省启用)。 */
  enabled(appId: string): boolean;
  /** 开 / 关一个应用(持久化 + 通知订阅者;关 = 下架 UI+AI,数据保留)。 */
  setEnabled(appId: string, on: boolean): void;
  /** 全部应用按用户排序(未排序的按注册序垫后)。 */
  ordered(): AppManifest[];
  /** 设置应用显示顺序(持久化 + 通知)。 */
  setOrder(appIds: string[]): void;
  /** D3:某应用当前是否 AI 可读 = 启用 ∩ (用户授权 ?? manifest `aiReadable` 默认)。 */
  isAiReadable(appId: string): boolean;
  /** 设置某应用的 per-app AI 授权(覆盖 manifest 默认;持久化 + 通知)。 */
  setAiGrant(appId: string, on: boolean): void;
  /** D3 三层闸结果:全体「AI 可读」应用的集合并集 —— 推给后端 `set_ai_readable`(能力层强制点)。 */
  aiReadableCollections(): string[];
  /** 订阅开关 / 授权 / 排序变化(装配重跑 + 推 set_ai_readable)。 */
  subscribe(fn: () => void): void;
  setShell(own: ShellOwn): void;
  /** 组合:启用应用的页面 + 壳页面(导航 / 页骨架 / 快捷键消费)。 */
  pages(): ShellPage[];
  /** 组合:启用应用的分组 + 壳分组。 */
  groups(): Record<string, LString>;
  /** 组合:启用应用贡献的卡(streamReply / hydrateMessages 消费)。 */
  cards(): Record<string, CardSpec>;
  /** 框定链:依注册序问各启用应用的 framer,首个改写生效;都未命中返回原文。 */
  frameQuery(text: string): string;
  /** 降级 mock 回复链:AI 不可用时问各启用应用的本地应答器,首个非空生效;都未命中返回空串。 */
  appReply(text: string): string;
  /** 开场建议链:问各启用应用的建议器,首个非空数组生效;都未命中返回空数组。 */
  appSuggs(): string[];
  /** /命令面板项:全部启用应用命令的并集(不同于 framer 首个非空;类比 cards()——命令面板汇总多应用)。 */
  appCommands(): CommandSpec[];
  /** 通知各启用应用重渲其 Agent chrome 贡献(技能 chips);汇总型副作用,全调无返回。 */
  renderAppChips(): void;
  /** 各启用应用的设置贡献(tabs 插入 + extend 追加)。汇总型:并集(同 cards())。 */
  appSettings(): AppSettingsSpec[];
  /** 依次调各启用应用的 init 钩子(壳 INIT 末尾);汇总型副作用,全调无返回(同 renderAppChips)。 */
  initApps(): void;
  /** 「清空全部数据」后通知**全部已注册应用**(含禁用——数据被清是事实,app-local 状态须一致)清自己的本地状态;汇总型副作用。 */
  notifyDataCleared(): void;
  /** 集合 id 键规则:问各启用应用的集合 schema,首个非空生效;都无规则返回 undefined(调用方用默认生成)。 */
  collId(name: string, r: any): string | undefined;
  /** 组合:启用应用 + 壳声明的集合并集(阶段2 AI 三层闸消费)。 */
  collections(): string[];
}
