/**
 * 阶段1 适配器对单体(index.html 内联 classic 脚本)全局的依赖面声明。
 * 仅供 tsc 校验 manifest.js;运行时这些名字由单体在 manifest 之前定义
 * (function 声明挂 window,const/let 是全局词法绑定,classic 间共享)。
 * **这份清单就是阶段3 逐页搬迁的账本** —— 搬一项销一项,清空即适配器可删。
 */

/* 页面渲染器 —— 声明留作 manifest 引用的 tsc 桥(实现无论在单体还是 apps/*.js 都是 classic 全局);
   逻辑模块化(3.y,改真 ES module 导出)后连声明一起清。 */
// 全部 8 页渲染器已搬出 apps/jobseek/(阶段3-a/b/c · @ts-nocheck);声明留作 manifest 引用的 tsc 桥。
declare function renderActions(): void; // → pages/actions.js
declare function renderOverview(): void; // → pages/overview.js
declare function renderJobs(): void; // → pages/jobs.js
declare function renderAnalysis(): void; // → pages/analysis.js
declare function renderSkills(): void; // → pages/skills.js
declare function renderMatch(): void; // → logic/match.js
declare function renderResumes(): void; // → logic/resumes.js
declare function renderInterview(): void; // → logic/interview.js

/* 对话:意图框定 frameQuery(已搬出→logic/frame-query.js · 3-d);卡注册表 SEEKER_CARDS + 卡实现束(已搬出→cards.js · 3-e)。
   声明留作 manifest 引用的 tsc 桥;逻辑模块化(3.y)后连声明一起清。 */
declare function frameQuery(text: string): string; // → logic/frame-query.js
declare function copReply(text: string): string; // → logic/copilot-actions.js(序3-b;manifest appReply 引用桥)
declare function aiSuggs(): string[]; // → logic/copilot-actions.js(序3-b;manifest appSuggs 引用桥)
declare const AGENT_CMDS: import('../../platform/shell/types').CommandSpec[]; // → logic/copilot-actions.js(序3-d-8;manifest appCommands 引用桥)
declare function renderAgentCmds(): void; // → logic/copilot-actions.js(序3-d-8;manifest renderAppChips 引用桥,序3-d-11)
declare const SEEKER_CARDS: Record<string, import('../../platform/shell/types').CardSpec>; // → cards.js

/* 徽标 liveCount 依赖(JOBS/ACTIONS→data.js · 3-f;tt 已抽壳→platform/shell/i18n.js 实际定义、tsc 桥删 · 序1-c;setState 壳全局未抽) */
declare const JOBS: Array<Record<string, unknown>>; // → data.js
declare const ACTIONS: Array<Record<string, any>>; // → data.js
declare const setState: { goal?: number; lang?: string };
