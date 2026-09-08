// @ts-check
/**
 * assets(数据资产管理)· 阶段4 第二应用 manifest —— 平台化前提的最终验证:
 * 新增一个应用 = 本 manifest + pages/(prompts/notes)+ 后端集合白名单三处追加(阶段4-1),平台/壳 JS 零改动。
 * 集合按 D1 以 <appId>_ 前缀声明;AI 可读走 D3 三层闸(启用 ∩ 下方 aiReadable 默认 ∩ 用户 per-app 授权)。
 * 加载时机:type=module、置于 pages/*.js 之后、壳 BOOT 之前(同 jobseek 先例)。
 * 批7:页 render 由 import 直取(不再依赖 window 全局)——同 app 内 pages↔manifest 走 import,跨层仅 window.SeekerShell 契约保持全局。
 */
import { renderPrompts } from './pages/prompts.js';
import { renderNotes, openNoteModal, reloadNotes } from './pages/notes.js';
import { loadNotes, listNotes, saveNote, noteTitle } from './note-store.js';
import { go } from '../../platform/shell/nav.js';

(function () {
  'use strict';
  // rail 态导航图标(细线 1.5px 圆角端,同设计语言)。
  const ICONS = {
    app:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3.5 7.5 12 12l8.5-4.5z"/><path d="M3.5 12 12 16.5 20.5 12"/><path d="M3.5 16.5 12 21l8.5-4.5"/></svg>',
    prompts:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M7.5 9.5l3 2.5-3 2.5"/><path d="M12.5 15h4"/></svg>',
    notes:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 4.5h15v9l-6 6h-9z"/><path d="M13.5 19.5v-6h6"/><path d="M8 9.5h8M8 13h4"/></svg>',
  };

  /** @type {import('../../platform/shell/types').SeekerShellApi} */
  const shell = /** @type {any} */ (window).SeekerShell;

  shell.register({
    id: 'assets',
    name: { zh: '资料库', en: 'Library' },
    icon: ICONS.app,
    blurb: {
      zh: '本地笔记、摘录、收藏与来源，保存不自动调用 AI',
      en: 'Local notes, excerpts, favorites and sources. Saving does not call AI.',
    },
    collections: ['assets_prompts', 'assets_notes'],
    // 第23轮[建议]采纳:notes 是自由文本兜底容器、可能承载敏感个人信息,而 D3 授权是 per-app 单档(分集合授权=第5轮开放问题⑤)
    // → 整应用 default-off(隐私·反焦虑取向;blurb 本就写"授权后"),用户在应用管理页一键授权即开;prompts 的 AI 语料用例经显式 opt-in。
    aiReadable: 'default-off',
    groups: {
      assets: { zh: '资产', en: 'ASSETS' },
      everyday: { zh: '日常', en: 'EVERYDAY' },
    },
    // liveCount 暂不挂:导航徽标 span 由 buildNav 一次性创建,从 0 起步的集合在水合后无法就地补出徽标
    // (syncNavCounts 只更新既有 span,pre-existing 平台行为)——避免"有数据却无徽标"的不一致,留后续。
    pages: [
      { id: 'prompts', label: 'Prompt 库', en: 'Prompts', abbr: 'P', eyebrow: 'PROMPTS', group: 'assets', icon: ICONS.prompts, render: () => renderPrompts() },
      { id: 'notes', label: '资料库', en: 'Library', abbr: '记', eyebrow: 'LIBRARY', group: 'everyday', primary:true, primaryOrder:30, workspace:true, icon: ICONS.notes, render: () => renderNotes() },
    ],
    saveNote,
    pageNew: id=>id==='notes'?()=>openNoteModal(''):undefined,
    onDataImported: ()=>{reloadNotes();},
    recentItems: async()=>{await loadNotes();return listNotes().slice(0,6).map(n=>({id:n.id,title:noteTitle(n),updated:n.updated,open:()=>{go('notes');openNoteModal(n.id);}}));},
  });
})();
