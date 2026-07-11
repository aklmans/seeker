// @ts-check
/**
 * 应用壳注册表(多应用平台)。契约见 ./types.d.ts(SeekerShellApi)。
 * classic IIFE(同 platform/keys/keys.js 先例):单体 INIT 在解析期同步消费,
 * ES module(隐式 defer)时序赶不上,故与消费方同为 classic、head 内先于内联脚本定义。
 * 注册表 DOM-free:只做组合与偏好状态;渲染由消费方执行。
 *
 * 阶段2:enabled / order / per-app AI 授权持久化到 localStorage('seeker-apps',与主题/语言同机制);
 * 组合函数按**启用集 + 顺序**过滤;**D3 三层闸**(启用 ∩ manifest aiReadable ∩ 用户授权)在 `aiReadableCollections()`
 * 算出可读集合,由消费方推给后端 `set_ai_readable`(能力层强制点)。开关变化经 `subscribe` 通知装配。
 */
(function () {
  'use strict';
  /** @typedef {import('./types').AppManifest} AppManifest */
  /** @typedef {import('./types').ShellPage} ShellPage */
  /** @typedef {import('./types').ShellOwn} ShellOwn */
  /** @typedef {import('./types').LString} LString */
  /** @typedef {import('./types').CardSpec} CardSpec */
  /** @typedef {import('./types').CommandSpec} CommandSpec */
  /** @typedef {import('./types').AppSettingsSpec} AppSettingsSpec */
  /** @typedef {import('./types').AppToolSpec} AppToolSpec */

  const LS_KEY = 'seeker-apps';
  /** @type {AppManifest[]} 注册序 */
  const apps = [];
  /** @type {ShellOwn} */
  let shellOwn = { pages: [], groups: {}, collections: [] };
  /** @type {Array<() => void>} 开关/授权/排序变化订阅者(装配 + set_ai_readable 推送) */
  const listeners = [];

  /** @typedef {{enabled:Record<string,boolean>, order:string[], aiGrant:Record<string,boolean>}} Prefs */
  /** @returns {Prefs} */
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw) || {};
        return {
          enabled: p.enabled && typeof p.enabled === 'object' ? p.enabled : {},
          order: Array.isArray(p.order) ? p.order : [],
          aiGrant: p.aiGrant && typeof p.aiGrant === 'object' ? p.aiGrant : {},
        };
      }
    } catch (_e) {
      /* 损坏 → 默认 */
    }
    return { enabled: {}, order: [], aiGrant: {} };
  }
  /** @type {Prefs} */
  let prefs = loadPrefs();

  function persist() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(prefs));
    } catch (_e) {
      /* 隐私模式 / 配额:偏好丢失不致命 */
    }
  }
  function emit() {
    listeners.forEach((fn) => {
      try {
        fn();
      } catch (e) {
        console.error('[shell] listener', e);
      }
    });
  }

  /** @param {AppManifest} m */
  function register(m) {
    if (!m || typeof m.id !== 'string' || !/^[a-z][a-z0-9]*$/.test(m.id)) {
      throw new Error('AppManifest.id 非法:' + (m && m.id));
    }
    if (apps.some((a) => a.id === m.id)) throw new Error('应用重复注册:' + m.id);
    if (!Array.isArray(m.pages)) throw new Error('AppManifest.pages 必须是数组:' + m.id);
    // 页面分组须由本 manifest 自声明(buildNav 按组名查表,缺组渲染期会抛)——注册期即拒。
    m.pages.forEach((p) => {
      if (!p || !p.group || !(m.groups && m.groups[p.group])) {
        throw new Error('页面分组未声明:' + m.id + '.' + (p && p.id) + ' → group "' + (p && p.group) + '"');
      }
    });
    validateTools(m);
    apps.push(m);
  }

  /**
   * app-tool 注册期校验(契约 = 平台强制,不靠作者记得写对;同 reads 必填/undefined→拒 的 default-deny 纪律)。
   * name 前缀 / reads 必填且 ⊆ collections / compute·render 函数 / parameters·output schema —— 任一违反即拒注册。
   * @param {AppManifest} m
   */
  function validateTools(m) {
    if (m.tools === undefined) return;
    if (!Array.isArray(m.tools)) throw new Error('AppManifest.tools 必须是数组:' + m.id);
    const prefix = m.id + '_';
    const cols = new Set(m.collections || []);
    const seen = new Set();
    m.tools.forEach((t) => {
      if (!t || typeof t.name !== 'string' || !t.name.startsWith(prefix)) {
        throw new Error('app-tool.name 必须以 "' + prefix + '" 前缀:' + m.id + ' → ' + (t && t.name));
      }
      if (seen.has(t.name)) throw new Error('app-tool.name 应用内重复:' + t.name);
      seen.add(t.name);
      if (typeof t.description !== 'string' || !t.description.trim()) {
        throw new Error('app-tool.description 必填(应用自持可信文案):' + t.name);
      }
      if (!t.parameters || typeof t.parameters !== 'object') {
        throw new Error('app-tool.parameters 必须是 JSON Schema 对象:' + t.name);
      }
      // reads 必填(省略即拒,不给默认可读语义)且 ⊆ manifest.collections(运行时再 ∩ 静态 QUERYABLE ∩ D3)。
      if (!Array.isArray(t.reads)) {
        throw new Error('app-tool.reads 必填(数组;省略即拒):' + t.name);
      }
      const stray = t.reads.filter((c) => !cols.has(c));
      if (stray.length) {
        throw new Error('app-tool.reads 必须 ⊆ manifest.collections:' + t.name + ' 越界 ' + stray.join(','));
      }
      if (typeof t.compute !== 'function') {
        throw new Error('app-tool.compute 必须是函数 (input,rows)=>output:' + t.name);
      }
      // output 必填(缺失 ⇒ I4 无从校验/投影 ⇒ 拒;同 sandbox.runComputeSandbox 的 fail-closed)。
      if (!t.output || typeof t.output !== 'object') {
        throw new Error('app-tool.output 必须是 JSON Schema 对象:' + t.name);
      }
      if (typeof t.render !== 'function') {
        throw new Error('app-tool.render 必须是函数 (output)=>widget:' + t.name);
      }
    });
  }

  function list() {
    return apps.slice();
  }

  // ── 开关 / 排序 / AI 授权(持久化 + 通知)──────────────────────

  /** 缺省启用(prefs 里无记录 = 开)。 @param {string} id */
  function enabled(id) {
    return prefs.enabled[id] !== false;
  }
  /** @param {string} id @param {boolean} on */
  function setEnabled(id, on) {
    prefs.enabled[id] = !!on;
    persist();
    emit();
  }

  /** @param {string} id */
  function orderIndex(id) {
    const i = prefs.order.indexOf(id);
    return i < 0 ? 1e9 : i;
  }
  /** @returns {AppManifest[]} 按用户排序(未排序的按注册序垫后) */
  function ordered() {
    return apps.slice().sort((a, b) => orderIndex(a.id) - orderIndex(b.id) || apps.indexOf(a) - apps.indexOf(b));
  }
  /** @param {string[]} ids */
  function setOrder(ids) {
    prefs.order = ids.slice();
    persist();
    emit();
  }

  function enabledApps() {
    return ordered().filter((a) => enabled(a.id));
  }

  // ── D3 三层闸:AI 可读判定 + 可读集合(能力层强制点的前端算子)────
  //
  // 应用是否 AI 可读 = 启用 ∩ (用户 per-app 授权 ?? manifest aiReadable 默认)。
  // aiReadableCollections() = 全体「AI 可读」应用的 collections 并集 → 消费方推给后端 set_ai_readable。
  // 关应用 / 撤授权 → 其集合即刻退出可读集(后端下一次 query 就拒)。

  /** @param {string} id */
  function isAiReadable(id) {
    const a = apps.find((x) => x.id === id);
    if (!a || !enabled(id)) return false;
    const g = prefs.aiGrant[id];
    return typeof g === 'boolean' ? g : a.aiReadable === 'default-on';
  }
  /** @param {string} id @param {boolean} on */
  function setAiGrant(id, on) {
    prefs.aiGrant[id] = !!on;
    persist();
    emit();
  }
  /** @returns {string[]} */
  function aiReadableCollections() {
    /** @type {Set<string>} */
    const out = new Set();
    apps.forEach((a) => {
      if (isAiReadable(a.id)) (a.collections || []).forEach((c) => out.add(c));
    });
    return [...out];
  }

  /** @param {() => void} fn 开关/授权/排序变化时触发(重装配 + 推 set_ai_readable) */
  function subscribe(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  // ── 壳自持 + 组合(消费方按启用集取用)─────────────────────────

  /** @param {ShellOwn} own */
  function setShell(own) {
    const pages = (own.pages || []).slice();
    const groups = own.groups || {};
    pages.forEach((p) => {
      if (!p || !p.group || !groups[p.group]) {
        throw new Error('壳页面分组未声明:' + (p && p.id) + ' → group "' + (p && p.group) + '"');
      }
    });
    shellOwn = { pages, groups, collections: (own.collections || []).slice() };
  }

  /** @returns {ShellPage[]} 启用应用页(按序) + 壳页 */
  function pages() {
    return enabledApps()
      .flatMap((a) => a.pages)
      .concat(shellOwn.pages);
  }

  /** @returns {Record<string, LString>} */
  function groups() {
    /** @type {Record<string, LString>} */
    const out = {};
    enabledApps().forEach((a) => Object.assign(out, a.groups || {}));
    Object.assign(out, shellOwn.groups || {});
    return out;
  }

  /** @returns {Record<string, CardSpec>} 仅启用应用贡献的卡 */
  function cards() {
    /** @type {Record<string, CardSpec>} */
    const out = {};
    enabledApps().forEach((a) => Object.assign(out, a.cards || {}));
    return out;
  }

  /** @returns {AppToolSpec[]} 全部启用应用声明的 app-tool 并集(同 appCommands)。
   *  ★仅问启用应用(关应用 = 工具即刻下架);D3「上架」可读性过滤(reads ∩ 运行时可读集)由消费方(工具循环接线 T2b)施加。 */
  function appTools() {
    /** @type {AppToolSpec[]} */
    const out = [];
    enabledApps().forEach((a) => {
      if (Array.isArray(a.tools)) out.push(...a.tools);
    });
    return out;
  }

  /** 框定链:首个改写生效(未命中原样返回)。仅问启用应用。 @param {string} text */
  function frameQuery(text) {
    for (const a of enabledApps()) {
      if (typeof a.frameQuery === 'function') {
        const r = a.frameQuery(text);
        if (typeof r === 'string' && r !== text) return r;
      }
    }
    return text;
  }

  /** 降级 mock 回复链:AI 不可用时首个应用的本地应答生效(无则空串)。仅问启用应用。 @param {string} text */
  function appReply(text) {
    for (const a of enabledApps()) {
      if (typeof a.appReply === 'function') {
        const r = a.appReply(text);
        if (typeof r === 'string' && r) return r;
      }
    }
    return '';
  }

  /** 开场建议链:AI 面板开场白的建议 chips —— 首个非空数组生效(无则空数组,cSuggs 安全)。仅问启用应用。 @returns {string[]} */
  function appSuggs() {
    for (const a of enabledApps()) {
      if (typeof a.appSuggs === 'function') {
        const r = a.appSuggs();
        if (Array.isArray(r) && r.length) return r;
      }
    }
    return [];
  }

  /** 开场白链:AI 面板招呼语 —— 依注册序问启用应用的 greeting(mode),首个非空字符串生效,否则 ''(调用方回退中性平台招呼语)。选择型(同 appReply)。
   *  §1 文案归属(第14轮账):copilot-chrome 的 agentGreet/copInit 原硬编码 jobseek 味开场白,改经此契约取。 @param {'agent'|'copilot'} mode @returns {string} */
  function greeting(mode) {
    for (const a of enabledApps()) {
      if (typeof a.greeting === 'function') {
        const r = a.greeting(mode);
        if (typeof r === 'string' && r) return r;
      }
    }
    return '';
  }

  /** /命令面板项:全部启用应用命令的**并集**(不同于 framer 的首个非空;类比 cards()——多应用命令同现一个面板)。 @returns {CommandSpec[]} */
  function appCommands() {
    /** @type {CommandSpec[]} */
    const out = [];
    enabledApps().forEach((a) => {
      if (typeof a.appCommands === 'function') {
        const cs = a.appCommands();
        if (Array.isArray(cs)) out.push(...cs);
      }
    });
    return out;
  }

  /** 应用 chrome 渲染触发:通知各启用应用重渲其 Agent chrome 贡献(如技能 chips → #agentCmds)。
   *  汇总型副作用——全调、无返回(chrome 扩展点;平台不硬编码 app 渲染器符号名,替代 typeof 守卫直调)。 */
  function renderAppChips() {
    enabledApps().forEach((a) => {
      if (typeof a.renderAppChips === 'function') a.renderAppChips();
    });
  }

  /** 应用启动钩子:壳 INIT 末尾依次调各启用应用的 init(应用自己的 boot 副作用)。汇总型副作用——全调、无返回(同 renderAppChips)。 */
  function initApps() {
    enabledApps().forEach((a) => {
      if (typeof a.init === 'function') a.init();
    });
  }

  /** 「清空全部数据」后通知应用清 app-local 状态(如 jobseek 退演示模式)。汇总型副作用。
   *  遍历**全部已注册应用**(含禁用)——与 collections() 存在性口径一致:禁用应用的数据同被清,其本地状态须一致复位。 */
  function notifyDataCleared() {
    apps.forEach((a) => {
      if (typeof a.onDataCleared === 'function') {
        try { a.onDataCleared(); } catch (e) { console.error('[shell] onDataCleared', a.id, e); }
      }
    });
  }

  /** 「导入数据」成功后通知**全部已注册应用**(含禁用——数据被导入是事实)重水合内存态 + 重渲。汇总型副作用(与 notifyDataCleared 对称)。
   *  §1 契约化(批11B 末件):settings.js 原导入后硬编码 `hydrateJobs()`(jobseek 符号),改经此广播。 */
  function notifyDataImported() {
    apps.forEach((a) => {
      if (typeof a.onDataImported === 'function') {
        try { a.onDataImported(); } catch (e) { console.error('[shell] onDataImported', a.id, e); }
      }
    });
  }

  /** 各启用应用的设置贡献(新增 tab + 追加进壳既有 tab)。汇总型:并集(同 cards())。 @returns {AppSettingsSpec[]} */
  function appSettings() {
    /** @type {AppSettingsSpec[]} */
    const out = [];
    enabledApps().forEach((a) => {
      if (typeof a.settings === 'function') {
        const s = a.settings();
        if (s) out.push(s);
      }
    });
    return out;
  }

  /** 集合 id 键规则:问启用应用(应用自持集合 schema);首个非空生效,否则 undefined(调用方用默认生成)。 @param {string} name @param {any} r */
  function collId(name, r) {
    for (const a of enabledApps()) {
      if (typeof a.collId === 'function') {
        const id = a.collId(name, r);
        if (id != null) return id;
      }
    }
    return undefined;
  }

  /** 页级「新建」动作:依注册序问启用应用的 pageNew,首个返回函数者生效,否则 undefined(调用方兜底 toast)。选择型(同 collId)。
   *  §1 契约化(批11B):平台快捷键 contextNew 原硬编码 jobseek openNewJob/openNewAction,改经此契约声明 per-page「新建」。 @param {string} pageId @returns {(() => void) | undefined} */
  function pageNew(pageId) {
    for (const a of enabledApps()) {
      if (typeof a.pageNew === 'function') {
        const fn = a.pageNew(pageId);
        if (typeof fn === 'function') return fn;
      }
    }
    return undefined;
  }

  /** cAB 处理器注册表:全部启用应用登记的 `{名 → 处理器}` **并集**(同 cards 的并集语义)。
   *  §1 契约化(批11B):CACT_ALLOWED 里的 jobseek 名原由平台硬编码,改为各应用 manifest 声明。
   *  ★红线(§4-4)——**注册表即白名单**:委派只能调已登记名、不再 `window[name]`
   *  (杜绝把 HTML 注入升级为任意全局函数调用的 gadget;并免疫 DOM 具名访问遮蔽 —— `id="copMatch"` 的元素再也无法顶替处理器)。
   *  防原型污染面:累加器用 **`Object.create(null)`**,且只收 own-enumerable、**值为 function** 的键
   *  ⇒ `data-cact="toString"` / `"constructor"` / `"valueOf"` 一律取不到东西。
   *  ⚠ 应用登记处理器前自检:其任一参数是否会流进 innerHTML / eval / Function / setTimeout(串)?是 → 改无参包装或先转义。
   *  @returns {Record<string, (...a: any[]) => void>} */
  function cActions() {
    /** @type {any} */
    const out = Object.create(null);
    enabledApps().forEach((a) => {
      if (typeof a.cActions === 'function') {
        const m = a.cActions();
        if (m && typeof m === 'object') {
          Object.keys(m).forEach((k) => {
            if (typeof m[k] === 'function') out[k] = m[k];
          });
        }
      }
    });
    return out;
  }

  /** widget 破坏性动作规格:依注册序问启用应用,首个认领该 action 者生效,否则 undefined(平台走通用破坏性分支)。选择型(同 pageNew)。
   *  §1 契约化(批11B):平台 wgtAction 原硬编码 jobseek delete-job 分支(JOBS/renderJobs/renderOverview),改经此契约声明。
   *  ★红线(§4-3/§4-4):只收**规格数据**不收「已执行」——破坏性执行一律由平台调 guardrail.confirmDestructive 驱动;
   *  `source` 由平台按端口归属的 widgetId 注入(应用不得声明/覆盖);action/payload 来自不可信 iframe,应用当数据处理。
   *  `typeof spec.onConfirm==='function'` 守卫:缺执行体的规格视为未认领(fail-safe → 落通用分支,仍过护栏)。
   *  @param {string} action @param {any} payload @returns {import('./types').WidgetActionSpec | undefined} */
  function widgetActions(action, payload) {
    for (const a of enabledApps()) {
      if (typeof a.widgetActions === 'function') {
        const spec = a.widgetActions(action, payload);
        if (spec && typeof spec.onConfirm === 'function') return spec;
      }
    }
    return undefined;
  }

  /** 页级顶栏动作:全部启用应用为 pageId 声明的动作**并集**(每页通常归一应用;同 cards/appCommands 并集语义)。
   *  §1 契约化(批11B):平台 nav.renderTopActions 原硬编码 jobseek 顶栏动作 map(openResumeModal/resumeGenerate/openMarketValue…),改经此契约取。 @param {string} pageId @returns {import('./types').PageAction[]} */
  function pageActions(pageId) {
    /** @type {import('./types').PageAction[]} */
    const out = [];
    enabledApps().forEach((a) => {
      if (typeof a.pageActions === 'function') {
        const list = a.pageActions(pageId);
        if (Array.isArray(list)) out.push(...list);
      }
    });
    return out;
  }

  /** @returns {string[]} **全部已注册应用**(含禁用)+ 壳声明的集合并集 —— 存在性口径(数据归属不随开关变),
   *  供「清空全部数据」等**必须完整枚举**的破坏性操作消费(§4-3:漏集合=清不干净=破坏可撤销完整性;
   *  D2 关=数据保留,由应用管理页 per-app 清数据独立承担)。非 AI 可读——后者见 aiReadableCollections(启用∩授权)。
   *  阶段4-0 修:原实现按 enabledApps() 过滤与本文档"存在性"矛盾(当时无消费者);首个消费者落地时校正。 */
  function collections() {
    const out = new Set(shellOwn.collections || []);
    apps.forEach((a) => (a.collections || []).forEach((c) => out.add(c)));
    return [...out];
  }

  /** @type {import('./types').SeekerShellApi} */
  const api = {
    register,
    list,
    enabled,
    setEnabled,
    ordered,
    setOrder,
    isAiReadable,
    setAiGrant,
    aiReadableCollections,
    subscribe,
    setShell,
    pages,
    groups,
    cards,
    appTools,
    frameQuery,
    appReply,
    appSuggs,
    greeting,
    appCommands,
    renderAppChips,
    appSettings,
    initApps,
    notifyDataCleared,
    notifyDataImported,
    collId,
    pageNew,
    pageActions,
    widgetActions,
    cActions,
    collections,
  };
  /** @type {any} */ (window).SeekerShell = api;
})();
