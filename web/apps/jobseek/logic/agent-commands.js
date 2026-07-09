// @ts-check —— jobseek · Agent /命令面板项(纯数据,单列 @ts-check 使字面量真受 CommandSpec[] 校验)。
/**
 * AGENT_CMDS 从 copilot-actions.js 抽出单列(批 3.y 尾 · 10d checklist①):
 * 原在 @ts-nocheck 的 copilot-actions.js 里,`@type {CommandSpec[]}` 只**断言**类型、字面量本身不受校验
 * ——漂移(漏 run / label 元数降级)会被 @ts-nocheck 吞掉(已实证:删 run / label 单串 tsc 均不报)。
 * 移入本 @ts-check 纯数据文件后,字面量真受 CommandSpec[] 校验:漏 run / 错 label 元组 → tsc 报错。
 * run 闭包引用 agentSend/copGo(chrome)/copNewJob(copilot-actions)/tt(i18n),全惰性(点击时求值)、
 * 字面量顶层零 eager 读 → 载序安全;copilot-actions 不 import 本文件 → 无环。
 */
import { agentSend, copGo } from '../../../platform/shell/copilot-chrome.js';
import { copNewJob } from './copilot-actions.js';
import { tt } from '../../../platform/shell/i18n.js';

/** @type {import('../../../platform/shell/types').CommandSpec[]} */
export const AGENT_CMDS = [
  { cmd: '/match', label: ['智能匹配', 'Smart match'], desc: ['最该投哪个', 'Best fit'], run: () => agentSend(tt('我最该投哪个岗位?', 'Which job should I apply to?')) },
  { cmd: '/resume', label: ['改简历', 'Tune resume'], desc: ['打开简历', 'Open resume'], run: () => copGo('resumes') },
  { cmd: '/interview', label: ['面试陪练', 'Interview'], desc: ['出题练习', 'Practice'], run: () => copGo('interview') },
  { cmd: '/plan', label: ['排训练计划', 'Training plan'], desc: ['补齐缺口', 'Close gaps'], run: () => agentSend(tt('给我排一个训练计划补齐缺口', 'Make me a training plan to close my gaps')) },
  { cmd: '/gaps', label: ['查能力缺口', 'Skill gaps'], desc: ['Top 缺口', 'Top gaps'], run: () => agentSend(tt('我最大的能力缺口是什么?', 'What is my biggest skill gap?')) },
  { cmd: '/value', label: ['市场价值', 'Market value'], desc: ['估算身价', 'Estimate worth'], run: () => agentSend(tt('我的市场价值值多少?', 'What is my market value?')) },
  { cmd: '/trend', label: ['技能趋势', 'Skill trends'], desc: ['什么在涨', 'What is rising'], run: () => agentSend(tt('什么技能在涨?', 'What skills are trending?')) },
  { cmd: '/next', label: ['下一步', 'Next step'], desc: ['现在该做', 'Do now'], run: () => agentSend(tt('我现在最该做什么?', 'What should I do next?')) },
  { cmd: '/jobs', label: ['目标岗位', 'Target jobs'], desc: ['打开列表', 'Open list'], run: () => copGo('jobs') },
  { cmd: '/skills', label: ['职业资产', 'Career assets'], desc: ['能力档案', 'Asset profile'], run: () => copGo('skills') },
  { cmd: '/add', label: ['录入岗位', 'Add job'], desc: ['新增岗位', 'New job'], run: () => copNewJob() },
  { cmd: '/market', label: ['市场情报', 'Market intel'], desc: ['趋势/薪资', 'Trends/pay'], run: () => copGo('analysis') },
  { cmd: '/settings', label: ['数据设置', 'Settings'], desc: ['仅打开 · 不可改', 'Open only · read-only'], run: () => copGo('settings') },
];
