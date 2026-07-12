// @ts-check
/** 平台 · 当前项目壳态(proposal-project PJ2)—— **零 import 叶子**(data-store/ai-engine/切换器共同依赖,
 *  必须无环:shell-state 已 import data-store ⇒ 当前项目态不能住 shell-state,单列叶子)。
 *
 *  语义:'' = 默认工作区「日常」(既有消息无 projectId 天然归它,零回归)。localStorage 持久(jh-project)。
 *  ★reassigned litmus(第27/31/32轮):外部读→getter、外部写→setter,不上 window 桥。
 *  ★红线:切换项目是**用户 UI 动作**(切换器/管理面);Agent 不能切换(无任何工具可写本态 ——
 *  「项目管理不经对话」的运行态半,与 platform_projects 存储半同族,见 project-model.js 头注)。
 */

/** @type {string} */
let _current = '';
let _hydrated = false;

/** 当前项目 id('' = 默认工作区)。惰性水合(首读时从 localStorage,顶层零语句保载序安全)。 */
export function currentProjectId() {
  if (!_hydrated) {
    _hydrated = true;
    try {
      _current = localStorage.getItem('jh-project') || '';
    } catch (_e) {
      _current = '';
    }
  }
  return _current;
}

/**
 * 切换当前项目(仅用户 UI 调:切换器/归档回落)。
 * @param {string} id 项目 id;'' = 默认工作区
 */
export function setCurrentProjectId(id) {
  _current = typeof id === 'string' ? id : '';
  _hydrated = true;
  try {
    localStorage.setItem('jh-project', _current);
  } catch (_e) {}
}
