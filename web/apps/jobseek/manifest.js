// @ts-check
/**
 * jobseek(求职工作台)· 阶段1 适配器 manifest。
 * 页面 / 卡片 / 框定的**实现仍内联在 index.html**(全局函数),本文件只把它们注册进壳
 * (行为零回归);阶段3 按页把实现迁入本目录,manifest 形态不变。
 * 依赖的单体全局清单见 ./monolith-globals.d.ts(= 阶段3 搬迁账本)。
 * 加载时机:classic、置于全部单体内联脚本之后、壳 BOOT 之前(index.html 尾部)。
 */
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
        data: { render: dataResumeRowHTML },
      },
    }),
    collId: (name, r) => (name === 'skills' ? r.name : undefined),
    // 应用启动:抓演示种子(趁内存还是 mock 字面量;seedDemoData 供落地页显式播种)+ 挂示例提示条(演示模式时)。
    init: () => { captureSeed(); syncDemoBanner(); },
  });
})();
