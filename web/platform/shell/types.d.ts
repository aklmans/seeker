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

/** 页级顶栏动作项(renderTopActions 装配成 .btn;原单体 nav 的 {t,a,fn} map 条目)。 */
export interface PageAction {
  /** 按钮文案(已 tt() 双语解析;每次 pageActions() 调用重求值 → 语言切换即时)。 */
  t: string;
  /** 额外 class(如 'btn-accent');省略为默认 .btn。 */
  a?: string;
  /** 点击 handler(应用自持闭包,import 解析;平台只 btn.onclick=fn)。 */
  fn: () => void;
}

/**
 * 应用为某个 widget 破坏性动作声明的 **confirmDestructive 规格**(platform/guardrail 的 opts 子集)。
 *
 * ★红线(§4-3/§4-4):契约只收「规格数据」、**不收「已执行」** —— 破坏性执行一律由平台调 guardrail 的
 * `confirmDestructive`(预览 + 确认 + 可撤销)驱动,应用无法绕过。
 * **故意不含 `source`**:来源由平台按端口归属的 widgetId 生成(不信任 iframe 自报),应用不得声明/覆盖。
 */
export interface WidgetActionSpec {
  title?: string;
  detail?: string;
  confirmLabel?: string;
  /** 结构化「前→后」预览(guardrail 一律 textContent 渲染,不可信内容无法注入)。 */
  changes?: { label?: string; before?: string; after?: string }[];
  /**
   * 用户确认后才执行(必填;registry 以 `typeof onConfirm==='function'` 守卫,缺失则视为未认领)。
   *
   * 返回 **显式 `false` 或 `0`** ⇒ 销毁未发生 / 无可还原之物 ⇒ 平台**不给撤销按钮**;`undefined` ⇒ 视为已执行。
   * (与 `toast.js` 的 `toastUndo` 判据逐字同款:`v !== false && v !== 0`。)
   * ★这**不给应用任何新权力**:应用本来就能通过**不声明 `onUndo`** 让一次销毁无从撤销;`false` 只是把
   *   同一个决定挪到**执行之后**(「有没有可还原之物」往往执行时才知道)。它**不能**让应用绕过确认闸。
   */
  onConfirm: () => void | boolean | number | Promise<void | boolean | number>;
  onUndo?: () => void | Promise<void>;
  undoText?: string;
  undoMs?: number;
}

/** app-tool `render(output)` 的返回:一段应用自建的**可信结构化 HTML**,由平台经三墙沙箱(同 show_widget)投画布。 */
export interface AppToolWidget {
  title?: string;
  /** 应用据已投影的 output 渲染的 HTML(在前端执行,tt() 可用 ⇒ #6 双语债消失)。仍进三墙沙箱隔离渲染。 */
  html: string;
  minHeight?: number;
}

/**
 * 应用声明的一枚 AI 工具(app-tool 契约)。平台据此:向模型暴露 schema、按 `reads` 取数、隔离执行 `compute`、
 * 按 `output` 校验+投影、前端 `render` 呈现。见 docs/proposal-app-tool-contract.md(方案 C)。
 *
 * ★四不变式(平台强制、应用无从旁路):
 *   - **I1 profile 结构不可达** —— `compute` 在三墙隔离上下文(null 起源 iframe + CSP)执行,无 rt / 无 window / 无网络;
 *   - **I2 D3 不旁路** —— 取数由**平台**按 `reads` 走既有 `query_data` 闸,**实际可读 = 静态 QUERYABLE ∩ D3 运行时集 ∩ reads**;
 *   - **I3 收规格不收执行** —— 隔离上下文无 rt ⇒ compute 无法改变任何东西(破坏性 app-tool **结构上不可能**);
 *   - **I4 结果经校验** —— `output` 经 `projectToSchema` 校验+投影(只留声明字段),再 Untrusted 框定后喂回模型。
 */
export interface AppToolSpec {
  /** 全局唯一;**必须 `<appId>_` 前缀**(与集合白名单同纪律,注册期强制)。即给模型看的工具名。 */
  name: string;
  /** 给模型看的一句话「何时用」。**必须应用自持的可信文案**(同 greeting 第50轮裁决;不得含用户/AI/RAG 派生内容)。 */
  description: string;
  /** 给模型看的入参 JSON Schema。 */
  parameters: object;
  /** 本工具要读的集合。**必填**(省略即拒,不给默认可读语义)、**必须 ⊆ manifest.collections**(注册期强制)。 */
  reads: string[];
  /**
   * 纯函数 `(input, rows) => output`。**在三墙隔离上下文里执行**(见 capability/app-tools/sandbox.js):无 rt / window / 网络。
   * ★**须自包含**:不得闭包引用模块作用域符号或 import —— 隔离上下文取不到,运行期 ReferenceError(平台以源码字符串注入沙箱)。
   */
  compute: (input: any, rows: any) => any;
  /** 输出 JSON Schema。平台据此 **`projectToSchema` 校验+投影**(只留声明字段);校验失败 ⇒ 工具调用如实报错,绝不喂模型。 */
  output: object;
  /** 前端渲染器 `(output) => AppToolWidget`。在**前端**执行(tt() 可用),据已投影 output 产 widget 结构投画布。 */
  render: (output: any) => AppToolWidget;
}

/** 小应用 manifest(D1–D7:集合白名单=声明并集;AI 可读三层闸;关=下架 UI+AI,数据保留)。 */
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
  /** 贡献的 AI 工具(app-tool 契约;注册期校验 name 前缀 / reads ⊆ collections / compute·render 函数 / output schema)。 */
  tools?: AppToolSpec[];
  /** 意图框定器:命中返回框定后的 AI 输入,未命中返回原文(与单体 frameQuery 同约)。 */
  frameQuery?: (text: string) => string;
  /** 降级 mock 回复器:AI 不可用时的本地应答(命中返回 HTML 串,未命中空串;与单体 copReply 同约)。 */
  appReply?: (text: string) => string;
  /** 开场建议器:AI 面板开场白的建议 chips(命中返回非空字符串数组,未命中空数组;与单体 aiSuggs 同约)。 */
  appSuggs?: () => string[];
  /** AI 面板开场白文案:按 mode('agent'|'copilot')返回本应用的招呼语(已 tt 双语解析;未命中返回 '')。选择型(首个非空)。
   *  ★契约不变式(§4-4,第50轮[建议]固化):返回值**必须是应用自持的开发者文案**(如 tt 静态串)——
   *  平台经 **innerHTML 无转义**渲染,**绝不得含用户 / AI / RAG / JD 等不可信派生内容**;若需展示动态内容,先 cEsc 转义后再拼入。 */
  greeting?: (mode: 'agent' | 'copilot') => string;
  /** /命令面板项:本应用贡献的 Agent 斜杠命令(与单体 AGENT_CMDS 同构);各应用命令在面板里并集同现。 */
  appCommands?: () => CommandSpec[];
  /** 把本应用的 Agent 快捷 chips **append** 进平台已清空的 #agentCmds(随语言/应用开关/初始化触发)。副作用、无返回。
   *  容器归平台(清空/标签/空则隐藏由平台 renderAgentChips 负责);应用**只 append 自己的按钮**,勿 innerHTML= 清屏。 */
  renderAppChips?: () => void;
  /** 设置页贡献:新增 tab(goals/weights 等)+ 追加进壳既有 tab(profile 尾部主简历资料、data 尾部简历行等)。 */
  settings?: () => AppSettingsSpec;
  /** 应用启动钩子:壳 INIT 末尾(壳装配+首页渲染后)调用,应用做自己的 boot 副作用(如 jobseek 抓演示种子、挂示例提示条)。 */
  init?: () => void;
  /** 「清空全部数据」确认后、reload 前调用:应用清自己的 app-local 状态(如 jobseek 退演示模式);数据集合本身由壳按 collections() 统一清。 */
  onDataCleared?: () => void;
  /** 「导入数据」成功后调用:应用按新落库的数据重水合自己的内存态 + 重渲(如 jobseek 重载 JOBS);与 onDataCleared 对称(存在性广播)。 */
  onDataImported?: () => void;
  /** 集合 id 键规则:给无 id 的记录返回天然键(如 skills 用 name);无特殊规则返回 undefined,由通用引擎生成随机 id。 */
  collId?: (name: string, r: any) => string | undefined;
  /** 页级「新建」动作:平台快捷键(Mod+N)/新建入口按 pageId 问应用的「创建」动作;命中返回无参函数,未命中 undefined(平台兜底 toast)。选择型(同 collId)。 */
  pageNew?: (pageId: string) => (() => void) | undefined;
  /** 页级顶栏动作:按 pageId 返回本应用为该页声明的顶栏按钮(renderTopActions 渲染);未命中返回空数组。汇总型(各应用并集,同 cards)。 */
  pageActions?: (pageId: string) => PageAction[];
  /**
   * widget 破坏性动作认领:按 action 返回本应用的 confirmDestructive 规格;不认领返回 undefined(平台走通用破坏性分支)。选择型(同 pageNew)。
   * `action`/`payload` 来自**不可信 iframe**(§4-4),应用须当纯数据处理;执行由平台的 guardrail 驱动,应用只描述「要做什么/怎么撤销」。
   */
  widgetActions?: (action: string, payload: any) => WidgetActionSpec | undefined;
  /**
   * cAB 处理器登记:`{名 → 处理器}`,供 Copilot 的 `[data-cact]` 文档级委派**按名**调用(args 来自 `data-cargs`,按值传)。汇总型(各应用并集,同 cards)。
   *
   * ★红线(§4-4)—— **注册表即白名单**:委派只能调已登记名,不再 `window[name]`(杜绝把 HTML 注入升级为任意全局函数调用的 gadget)。
   * ⚠ 登记前自检:该处理器的**任一参数**是否会流进 `innerHTML` / `eval` / `Function` / `setTimeout(串)`?
   *   是 → 改无参包装(先例:`agentBackupContinue`)或先转义。**反例:`agentChat(html)` 是不转义的 innerHTML sink,绝不可登记**(第44轮 PoC)。
   */
  cActions?: () => Record<string, (...args: any[]) => void>;
}

/**
 * 平台 Skill(可执行技能 · proposal-skills.md)—— **用户自撰的具名指令**:进命令面板、一点即运行
 * (S2 起 Agent 以 `prompt` 为 instruction 跑一轮)。存平台 `platform_skills` 集合(**不进 QUERYABLE**、永不 AI 可读)。
 *
 * ★信任:`prompt` 是**本地用户自撰指令**(同用户打字)⇒ 可信侧,不走 untrusted 框定。
 *   ⚠ 前提是本地自撰;未来 Skill 分享/导入 = 第三方指令,须届时补「导入=知情审阅」(见 proposal §4)。
 * ★雏形(S1)= prompt-only;绑工具(tools?: app-tool)留完整版。
 */
export interface Skill {
  /** 稳定 id(存储主键)。 */
  id: string;
  /** 命令面板显示名。 */
  name: string;
  /** 一句话说明(可选)。 */
  description?: string;
  /** 用户自撰的指令正文(S2 运行时作为 instruction)。 */
  prompt: string;
  /** 更新时间戳(排序用)。 */
  updated_at?: number;
  /**
   * ★Skills F1(工具 scoping · 最小权限):运行本 Skill 时可用的 app-tool 名列表(减权,结果恒 ⊆ 用户可读集)。**三态**:
   *   - **`undefined`(未声明)** = 全部可读 app-tool(雏形零回归,等同用户打字重放的全工具语义);
   *   - **`[]`(声明了但空)= 无 app-tool** —— 注意**非「无工具」**:平台 Rust 能力(query_data / memory / show_widget / doc)
   *     不在本列表、恒在 ai_chat、各由自身红线闸把守,不受 scoping 影响;
   *   - **`['x']`** = 仅 `x`(∩ 可读;声明外的 app-tool 结构性够不到)。
   */
  tools?: string[];
  /**
   * ★I1 导入来源标志(untrusted-until-reviewed · proposal-skills-import)。缺失 = 本地自撰(可信,零回归)。
   * **载重不变式(第92轮 [建议]-强)**:导入路径**由平台强制置 true、永不取自粘贴数据**(importSkillWire 白名单
   * 只提取 name/description/prompt/tools;恶意 JSON 带 reviewed:true / 省略 imported 均不可绕审阅门)。
   * 归一化 fail-closed:truthy 即视为导入(垃圾值往不可信侧靠);编辑不洗白溯源(imported 恒承原值)。
   */
  imported?: boolean;
  /**
   * ★用户已审阅背书(仅对 imported 有意义)。归一化须**显式 true** 才算背书(缺失/垃圾 → false = 待审,fail-closed)。
   * 背书绑**特定 prompt**:prompt 变更 ⇒ 失效重审(第92轮 [建议]2)。`imported && !reviewed` ⇒ **双点拒运行**
   * (runSkill fail-closed 守卫 + 命令面板完全不列);审阅门显式认可是唯一置 true 的通路(信任转移点)。
   */
  reviewed?: boolean;
}

/**
 * 平台 Scheduled task(定时跑 Skill · proposal-scheduled-tasks SC1)—— 到点 fire = 用户预先发起的
 * 「运行」重放(经 runSkill,四红线 + scoping + needsReview 全继承;破坏性只能提议等用户确认,无预授权)。
 *
 * ★★红线(第95轮 [建议]-强):**永不注册任何可写 `platform_schedules` 的 capability / app-tool** ——
 * Agent 能给自己排任务 = 自我持续执行通路(自激励循环 + BYO 成本)。本红线是「结构性缺席」,
 * 加此类工具即拆除;有形锚 = capability.rs 守卫测试 + schedule-model.js/本注释。
 * 调度 CRUD 只在能力中心管理面(§4-2);`platform_schedules` 永不进 QUERYABLE。
 */
export interface Schedule {
  /** 稳定 id(存储主键)。 */
  id: string;
  /** 要跑的 Skill id(fire 时按 id 查 skill-store;悬空 → no-op + last_status:'skill-missing' 如实记)。 */
  skillId: string;
  /** 排点类型:每天 / 每周。 */
  kind: 'daily' | 'weekly';
  /** 排点时间 'HH:MM'(本地时区;无效 → 该调度永不 due,fail-safe 不误跑)。 */
  time: string;
  /** kind='weekly' 时的星期(0=周日…6=周六)。 */
  dow?: number;
  /** 是否启用。归一化须**显式 true**(垃圾值 → 不跑:无人值守存疑往「不跑」侧靠)。 */
  enabled: boolean;
  /** 创建时刻 —— due 水位含它 ⇒ **新建不立即开火**(不把创建前的今日排点算成欠账)。 */
  created_at?: number;
  /** 上次 fire 时刻(水位;fire 后越过全部积压排点 = 错过不补跑)。 */
  last_run_at?: number;
  /** 上次结果(SC2 语义):'started'=已发起(settle 后改判;app 中途退/mock 不回 settle 停此=诚实结局未知)
   *  | 'ok'=流正常收 | 'error'=流失败(短讯在 last_error)| 'skill-missing'(悬空)| 'skill-blocked'(草稿/待审)。 */
  last_status?: string;
  /** 上次 fire 时被越过的排点数(错过不补跑,UI 如实提示;fire 时由 occurrencesSinceWatermark-1 算好存下)。 */
  last_missed?: number;
  /** settle 失败短讯(≤200 字;'ok' settle 清空)。 */
  last_error?: string;
}

/**
 * 平台 Project(目标工作区 · proposal-project)—— 对话按项目分组 + 项目内定制指令(PJ3 注入)+
 * 上下文隔离(PJ2 historyKey)。
 *
 * ★★红线(第98轮 · 与「AI 不能给自己排任务」同族):**永不注册任何可写 `platform_projects` 的
 * capability / app-tool** —— Agent 能创建/切换/改写项目 = 自改「每轮注入的指令」= **自我提示注入
 * 通路**(自我改写行为基线)。缺席钉死:capability.rs 守卫 + registry caps.len 断言(写半承重)+
 * project-model.js/本注释。项目 CRUD 只在能力中心管理面;`platform_projects` 永不进 QUERYABLE
 * (当前项目指令经注入到达模型是功能;query_data 枚举所有项目 = 跨项目泄漏,违背隔离承诺)。
 *
 * ★`instructions` = 用户在管理面自撰 = 可信(同 Skill prompt);**永不含模型/RAG/外部派生内容**
 * (PJ3 注入位 = system 邻位高权位,同 greeting 第50轮纪律);分享/导入须 I1 同款 untrusted-until-reviewed。
 */
export interface Project {
  /** 稳定 id(存储主键;'' 保留给默认工作区语义,不作为记录 id)。 */
  id: string;
  /** 项目名(切换器/管理面显示;进 DOM 一律 cEsc)。 */
  name: string;
  /** 项目定制指令(PJ3 每轮注入一次、不入 history;用户自撰可信,见上)。 */
  instructions?: string;
  /** 归档(不出现在切换器;消息数据保留、可还原 —— MVP 不提供删除,§5.4 预裁)。归一化须显式 true。 */
  archived?: boolean;
  /** 创建时刻。 */
  created_at?: number;
  /** 更新时刻(排序用)。 */
  updated_at?: number;
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
  /** 组合:全部启用应用声明的 app-tool 并集(同 appCommands()——多应用汇总)。D3「上架」可读性过滤由消费方(工具循环接线)按运行时可读集施加。 */
  appTools(): AppToolSpec[];
  /** 框定链:依注册序问各启用应用的 framer,首个改写生效;都未命中返回原文。 */
  frameQuery(text: string): string;
  /** 降级 mock 回复链:AI 不可用时问各启用应用的本地应答器,首个非空生效;都未命中返回空串。 */
  appReply(text: string): string;
  /** 开场建议链:问各启用应用的建议器,首个非空数组生效;都未命中返回空数组。 */
  appSuggs(): string[];
  /** 开场白链:依注册序问各启用应用的 greeting(mode),首个非空生效;都未命中返回 ''(调用方回退中性平台招呼语)。
   *  ★经 innerHTML 无转义渲染 → 契约要求应用返回**自持可信开发者文案**、不得含用户/AI 派生内容(见 AppManifest.greeting)。 */
  greeting(mode: 'agent' | 'copilot'): string;
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
  /** 「导入数据」成功后通知**全部已注册应用**(含禁用——数据被导入是事实)按新库重水合内存态 + 重渲;汇总型副作用(与 notifyDataCleared 对称)。 */
  notifyDataImported(): void;
  /** 集合 id 键规则:问各启用应用的集合 schema,首个非空生效;都无规则返回 undefined(调用方用默认生成)。 */
  collId(name: string, r: any): string | undefined;
  /** 页级「新建」动作链:依注册序问各启用应用的 pageNew,首个返回函数生效;都未命中返回 undefined(调用方兜底 toast)。 */
  pageNew(pageId: string): (() => void) | undefined;
  /** 页级顶栏动作:全部启用应用为该页声明的动作并集(renderTopActions 消费;每页通常归一应用,同 cards 并集语义)。 */
  pageActions(pageId: string): PageAction[];
  /** widget 破坏性动作规格:依注册序问各启用应用,首个认领该 action 者生效;都未认领返回 undefined(平台走通用破坏性分支)。
   *  平台拿到规格后**自己**调 guardrail.confirmDestructive 并强制注入 `source`(widgetId)——应用既不执行、也不能伪造来源。 */
  widgetActions(action: string, payload: any): WidgetActionSpec | undefined;
  /** cAB 处理器注册表:全部启用应用登记的 `{名 → 处理器}` **并集**(Copilot `[data-cact]` 委派消费;每次点击重取 ⇒ 应用开关即时生效)。
   *  返回 **null 原型**对象 ⇒ `toString`/`constructor`/`valueOf` 等原型链成员**不可达**,委派不会误调。 */
  cActions(): Record<string, (...args: any[]) => void>;
  /** **全部已注册应用**(含禁用)+ 壳声明的集合并集 —— 存在性口径,供「清空全部数据」等须完整枚举的破坏性操作消费。
   *  **非 AI 可读、勿接进 D3**:AI 可读集是独立的 aiReadableCollections()(启用 ∩ 授权,三层闸)。(阶段4-0 语义修 + 第23轮[建议]注释校正) */
  collections(): string[];
}
