// @ts-check
/**
 * jobseek · Task Agent 管理面。
 *
 * 这里只编排可信 UI 与 RuntimeApi；TaskSpec 缩权、状态转换、文件写入和校验均在 Rust 核。
 * 本页绝不读取 profile，也不接受任意工具/路径输入。
 */
import { rt } from '../../../platform/runtime/index.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { $, $$ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { frontis, signFoot } from '../../../platform/shell/nav.js';
import { errText, toast } from '../../../platform/shell/toast.js';
import { hasJobContent, hasProfessionalContent } from '../logic/resume-validity.js';

/** @typedef {import('../../../platform/runtime/types').AgentTask} AgentTask */
/** @typedef {import('../../../platform/runtime/types').AgentRun} AgentRun */
/** @typedef {import('../../../platform/runtime/types').AgentStep} AgentStep */
/** @typedef {import('../../../platform/runtime/types').AgentArtifact} AgentArtifact */
/** @typedef {import('../../../platform/runtime/types').AgentEvent} AgentEvent */
/** @typedef {import('../../../platform/runtime/types').Record} DbRecord */
/** @typedef {{ run: AgentRun | null, artifacts: AgentArtifact[], displayedStatus: string, trustBroken: boolean }} TaskViewState */

const ACTIVE = new Set(['queued', 'created', 'planning', 'running', 'waiting_input', 'waiting_approval']);
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const STATUS = {
  draft: ['待确认', 'Draft'], queued: ['排队中', 'Queued'], created: ['已创建', 'Created'],
  planning: ['规划中', 'Planning'], running: ['执行中', 'Running'], waiting_input: ['等待输入', 'Waiting for input'],
  waiting_approval: ['等待批准', 'Waiting for approval'], paused: ['已暂停', 'Paused'],
  succeeded: ['已完成', 'Succeeded'], failed: ['失败', 'Failed'], cancelled: ['已取消', 'Cancelled'],
  interrupted: ['已中断', 'Interrupted'], pending: ['待执行', 'Pending'], outcome_unknown: ['结果未知', 'Outcome unknown'],
  skipped: ['已跳过', 'Skipped'],
};
const ARTIFACT_NAMES = {
  match_report: ['岗位匹配报告', 'Job match report'],
  tailored_resume: ['针对性简历', 'Tailored resume'],
  cover_letter: ['求职信草稿', 'Cover letter draft'],
  interview_checklist: ['面试准备清单', 'Interview checklist'],
  opportunity_report: ['机会雷达报告', 'Opportunity radar report'],
};

const view = {
  selectedTaskId: '',
  composing: false,
  busy: false,
  renderSeq: 0,
  pollTimer: /** @type {number | null} */ (null),
  subscribed: false,
};

/** @param {unknown} value */
function str(value) { return value == null ? '' : String(value); }
/** @param {unknown} value */
function idOf(value) { return str(/** @type {any} */ (value)?.id); }
/** @param {string} status */
function statusText(status) {
  const pair = /** @type {Record<string, string[]>} */ (STATUS)[status];
  return pair ? tt(pair[0], pair[1]) : status;
}
/** @param {string} status */
function statusClass(status) {
  if (status === 'succeeded') return 'is-ok';
  if (status === 'failed' || status === 'outcome_unknown') return 'is-bad';
  if (ACTIVE.has(status)) return 'is-live';
  return '';
}

/** @param {AgentTask} task @param {AgentRun | null} run @param {AgentArtifact[]} artifacts @returns {TaskViewState} */
function taskViewState(task, run, artifacts) {
  const requiredArtifacts = task.workflowId === 'job_opportunity_radar' ? 1 : 4;
  const trustBroken = run?.status === 'succeeded' &&
    (artifacts.length !== requiredArtifacts || artifacts.some((artifact) => artifact.verified !== true || artifact.validationStatus === 'invalid'));
  return { run, artifacts, displayedStatus: trustBroken ? 'interrupted' : task.status, trustBroken };
}
/** @param {number | undefined} epoch */
function dateText(epoch) {
  if (!epoch || !Number.isFinite(epoch)) return '—';
  try { return new Date(epoch).toLocaleString(); } catch (_error) { return '—'; }
}
/** @param {DbRecord} job */
function jobLabel(job) { return [str(job.co), str(job.role)].filter(Boolean).join(' · ') || idOf(job); }

function loadingHTML() {
  return frontis('TASK AGENT', tt('任务中心', 'Task center')) +
    `<div class="sec"><p class="agent-task-muted">${tt('正在读取本地任务…', 'Loading local tasks…')}</p></div>`;
}

/** @param {DbRecord[]} jobs @param {DbRecord[]} resumes */
function composerHTML(jobs, resumes) {
  if (!view.composing) return '';
  if (!rt.available('agentExecution')) return `<div class="sec agent-task-compose"><div class="agent-task-heading"><div><p class="seclabel">— DESKTOP REQUIRED</p><h2 class="sectitle">${tt('请在桌面版创建任务', 'Create tasks in the desktop app')}<span class="dot">.</span></h2></div><button class="btn-text" data-agent-close>${tt('收起', 'Close')}</button></div><p class="agent-task-note">${tt('网页端只保全和查看从桌面备份导入的任务记录，不会伪装执行本地 Agent 或创建文件。', 'The web version only preserves and displays task records imported from a desktop backup. It does not pretend to run the local Agent or create files.')}</p></div>`;
  const sourceJobs = jobs.filter(hasJobContent);
  const sourceResumes = resumes.filter(hasProfessionalContent);
  const jobOptions = sourceJobs.map((job, index) => `<label class="agent-task-choice">
    <input type="checkbox" data-agent-job="${cEsc(idOf(job))}" ${index < Math.min(3, sourceJobs.length) ? 'checked' : ''}>
    <span><b>${cEsc(jobLabel(job))}</b><small>${cEsc(str(job.city || job.pay || ''))}</small></span>
  </label>`).join('');
  const resumeOptions = sourceResumes.map((resume) => `<option value="${cEsc(idOf(resume))}">${cEsc(resume.master === true ? tt('主简历资料', 'Master resume data') : idOf(resume))}</option>`).join('');
  const ready = sourceJobs.length > 0 && sourceResumes.length > 0;
  return `<div class="sec agent-task-compose">
    <div class="agent-task-heading"><div><p class="seclabel">— NEW TASK</p><h2 class="sectitle">${tt('创建岗位投递包', 'Create application package')}<span class="dot">.</span></h2></div><button class="btn-text" data-agent-close>${tt('收起', 'Close')}</button></div>
    <p class="agent-task-copy">${tt('先确认输入和权限，再开始执行。最多选择 5 个岗位；系统只读取岗位、职业资产和所选专业简历，不读取联系方式。', 'Review inputs and permissions before running. Choose up to 5 jobs; Seeker reads only jobs, career assets, and the selected professional resume—never contact details.')}</p>
    ${ready ? `<div class="field"><label>${tt('任务名称', 'Task name')}</label><input class="input" data-agent-title value="${tt('生成岗位投递包', 'Build application package')}"></div>
      <div class="field"><label>${tt('选择 1–5 个岗位', 'Choose 1–5 jobs')}</label><div class="agent-task-choices">${jobOptions}</div></div>
      <div class="field-row"><div class="field"><label>${tt('源简历', 'Source resume')}</label><select class="select" data-agent-resume>${resumeOptions}</select></div><div class="field"><label>${tt('产物语言', 'Output language')}</label><select class="select" data-agent-language><option value="zh">中文</option><option value="en">English</option></select></div></div>
      <div class="agent-task-permission"><b>${tt('固定权限', 'Fixed permission')}</b><span>jobs · skills · resumes</span><span>${tt('只读输入 + 创建本地文件', 'Read-only inputs + local file creation')}</span></div>
      <div class="agent-task-actions"><button class="btn" data-agent-close>${tt('取消', 'Cancel')}</button><button class="btn btn-accent" data-agent-create>${tt('创建并检查', 'Create and review')} →</button></div>` :
      `<div class="guide-step"><span class="gnum">— INPUT</span><div><h3>${tt('还缺少可执行输入', 'Required inputs are missing')}</h3><p>${tt('请先录入至少一个目标岗位，并在「数据设置 → 个人信息」填写主简历资料。联系方式仍与任务隔离。', 'Add at least one target job and fill in master resume data under Settings → Profile. Contact details remain isolated from the task.')}</p></div></div>`}
  </div>`;
}

/** @param {AgentTask[]} tasks @param {Map<string, TaskViewState>} taskStates */
function taskListHTML(tasks, taskStates) {
  if (!tasks.length) return `<div class="guide-step"><span class="gnum">— 01</span><div><h3>${rt.available('agentExecution') ? tt('从一个可验收的任务开始', 'Start with a verifiable task') : tt('这里显示桌面任务记录', 'Desktop task records appear here')}</h3><p>${rt.available('agentExecution') ? tt('让 Seeker 比较 1–5 个岗位，生成简历、求职信、匹配报告和面试清单；只有四项文件都通过校验才算完成。', 'Let Seeker compare 1–5 jobs and create a resume, cover letter, match report, and interview checklist. Completion requires all four files to pass verification.') : tt('从桌面版导入完整备份后，可在网页端查看任务状态、步骤、校验摘要和审计记录；执行仍只发生在桌面端。', 'After importing a full desktop backup, you can inspect task status, steps, verification hashes, and audit logs here; execution remains desktop-only.')}</p>${rt.available('agentExecution') ? `<button class="btn btn-accent" data-agent-new style="margin-top:14px;">${tt('+ 新建任务', '+ New task')}</button>` : ''}</div></div>`;
  return `<div class="agent-task-list">${tasks.map((task) => {
    const status = taskStates.get(idOf(task))?.displayedStatus || task.status;
    return `<button class="agent-task-row ${idOf(task) === view.selectedTaskId ? 'is-selected' : ''}" data-agent-task="${cEsc(idOf(task))}">
      <span><b>${cEsc(task.title || tt('岗位投递包', 'Application package'))}</b><small>${cEsc(dateText(task.updatedAt))}</small></span>
      <span class="agent-task-status ${statusClass(status)}">${cEsc(statusText(status))}</span>
    </button>`;
  }).join('')}</div>`;
}

/** @param {AgentStep[]} steps */
function stepsHTML(steps) {
  if (!steps.length) return `<p class="agent-task-muted">${tt('开始运行后将在这里显示固定执行计划。', 'The fixed execution plan appears here after the run starts.')}</p>`;
  const done = steps.filter((step) => step.status === 'succeeded').length;
  const pct = Math.round(done / steps.length * 100);
  return `<div class="agent-task-progress"><span style="width:${pct}%"></span></div><div class="agent-task-steps">${steps.map((step, index) => `<div class="agent-task-step ${statusClass(step.status)}">
    <span class="agent-task-step-no">${String(index + 1).padStart(2, '0')}</span><span><b>${cEsc(step.title)}</b><small>${cEsc(str(step.tool))} · ${cEsc(str(step.effect))}${step.attempt ? ` · ${tt('尝试', 'attempt')} ${step.attempt}/2` : ''}</small></span><span class="agent-task-status ${statusClass(step.status)}">${cEsc(statusText(step.status))}</span>
  </div>`).join('')}</div>`;
}

/** @param {AgentArtifact[]} artifacts */
function artifactsHTML(artifacts) {
  if (!artifacts.length) return `<p class="agent-task-muted">${tt('当前运行还没有产物。', 'The current run has no artifacts yet.')}</p>`;
  return `<div class="agent-artifact-grid">${artifacts.map((artifact) => {
    const label = /** @type {Record<string, string[]>} */ (ARTIFACT_NAMES)[artifact.kind] || [artifact.name, artifact.name];
    const trusted = artifact.verified === true && artifact.validationStatus !== 'invalid';
    return `<article class="agent-artifact ${trusted ? 'is-verified' : 'is-unverified'}"><div><span class="agent-artifact-kind">${cEsc(tt(label[0], label[1]))}</span><span class="agent-artifact-trust">${trusted ? tt('已验证', 'Verified') : tt('未验证 / 需要处理', 'Unverified / action needed')}</span><h3>${cEsc(artifact.name)}</h3><p>${Math.ceil((artifact.size || 0) / 1024)} KiB · SHA-256 ${cEsc(str(artifact.sha256).slice(0, 10))}…</p>${artifact.validationError ? `<p class="agent-task-error">${cEsc(str(artifact.validationError))}</p>` : ''}</div><div class="agent-task-actions">${artifact.mime === 'text/markdown' && rt.available('agentExecution') ? `<button class="btn-text" data-agent-preview="${cEsc(idOf(artifact))}" ${trusted ? '' : 'disabled'}>${tt('预览', 'Preview')}</button>` : ''}<button class="btn" data-agent-open="${cEsc(idOf(artifact))}" ${rt.available('agentExecution') && trusted ? '' : 'disabled'}>${tt('打开文件', 'Open file')}</button></div></article>`;
  }).join('')}</div><pre class="agent-artifact-preview" data-agent-preview-host hidden></pre>`;
}

/** @param {AgentEvent[]} events */
function eventsHTML(events) {
  if (!events.length) return `<p class="agent-task-muted">${tt('还没有运行事件。', 'No run events yet.')}</p>`;
  return `<ol class="agent-task-events">${events.slice().reverse().map((event) => `<li><time>${cEsc(dateText(event.createdAt))}</time><span>${cEsc(tt(event.message, str(/** @type {any} */ (event).messageEn || event.message)))}</span></li>`).join('')}</ol>`;
}

/** @param {AgentTask} task @param {TaskViewState} taskState @param {AgentStep[]} steps @param {AgentEvent[]} events @param {DbRecord[]} jobs */
function detailHTML(task, taskState, steps, events, jobs) {
  const { run, artifacts, displayedStatus, trustBroken } = taskState;
  const inputs = /** @type {any} */ (task.inputs);
  const radar = task.workflowId === 'job_opportunity_radar';
  const labels = radar ? [] : (inputs.jobIds || []).map((/** @type {string} */ id) => jobLabel(jobs.find((job) => idOf(job) === str(id)) || { id }));
  const canRun = task.status === 'draft' || task.status === 'failed' || (radar && task.status === 'succeeded');
  const canPause = run?.status === 'running';
  const canResume = run?.status === 'paused' || run?.status === 'interrupted';
  const canCancel = !!run && !TERMINAL.has(run.status);
  return `<div class="agent-task-detail">
    <div class="agent-task-heading"><div><p class="seclabel">— TASK SPEC</p><h2 class="sectitle">${cEsc(task.title)}<span class="dot">.</span></h2></div><span class="agent-task-status ${statusClass(displayedStatus)}">${cEsc(statusText(displayedStatus))}</span></div>
    <p class="agent-task-copy">${cEsc(task.goal)}</p>
    ${trustBroken ? `<p class="agent-task-error">${tt('当前运行的产物可信状态不完整，任务不能视为已完成。', 'The current run has incomplete artifact trust state and cannot be treated as complete.')}</p>` : ''}
    <dl class="agent-task-spec">${radar ? `<div><dt>${tt('目标职位', 'Target roles')}</dt><dd>${(inputs.criteria?.roles || []).map(cEsc).join('<br>')}</dd></div><div><dt>${tt('机会来源', 'Sources')}</dt><dd>${cEsc(str((inputs.sources || []).length))} ${tt('项受控来源', 'controlled source(s)')}</dd></div>` : `<div><dt>${tt('岗位输入', 'Job inputs')}</dt><dd>${labels.map(cEsc).join('<br>')}</dd></div><div><dt>${tt('源简历', 'Source resume')}</dt><dd>${cEsc(str(inputs.resumeId))}</dd></div>`}<div><dt>${tt('授权效果', 'Authorized effects')}</dt><dd>${task.capabilityScope.effects.map((effect) => cEsc(effect)).join(' · ')}</dd></div><div><dt>${tt('成功条件', 'Success gate')}</dt><dd>${radar ? tt('候选已验链、去重，报告摘要一致', 'Candidates verified and deduplicated; report hash matches') : tt('4 个文件存在、格式有效且摘要一致', '4 files exist, have valid formats, and match their hashes')}</dd></div></dl>
    ${rt.available('agentExecution') ? `<div class="agent-task-actions">${canRun ? `<button class="btn btn-accent" data-agent-action="start">${radar && task.status === 'succeeded' ? tt('再次扫描', 'Scan again') : tt('开始执行', 'Start run')} →</button>` : ''}${canPause ? `<button class="btn" data-agent-action="pause">${tt('暂停', 'Pause')}</button>` : ''}${canResume ? `<button class="btn btn-accent" data-agent-action="resume">${tt('继续', 'Resume')} →</button>` : ''}${canCancel ? `<button class="btn" data-agent-action="cancel">${tt('取消任务', 'Cancel task')}</button>` : ''}</div>` : `<p class="agent-task-note">${tt('网页端仅查看从桌面备份导入的任务记录；真实执行和本地文件只在桌面版可用。', 'The web version only displays task records imported from a desktop backup. Execution and local files require the desktop app.')}</p>`}
    ${run?.error ? `<p class="agent-task-error">${cEsc(str(run.error))}</p>` : ''}
    <div class="sec"><p class="seclabel">— EXECUTION</p><h3 class="sectitle">${tt('执行计划', 'Execution plan')}<span class="dot">.</span></h3>${stepsHTML(steps)}</div>
    <div class="sec"><p class="seclabel">— ARTIFACTS</p><h3 class="sectitle">${tt('任务产物', 'Artifacts')}<span class="dot">.</span></h3>${artifactsHTML(artifacts)}</div>
    <div class="sec" style="border-bottom:none;"><p class="seclabel">— AUDIT LOG</p><h3 class="sectitle">${tt('运行记录', 'Run log')}<span class="dot">.</span></h3>${eventsHTML(events)}</div>
  </div>`;
}

/** @param {AgentTask[]} tasks @param {DbRecord[]} jobs @param {DbRecord[]} resumes */
async function paint(tasks, jobs, resumes) {
  const host = $('#page-tasks');
  if (!host) return;
  if (view.selectedTaskId && !tasks.some((task) => idOf(task) === view.selectedTaskId)) view.selectedTaskId = '';
  if (!view.selectedTaskId && tasks.length) view.selectedTaskId = idOf(tasks[0]);
  const selected = tasks.find((task) => idOf(task) === view.selectedTaskId) || null;
  /** @type {Map<string, TaskViewState>} */
  const taskStates = new Map(await Promise.all(tasks.map(async (task) => {
    const [runs, allArtifacts] = await Promise.all([rt.agent.listRuns(idOf(task)), rt.agent.listArtifacts(idOf(task))]);
    runs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const latestRun = runs[0] || null;
    const currentArtifacts = latestRun ? allArtifacts.filter((artifact) => artifact.runId === idOf(latestRun)) : [];
    return /** @type {[string, TaskViewState]} */ ([idOf(task), taskViewState(task, latestRun, currentArtifacts)]);
  })));
  /** @type {AgentStep[]} */ let steps = [];
  /** @type {AgentEvent[]} */ let events = [];
  const selectedState = selected ? taskStates.get(idOf(selected)) || taskViewState(selected, null, []) : null;
  const run = selectedState?.run || null;
  if (run) {
    [steps, events] = await Promise.all([rt.agent.listSteps(idOf(run)), rt.agent.listEvents(idOf(run))]);
    steps.sort((a, b) => Number(/** @type {any} */ (a).order ?? 999) - Number(/** @type {any} */ (b).order ?? 999));
    events.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  host.innerHTML = frontis('TASK AGENT', tt('任务中心', 'Task center')) + composerHTML(jobs, resumes) +
    `<div class="agent-task-layout"><section class="sec agent-task-sidebar"><div class="agent-task-heading"><div><p class="seclabel">— TASKS</p><h2 class="sectitle">${tt('任务', 'Tasks')}<span class="dot">.</span></h2></div>${tasks.length ? `<button class="btn-text" data-agent-new>${tt('+ 新建', '+ New')}</button>` : ''}</div>${taskListHTML(tasks, taskStates)}</section><section class="sec agent-task-main">${selected && selectedState ? detailHTML(selected, selectedState, steps, events, jobs) : `<p class="agent-task-muted">${tt('创建任务后，可在执行前检查其输入、权限与成功条件。', 'After creating a task, review its inputs, permissions, and success gate before running.')}</p>`}</section></div>` + signFoot();
  wire(run);
  const polling = selected && (ACTIVE.has(selected.status) || (run && ACTIVE.has(run.status)));
  schedulePoll(!!polling);
}

function ensureSubscription() {
  if (view.subscribed || !rt.available('agentExecution')) return;
  view.subscribed = true;
  rt.agent.subscribe(() => { schedulePoll(true, 120); }).catch((error) => {
    view.subscribed = false;
    console.error('[agent] event subscription failed', error);
  });
}

/** @param {boolean} active @param {number} [delay] */
function schedulePoll(active, delay = 850) {
  if (view.pollTimer != null) { window.clearTimeout(view.pollTimer); view.pollTimer = null; }
  if (!active) return;
  view.pollTimer = window.setTimeout(() => { view.pollTimer = null; void refresh(false); }, delay);
}

/** @param {boolean} [showLoading] */
async function refresh(showLoading = true) {
  const seq = ++view.renderSeq;
  const host = $('#page-tasks');
  if (!host) return;
  if (showLoading && !host.innerHTML) host.innerHTML = loadingHTML();
  try {
    const [tasks, jobs, resumes] = await Promise.all([rt.agent.listTasks(), rt.db.list('jobs'), rt.db.list('resumes')]);
    if (seq !== view.renderSeq) return;
    tasks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    await paint(tasks, jobs, resumes);
  } catch (error) {
    if (seq !== view.renderSeq) return;
    host.innerHTML = frontis('TASK AGENT', tt('任务中心', 'Task center')) + `<div class="sec"><p class="agent-task-error">${tt('读取任务失败：', 'Could not load tasks: ')}${errText(error)}</p></div>` + signFoot();
  }
}

/** @param {AgentRun | null} run */
function wire(run) {
  $$('#page-tasks [data-agent-new]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = openTaskComposer; });
  $$('#page-tasks [data-agent-close]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { view.composing = false; void refresh(false); }; });
  $$('#page-tasks [data-agent-task]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { view.selectedTaskId = str(/** @type {HTMLElement} */ (button).dataset.agentTask); view.composing = false; void refresh(false); }; });
  const create = /** @type {HTMLButtonElement | null} */ ($('#page-tasks [data-agent-create]'));
  if (create) create.onclick = () => { void createTask(create); };
  $$('#page-tasks [data-agent-action]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { void controlRun(str(/** @type {HTMLElement} */ (button).dataset.agentAction), run); }; });
  $$('#page-tasks [data-agent-preview]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { void previewArtifact(str(/** @type {HTMLElement} */ (button).dataset.agentPreview)); }; });
  $$('#page-tasks [data-agent-open]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { void openArtifact(str(/** @type {HTMLElement} */ (button).dataset.agentOpen)); }; });
}

/** @param {HTMLButtonElement} button */
async function createTask(button) {
  if (view.busy) return;
  const jobIds = $$('#page-tasks [data-agent-job]').filter((node) => /** @type {HTMLInputElement} */ (node).checked).map((node) => str(/** @type {HTMLElement} */ (node).dataset.agentJob));
  const resumeId = str(/** @type {HTMLSelectElement | null} */ ($('#page-tasks [data-agent-resume]'))?.value);
  if (jobIds.length < 1 || jobIds.length > 5) { toast(tt('请选择 1–5 个岗位', 'Choose 1–5 jobs')); return; }
  if (!resumeId) { toast(tt('请选择源简历', 'Choose a source resume')); return; }
  view.busy = true; button.disabled = true;
  try {
    const task = await rt.agent.createTask({
      workflowId: 'job_application_package',
      title: str(/** @type {HTMLInputElement | null} */ ($('#page-tasks [data-agent-title]'))?.value).trim(),
      goal: tt('选择最匹配岗位并生成完整、可验证的投递包', 'Choose the best-matching role and build a complete, verifiable application package'),
      inputs: { jobIds, resumeId, language: /** @type {'zh'|'en'} */ (/** @type {HTMLSelectElement} */ ($('#page-tasks [data-agent-language]')).value) },
    });
    view.selectedTaskId = idOf(task); view.composing = false;
    toast(tt('任务已创建，请检查后开始执行', 'Task created; review it before starting'));
  } catch (error) { toast(tt('创建失败：', 'Create failed: ') + errText(error)); }
  finally { view.busy = false; void refresh(false); }
}

/** @param {string} action @param {AgentRun | null} run */
async function controlRun(action, run) {
  if (view.busy) return;
  view.busy = true;
  try {
    if (action === 'start') await rt.agent.start(view.selectedTaskId);
    else if (action === 'pause' && run) await rt.agent.pause(idOf(run));
    else if (action === 'resume' && run) await rt.agent.resume(idOf(run));
    else if (action === 'cancel' && run) await rt.agent.cancel(idOf(run));
    else throw new Error(tt('运行状态已变化，请刷新后重试', 'Run state changed; refresh and try again'));
    toast(action === 'start' ? tt('任务已开始', 'Task started') : action === 'pause' ? tt('已请求暂停', 'Pause requested') : action === 'resume' ? tt('任务已继续', 'Task resumed') : tt('已请求取消', 'Cancellation requested'));
  } catch (error) { toast(tt('操作失败：', 'Action failed: ') + errText(error)); }
  finally { view.busy = false; schedulePoll(true, 100); }
}

/** @param {string} artifactId */
async function previewArtifact(artifactId) {
  try {
    const text = await rt.agent.readArtifact(artifactId);
    const host = /** @type {HTMLElement | null} */ ($('#page-tasks [data-agent-preview-host]'));
    if (host) { host.textContent = text; host.hidden = false; host.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  } catch (error) { toast(tt('预览失败：', 'Preview failed: ') + errText(error)); schedulePoll(true, 100); }
}

/** @param {string} artifactId */
async function openArtifact(artifactId) {
  try { await rt.agent.openArtifact(artifactId); }
  catch (error) { toast(tt('打开失败：', 'Open failed: ') + errText(error)); schedulePoll(true, 100); }
}

export function openTaskComposer() { view.composing = true; void refresh(false); }
export function renderTasks() { ensureSubscription(); void refresh(true); }
