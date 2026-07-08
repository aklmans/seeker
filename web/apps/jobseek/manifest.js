// @ts-check
/**
 * jobseek(求职工作台)· manifest = 本应用的 import 枢纽(批10b,同批7 assets Option B)。
 * 页面/卡片/框定/设置段/演示钩子全部经 import 直取(不再依赖 window ambient)——
 * 阶段1 适配器时代的搬迁账本 ./monolith-globals.d.ts 随本刀**整删**(26 条随 flip 销、setState 由 i18n.js 同批 flip 销)。
 * 跨层仅 window.SeekerShell 契约保持全局;tt/setState 为 apps→platform 方向 import(§1 允许)。
 * 加载时机:type=module、置于壳 BOOT 之前;SEEKER_CARDS 等 eager 读由 import 图自定序(强于 tag-order)。
 */
import { renderOverview } from './pages/overview.js';
import { renderJobs } from './pages/jobs.js';
import { renderAnalysis } from './pages/analysis.js';
import { renderSkills } from './pages/skills.js';
import { renderActions } from './pages/actions.js';
import { renderMatch } from './logic/match.js';
import { renderResumes, resumeGenerate, resumeState } from './logic/resumes.js';
import { renderInterview } from './logic/interview.js';
import { frameQuery } from './logic/frame-query.js';
import { copReply, aiSuggs, AGENT_CMDS, renderAgentCmds } from './logic/copilot-actions.js';
import { SEEKER_CARDS } from './cards.js';
import { goalsSectionHTML, wireGoalsSection, weightsSectionHTML, wireWeightsSection, wireMasterSection, dataResumeRowHTML, wireDataResumeRow } from './logic/settings-jobseek.js';
import { masterSectionHTML, openNewAction } from './logic/intake-action.js';
import { openNewJob } from './logic/intake-job.js';
import { openResumeModal } from './logic/resume-modals.js';
import { openMarketValue } from './logic/job-actions.js';
import { captureSeed, syncDemoBanner, setDemoMode } from './logic/demo-seed.js';
import { JOBS, ACTIONS } from './data.js';
import { tt } from '../../platform/shell/i18n.js';
import { go } from '../../platform/shell/nav.js';
import { toast } from '../../platform/shell/toast.js';
import { setState } from '../../platform/shell/shell-state.js';

(function () {
  'use strict';
  // rail 态导航图标(自单体 NAV_ICONS 原文迁入;细线 1.5px 圆角端,active 自动取暖橙)。
  const ICONS = {
    overview:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.2"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.2"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.2"/></svg>',
    match:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/><path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5"/></svg>',
    resumes:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5L14 3z"/><path d="M14 3v4.5h4.5"/><path d="M9 13h6M9 16.5h4"/></svg>',
    jobs:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12.5" rx="1.5"/><path d="M8 7.5V6A2 2 0 0 1 10 4h4a2 2 0 0 1 2 2v1.5"/><path d="M3 12.5h18"/></svg>',
    analysis:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 20.5h17"/><path d="M7 20.5v-6.5"/><path d="M12 20.5V7"/><path d="M17 20.5v-4"/></svg>',
    skills:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.4 7 21l5-2.7L17 21l-1.5-7.6"/></svg>',
    actions:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M4 6l1.3 1.3L7.5 5"/><path d="M4 11.7l1.3 1.3L7.5 10.7"/><path d="M4 17.3l1.3 1.3L7.5 16.3"/></svg>',
    interview:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 15.5a2 2 0 0 1-2 2H8l-4 3.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M8.5 9.5h7M8.5 13h4"/></svg>',
  };

  /** @type {import('../../platform/shell/types').SeekerShellApi} */
  const shell = /** @type {any} */ (window).SeekerShell;

  shell.register({
    id: 'jobseek',
    name: { zh: '求职工作台', en: 'Job Search' },
    icon: ICONS.jobs,
    blurb: {
      zh: '研究岗位、智能匹配、定制简历与面试准备的一体工作台',
      en: 'Research jobs, match smartly, tailor resumes, prep interviews',
    },
    // D1:既有集合由 jobseek 认领(messages 归对话 chrome=壳,见 BOOT 的 setShell)。
    collections: ['jobs', 'skills', 'actions', 'resumes', 'iv_records'],
    aiReadable: 'default-on',
    groups: {
      core: { zh: '核心', en: 'CORE' },
      research: { zh: '研究', en: 'RESEARCH' },
      growth: { zh: '成长', en: 'GROWTH' },
    },
    // 条目字段与原单体 PAGES 逐字一致(仅加 icon/render/liveCount);顺序即导航序。
    pages: [
      { id: 'overview', label: '总览', en: 'Overview', abbr: '总', eyebrow: 'OVERVIEW', group: 'core', icon: ICONS.overview, render: () => renderOverview() },
      { id: 'match', label: '智能匹配', en: 'Smart Match', abbr: '匹', eyebrow: 'SMART MATCH', group: 'core', ai: true, icon: ICONS.match, render: () => renderMatch() },
      { id: 'resumes', label: '我的简历', en: 'Resume', abbr: '历', eyebrow: 'RESUMES', group: 'core', ai: true, icon: ICONS.resumes, render: () => renderResumes() },
      { id: 'jobs', label: '目标岗位', en: 'Jobs', abbr: '岗', count: '12/20', group: 'research', icon: ICONS.jobs, liveCount: () => `${JOBS.length}/${setState.goal || 20}`, render: () => renderJobs() },
      { id: 'analysis', label: '岗位分析', en: 'Analysis', abbr: '析', group: 'research', icon: ICONS.analysis, render: () => renderAnalysis() },
      { id: 'skills', label: '职业资产', en: 'Assets', abbr: '产', group: 'growth', icon: ICONS.skills, render: () => renderSkills() },
      { id: 'actions', label: '行动清单', en: 'Actions', abbr: '动', count: '5 待办', group: 'growth', icon: ICONS.actions, liveCount: () => `${ACTIONS.filter((a) => a.state !== 'done').length} ${tt('待办', 'to-do')}`, render: () => renderActions() },
      { id: 'interview', label: '面试陪练', en: 'Interview', abbr: '练', group: 'growth', ai: true, icon: ICONS.interview, render: () => renderInterview() },
    ],
    cards: SEEKER_CARDS,
    frameQuery: (t) => frameQuery(t),
    appReply: (t) => copReply(t),
    appSuggs: () => aiSuggs(),
    appCommands: () => AGENT_CMDS,
    renderAppChips: () => renderAgentCmds(),
    settings: () => ({
      tabs: [
        { id: 'goals', label: { zh: '目标设置', en: 'Goals' }, render: goalsSectionHTML, wire: wireGoalsSection },
        { id: 'weights', label: { zh: '评分权重', en: 'Weights' }, render: weightsSectionHTML, wire: wireWeightsSection },
      ],
      extend: {
        profile: { render: masterSectionHTML, wire: wireMasterSection },
        data: { render: dataResumeRowHTML, wire: wireDataResumeRow },
      },
    }),
    collId: (name, r) => (name === 'skills' ? r.name : undefined),
    // §1 契约化(批11B · pageNew):平台快捷键 Mod+N / 新建入口按 pageId 取本应用「创建」动作。
    // 无参箭头包装(契约返回 () => void;openNewJob(editId) 的 editId=undefined 即「新建」,与原 contextNew 的 openNewJob() 逐字等价)。
    // 惰性(体在调用时求值)→ manifest eval 不 eager 读 openNewJob/openNewAction、无载序前移。
    pageNew: (pageId) => ({ jobs: () => openNewJob(), actions: () => openNewAction() }[pageId]),
    // §1 契约化(批11B · pageActions):平台 nav.renderTopActions 原硬编码本应用顶栏动作 map,逐字迁入。
    // 惰性:fn 闭包点击时求值;tt 每次 pageActions() 调用重求值(语言切换即时,与原 nav 每次 renderTopActions 重建 map 同);manifest eval 顶层零 eager 读。
    pageActions: (pageId) => ({
      overview: [{ t: tt('智能匹配', 'Smart match'), a: 'btn-accent', fn: () => go('match') }],
      match: [{ t: tt('我的简历', 'My resume'), fn: () => openResumeModal() }],
      resumes: [{ t: tt('+ 生成针对性简历', '+ Tailored resume'), a: 'btn-accent', fn: () => resumeGenerate(resumeState.jobId, renderResumes) }],
      jobs: [{ t: tt('+ 录入岗位', '+ Add job'), a: 'btn-accent', fn: () => openNewJob() }],
      analysis: [{ t: tt('导出报告', 'Export report'), fn: () => toast(tt('已导出分析报告 (mock)', 'Analysis report exported (mock)')) }],
      skills: [{ t: tt('市场价值报告', 'Market value'), fn: () => openMarketValue() }],
      actions: [{ t: tt('+ 添加行动', '+ Add action'), fn: () => openNewAction() }],
    }[pageId] || []),
    // 应用启动:抓演示种子(趁内存还是 mock 字面量;seedDemoData 供落地页显式播种)+ 挂示例提示条(演示模式时)。
    init: () => { captureSeed(); syncDemoBanner(); },
    // 「清空全部数据」后:退演示模式(演示数据已被清,jh-demo 若残留会给空工作台挂示例条)。
    onDataCleared: () => setDemoMode(false),
  });
})();
