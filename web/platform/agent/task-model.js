// @ts-check
/**
 * Task Agent 纯数据模型：归一化、状态转换和模型计划校验。
 *
 * 零 import，便于 Node 单测。这里不执行工具、不访问数据，也不信任模型给出的状态；真正的
 * 状态写入还必须由 Rust 协调器重复校验。前端这层用于在数据入 UI 前 fail-safe，并尽早拒绝
 * 畸形 TaskSpec / plan。
 */

export const TASK_STATUSES = /** @type {const} */ ([
  'draft', 'queued', 'running', 'waiting_input', 'waiting_approval', 'paused',
  'succeeded', 'failed', 'cancelled', 'interrupted',
]);
export const RUN_STATUSES = /** @type {const} */ ([
  'created', 'planning', 'running', 'waiting_input', 'waiting_approval', 'paused',
  'succeeded', 'failed', 'cancelled', 'interrupted',
]);
export const STEP_STATUSES = /** @type {const} */ ([
  'pending', 'running', 'waiting_approval', 'succeeded', 'failed', 'skipped',
  'cancelled', 'outcome_unknown',
]);
export const STEP_KINDS = /** @type {const} */ (['read', 'reason', 'generate', 'write', 'verify']);
export const EFFECTS = /** @type {const} */ ([
  'read_only', 'local_create', 'local_mutate', 'destructive', 'external_draft', 'external_commit',
]);

/** Task Agent 可被用户授权读取的业务集合硬底。管理面和隐私集合故意缺席。 */
export const TASK_READABLE_COLLECTIONS = /** @type {const} */ (['jobs', 'skills', 'resumes', 'iv_records']);
export const MAX_PLAN_STEPS = 12;
export const MAX_STEP_ATTEMPTS = 2;

const TASK_TRANSITIONS = {
  draft: ['queued', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['waiting_input', 'waiting_approval', 'paused', 'succeeded', 'failed', 'cancelled', 'interrupted'],
  waiting_input: ['running', 'paused', 'cancelled'],
  waiting_approval: ['running', 'paused', 'cancelled'],
  paused: ['running', 'cancelled', 'interrupted'],
  interrupted: ['running', 'failed', 'cancelled'],
  failed: ['queued'],
  succeeded: [],
  cancelled: [],
};

const RUN_TRANSITIONS = {
  created: ['planning', 'cancelled'],
  planning: ['running', 'waiting_input', 'failed', 'cancelled', 'interrupted'],
  running: ['waiting_input', 'waiting_approval', 'paused', 'succeeded', 'failed', 'cancelled', 'interrupted'],
  waiting_input: ['running', 'paused', 'cancelled'],
  waiting_approval: ['running', 'paused', 'cancelled'],
  paused: ['running', 'cancelled', 'interrupted'],
  interrupted: ['running', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

const STEP_TRANSITIONS = {
  pending: ['running', 'skipped', 'cancelled'],
  running: ['waiting_approval', 'succeeded', 'failed', 'cancelled', 'outcome_unknown'],
  waiting_approval: ['running', 'skipped', 'cancelled'],
  failed: ['pending'],
  outcome_unknown: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  skipped: [],
  cancelled: [],
};

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {number} */
function timestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** @param {unknown} value @param {readonly string[]} allowed @param {string} fallback */
function enumValue(value, allowed, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

/** @param {unknown} value @returns {string[]} */
function strings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))];
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function object(value) {
  return isObject(value) ? { ...value } : {};
}

/**
 * @typedef {{collections:string[], tools:string[], effects:string[], maxSteps:number, maxAttempts:number}} NormCapabilityScope
 * @typedef {{id:string, projectId:string, workflowId:string, title:string, goal:string,
 * inputs:Record<string,unknown>, constraints:string[], deliverables:unknown[], successCriteria:unknown[],
 * capabilityScope:NormCapabilityScope, createdBy:'user'|'schedule', status:string,
 * createdAt:number, updatedAt:number}} NormAgentTask
 */

/**
 * 防御性归一化任务记录。权限字段只会缩到平台硬底，不能因存储垃圾扩权。
 * @param {unknown} record
 * @returns {NormAgentTask}
 */
export function normAgentTask(record) {
  const r = /** @type {any} */ (isObject(record) ? record : {});
  const rawScope = isObject(r.capabilityScope) ? r.capabilityScope : {};
  const collections = strings(rawScope.collections).filter((x) => TASK_READABLE_COLLECTIONS.includes(/** @type {any} */ (x)));
  const maxSteps = Number.isInteger(rawScope.maxSteps) && rawScope.maxSteps > 0
    ? Math.min(rawScope.maxSteps, MAX_PLAN_STEPS) : MAX_PLAN_STEPS;
  const maxAttempts = Number.isInteger(rawScope.maxAttempts) && rawScope.maxAttempts > 0
    ? Math.min(rawScope.maxAttempts, MAX_STEP_ATTEMPTS) : MAX_STEP_ATTEMPTS;
  return {
    id: String(r.id == null ? '' : r.id),
    projectId: String(r.projectId == null ? '' : r.projectId),
    workflowId: String(r.workflowId == null ? '' : r.workflowId),
    title: String(r.title == null ? '' : r.title),
    goal: String(r.goal == null ? '' : r.goal),
    inputs: object(r.inputs),
    constraints: strings(r.constraints),
    deliverables: Array.isArray(r.deliverables) ? r.deliverables.filter(isObject).map(object) : [],
    successCriteria: Array.isArray(r.successCriteria) ? r.successCriteria.filter(isObject).map(object) : [],
    capabilityScope: {
      collections,
      tools: strings(rawScope.tools),
      effects: strings(rawScope.effects).filter((x) => EFFECTS.includes(/** @type {any} */ (x))),
      maxSteps,
      maxAttempts,
    },
    createdBy: r.createdBy === 'schedule' ? 'schedule' : 'user',
    status: enumValue(r.status, TASK_STATUSES, 'draft'),
    createdAt: timestamp(r.createdAt),
    updatedAt: timestamp(r.updatedAt),
  };
}

/** @param {'task'|'run'|'step'} kind @param {unknown} from @param {unknown} to */
export function canTransition(kind, from, to) {
  const table = kind === 'task' ? TASK_TRANSITIONS : kind === 'run' ? RUN_TRANSITIONS : kind === 'step' ? STEP_TRANSITIONS : null;
  if (!table || typeof from !== 'string' || typeof to !== 'string') return false;
  const next = /** @type {Record<string,string[]>} */ (table)[from];
  return Array.isArray(next) && next.includes(to);
}

/**
 * 返回合法新状态；非法转换响亮失败，调用方不得静默修正模型建议的状态。
 * @param {'task'|'run'|'step'} kind @param {string} from @param {string} to
 */
export function transitionStatus(kind, from, to) {
  if (!canTransition(kind, from, to)) throw new Error(`非法 ${kind} 状态转换: ${from} -> ${to}`);
  return to;
}

/** 启动恢复：遗留的执行态只标记 interrupted，不自动重放。 @param {unknown} status */
export function recoverRunStatus(status) {
  return status === 'planning' || status === 'running' ? 'interrupted' : enumValue(status, RUN_STATUSES, 'interrupted');
}

/**
 * 恢复正在执行的步骤。只读/纯推理可以安全回到 pending；任何可能产生持久副作用的步骤
 * 都进入 outcome_unknown，等待 verifier 判定，不能盲重试。
 * @param {unknown} step
 */
export function recoverStepStatus(step) {
  const s = /** @type {any} */ (isObject(step) ? step : {});
  const status = enumValue(s.status, STEP_STATUSES, 'pending');
  if (status !== 'running') return status;
  const effect = enumValue(s.effect, EFFECTS, 'external_commit');
  return effect === 'read_only' || effect === 'external_draft' ? 'pending' : 'outcome_unknown';
}

/**
 * TaskSpec 创建前校验。返回归一值供 UI 预览；错误非空时禁止持久化/启动。
 * @param {unknown} input
 */
export function validateTaskSpec(input) {
  const value = normAgentTask(input);
  /** @type {string[]} */ const errors = [];
  if (!value.workflowId.trim()) errors.push('workflowId 必填');
  if (!value.title.trim()) errors.push('title 必填');
  if (!value.goal.trim()) errors.push('goal 必填');
  if (!value.deliverables.length) errors.push('至少需要一个 deliverable');
  if (!value.successCriteria.length) errors.push('至少需要一个 success criterion');
  if (!value.capabilityScope.tools.length) errors.push('至少需要一个授权工具');
  if (!value.capabilityScope.effects.length) errors.push('至少需要一个授权 effect');
  return { ok: errors.length === 0, errors, value };
}

/**
 * 校验模型提出的顺序计划。scope 必须来自已持久化 TaskSpec，绝不能取模型回显。
 * @param {unknown} input
 * @param {NormCapabilityScope} scope
 */
export function validateTaskPlan(input, scope) {
  /** @type {string[]} */ const errors = [];
  const plan = /** @type {any} */ (isObject(input) ? input : {});
  const steps = /** @type {unknown[]} */ (Array.isArray(plan.steps) ? plan.steps : []);
  const limit = Math.min(MAX_PLAN_STEPS, Math.max(1, Number(scope && scope.maxSteps) || MAX_PLAN_STEPS));
  if (plan.version !== 1) errors.push('plan.version 必须为 1');
  if (!steps.length) errors.push('plan 至少需要一个 step');
  if (steps.length > limit) errors.push(`plan steps 超过上限 ${limit}`);
  const ids = new Set();
  /** @type {any[]} */ const normalized = [];
  steps.slice(0, MAX_PLAN_STEPS + 1).forEach((/** @type {unknown} */ raw, /** @type {number} */ index) => {
    const s = /** @type {any} */ (isObject(raw) ? raw : {});
    const at = `steps[${index}]`;
    const id = typeof s.id === 'string' ? s.id.trim() : '';
    const title = typeof s.title === 'string' ? s.title.trim() : '';
    const kind = enumValue(s.kind, STEP_KINDS, '');
    const effect = enumValue(s.effect, EFFECTS, '');
    const tool = typeof s.tool === 'string' ? s.tool.trim() : '';
    if (!id) errors.push(`${at}.id 必填`);
    else if (ids.has(id)) errors.push(`${at}.id 重复`);
    else ids.add(id);
    if (!title) errors.push(`${at}.title 必填`);
    if (!kind) errors.push(`${at}.kind 非法`);
    if (!effect || !scope.effects.includes(effect)) errors.push(`${at}.effect 未授权`);
    if (kind !== 'reason' && !tool) errors.push(`${at}.tool 必填`);
    if (tool && !scope.tools.includes(tool)) errors.push(`${at}.tool 未授权`);
    if (!isObject(s.inputs)) errors.push(`${at}.inputs 必须为对象`);
    if (typeof s.expectedOutput !== 'string' || !s.expectedOutput.trim()) errors.push(`${at}.expectedOutput 必填`);
    if (!isObject(s.verification)) errors.push(`${at}.verification 必须为对象`);
    normalized.push({
      id, title, kind, effect, tool: tool || undefined, inputs: object(s.inputs),
      expectedOutput: typeof s.expectedOutput === 'string' ? s.expectedOutput : '',
      verification: object(s.verification),
    });
  });
  return {
    ok: errors.length === 0,
    errors,
    value: { version: 1, summary: typeof plan.summary === 'string' ? plan.summary : '', steps: normalized },
  };
}
