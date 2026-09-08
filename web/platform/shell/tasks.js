// @ts-check
/**
 * 平台 · 通用任务中心。
 *
 * 这里只编排可信 UI 与 RuntimeApi；TaskSpec 缩权、状态转换、文件写入和校验均在 Rust 核。
 * 本页绝不读取 profile，也不接受任意工具/路径输入。
 */
import { rt } from '../runtime/index.js';
import { cEsc } from './copilot-chrome.js';
import { $, $$ } from './dom.js';
import { tt } from './i18n.js';
import { frontis, signFoot } from './nav.js';
import { errText, toast } from './toast.js';
import { mdRender } from './md-edit.js';

/** @typedef {import('../runtime/types').AgentTask} AgentTask */
/** @typedef {import('../runtime/types').AgentRun} AgentRun */
/** @typedef {import('../runtime/types').AgentStep} AgentStep */
/** @typedef {import('../runtime/types').AgentArtifact} AgentArtifact */
/** @typedef {import('../runtime/types').AgentEvent} AgentEvent */
/** @typedef {import('../runtime/types').Record} DbRecord */
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
function workflows(){return window.SeekerShell.taskWorkflows();}
/** @param {string} id */
function workflow(id){return workflows().find(w=>w.id===id);}

const view = {
  selectedTaskId: '',
  composing: false,
  workflowId:'',
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
  const required = workflow(task.workflowId)?.requiredArtifacts || [];
  const requiredArtifacts = required.length;
  const trustBroken = run?.status === 'succeeded' &&
    (!requiredArtifacts || artifacts.length !== requiredArtifacts || required.some(k=>!artifacts.some(a=>a.kind===k)) || artifacts.some((artifact) => artifact.verified !== true || artifact.validationStatus === 'invalid'));
  return { run, artifacts, displayedStatus: trustBroken ? 'interrupted' : task.status, trustBroken };
}
/** @param {number | undefined} epoch */
function dateText(epoch) {
  if (!epoch || !Number.isFinite(epoch)) return '—';
  try { return new Date(epoch).toLocaleString(); } catch (_error) { return '—'; }
}
function loadingHTML() {
  return frontis('TASK AGENT', tt('任务中心', 'Task center')) +
    `<div class="sec"><p class="agent-task-muted">${tt('正在读取本地任务…', 'Loading local tasks…')}</p></div>`;
}

function composerHTML() {
  if(!view.composing)return '';
  if(!rt.available('agentExecution'))return '<div class="sec"><h3>'+tt('请在桌面版创建任务','Create tasks in the desktop app')+'</h3><p>'+tt('网页版保全并展示桌面任务记录；执行和文件生成需桌面版。','The Web app preserves desktop task records. Execution and file creation require the desktop app.')+'</p><button class="btn" data-agent-close>'+tt('收起','Close')+'</button></div>';
  const choices=workflows().filter(w=>w.enabled&&w.compose);
  if(!choices.some(w=>w.id===view.workflowId))view.workflowId=choices[0]?.id||'';
  return '<div class="sec agent-task-compose" id="taskComposer"><div class="agent-task-heading"><h3>'+tt('创建任务','Create a task')+'</h3><button class="btn-text" data-agent-close>'+tt('收起','Close')+'</button></div><div class="field"><label>'+tt('想完成什么？','What would you like to do?')+'</label><select class="select" id="taskWorkflow">'+choices.map(w=>'<option value="'+cEsc(w.id)+'" '+(view.workflowId===w.id?'selected':'')+'>'+cEsc(tt(w.name.zh,w.name.en))+'</option>').join('')+'</select></div><div id="taskComposerBody"></div></div>';
}
async function mountComposer(){
  const container=/** @type {HTMLElement|null} */($('#taskComposerBody'));if(!container)return;
  const body=document.createElement('div');container.replaceChildren(body);
  const selected=workflow(view.workflowId);
  body.textContent=tt('正在读取可选输入…','Loading available inputs…');
  try{if(!selected?.enabled||!selected.compose)throw new Error(tt('请先启用提供任务的应用。','Enable an app that provides tasks first.'));await selected.compose(body,id=>{if(!body.isConnected)return;view.selectedTaskId=id;view.composing=false;void refresh(false);});body.querySelectorAll('[data-agent-close]').forEach(el=>{/** @type {HTMLElement} */(el).onclick=()=>{view.composing=false;void refresh(false);};});}
  catch(e){body.textContent=tt('无法读取输入：','Could not load inputs: ')+str(e);}
}

/** @param {AgentTask[]} tasks @param {Map<string, TaskViewState>} taskStates */
function taskListHTML(tasks, taskStates) {
  if (!tasks.length) return `<div class="guide-step"><span class="gnum">— 01</span><div><h3>${rt.available('agentExecution') ? tt('从一个可验收的任务开始', 'Start with a verifiable task') : tt('这里显示桌面任务记录', 'Desktop task records appear here')}</h3><p>${rt.available('agentExecution') ? tt('选择资料并说明整理目标。助手会逐份提取、综合整理，并生成可核对和导出的报告。','Select materials and describe your goal. The assistant extracts points, organizes them and creates reports you can check and export.') : tt('从桌面版导入完整备份后，可在网页端查看任务状态、步骤、校验摘要和审计记录；执行仍只发生在桌面端。', 'After importing a full desktop backup, you can inspect task status, steps, verification hashes, and audit logs here; execution remains desktop-only.')}</p>${rt.available('agentExecution') ? `<button class="btn btn-accent" data-agent-new style="margin-top:14px;">${tt('+ 新建任务', '+ New task')}</button>` : ''}</div></div>`;
  return `<div class="agent-task-list">${tasks.map((task) => {
    const status = taskStates.get(idOf(task))?.displayedStatus || task.status;
    return `<button class="agent-task-row ${idOf(task) === view.selectedTaskId ? 'is-selected' : ''}" data-agent-task="${cEsc(idOf(task))}">
      <span><b>${cEsc(task.title || tt('任务', 'Task'))}</b><small>${cEsc(dateText(task.updatedAt))}</small></span>
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
    <span class="agent-task-step-no">${String(index + 1).padStart(2, '0')}</span><span><b>${cEsc(tt(step.title,str(step.titleEn||step.title)))}</b><small>${step.attempt ? `${tt('尝试', 'Attempt')} ${step.attempt}/2` : ''}</small></span><span class="agent-task-status ${statusClass(step.status)}">${cEsc(statusText(step.status))}</span>
  </div>`).join('')}</div>`;
}

/** @param {AgentArtifact[]} artifacts */
function artifactsHTML(artifacts) {
  if (!artifacts.length) return `<p class="agent-task-muted">${tt('当前运行还没有产物。', 'The current run has no artifacts yet.')}</p>`;
  return `<div class="agent-artifact-grid">${artifacts.map((artifact) => {
    const label=workflows().flatMap(w=>Object.entries(w.artifactNames)).find(([kind])=>kind===artifact.kind)?.[1];
    const trusted = artifact.verified === true && artifact.validationStatus !== 'invalid';
    return `<article class="agent-artifact ${trusted ? 'is-verified' : 'is-unverified'}"><div><span class="agent-artifact-kind">${cEsc(label?tt(label.zh,label.en):artifact.name)}</span><span class="agent-artifact-trust">${trusted ? tt('已验证', 'Verified') : tt('未验证 / 需要处理', 'Unverified / action needed')}</span><h3>${cEsc(artifact.name)}</h3><p>${Math.ceil((artifact.size || 0) / 1024)} KiB · SHA-256 ${cEsc(str(artifact.sha256).slice(0, 10))}…</p>${artifact.validationError ? `<p class="agent-task-error">${cEsc(str(artifact.validationError))}</p>` : ''}</div><div class="agent-task-actions">${artifact.mime === 'text/markdown' && rt.available('agentExecution') ? `<button class="btn-text" data-agent-preview="${cEsc(idOf(artifact))}" ${trusted ? '' : 'disabled'}>${tt('预览', 'Preview')}</button>` : ''}${artifact.mime==='text/markdown'&&rt.available('agentExecution')&&window.SeekerShell.canSaveNote()?'<button class="btn-text" data-agent-save="'+cEsc(idOf(artifact))+'" '+(trusted?'':'disabled')+'>'+tt('另存笔记','Save as note')+'</button>':''}<button class="btn" data-agent-export="${cEsc(idOf(artifact))}" ${rt.available('agentExecution') && trusted ? '' : 'disabled'}>${tt('导出副本', 'Export copy')}</button><button class="btn" data-agent-open="${cEsc(idOf(artifact))}" ${rt.available('agentExecution') && trusted ? '' : 'disabled'}>${tt('打开文件', 'Open file')}</button></div></article>`;
  }).join('')}</div><div class="agent-artifact-preview md-body" data-agent-preview-host hidden></div>`;
}

/** @param {AgentEvent[]} events */
function eventsHTML(events) {
  if (!events.length) return `<p class="agent-task-muted">${tt('还没有运行事件。', 'No run events yet.')}</p>`;
  return `<ol class="agent-task-events">${events.slice().reverse().map((event) => `<li><time>${cEsc(dateText(event.createdAt))}</time><span>${cEsc(tt(event.message, str(/** @type {any} */ (event).messageEn || event.message)))}</span></li>`).join('')}</ol>`;
}

/** @param {AgentTask} task @param {TaskViewState} taskState @param {AgentStep[]} steps @param {AgentEvent[]} events @param {string} inputHTML */
function detailHTML(task, taskState, steps, events, inputHTML) {
  const { run, artifacts, displayedStatus, trustBroken } = taskState;
  const inputs = /** @type {any} */ (task.inputs);
  const spec=workflow(task.workflowId);
  const radar = spec?.repeatable===true;
  const radarSources = radar && Array.isArray(inputs.sources) ? inputs.sources : [];
  const mcpSources = radarSources.filter((/** @type {any} */ source) => source?.kind === 'mcp');
  const mcpAuthorizationValid = mcpSources.length === 0 || task.mcpAuthorizationValid === true;

  const canRun = spec?.enabled && mcpAuthorizationValid && (task.status === 'draft' || task.status === 'failed' || (radar && task.status === 'succeeded'));
  const canPause = run?.status === 'running';
  const canResume = spec?.enabled && (run?.status === 'paused' || run?.status === 'interrupted');
  const canCancel = !!run && !TERMINAL.has(run.status);
  return `<div class="agent-task-detail">
    <div class="agent-task-heading"><div><p class="seclabel">— TASK SPEC</p><h2 class="sectitle">${cEsc(task.title)}<span class="dot">.</span></h2></div><span class="agent-task-status ${statusClass(displayedStatus)}">${cEsc(statusText(displayedStatus))}</span></div>
    <p class="agent-task-copy">${cEsc(task.goal)}</p>
    ${trustBroken ? `<p class="agent-task-error">${tt('当前运行的产物可信状态不完整，任务不能视为已完成。', 'The current run has incomplete artifact trust state and cannot be treated as complete.')}</p>` : ''}
    <dl class="agent-task-spec">${inputHTML}<div><dt>${tt('本次权限','Permission')}</dt><dd>${spec?cEsc(tt(spec.permission.zh,spec.permission.en)):tt('此工作流暂不可用','This workflow is unavailable')}</dd></div><div><dt>${tt('完成条件','Completion criteria')}</dt><dd>${spec?cEsc(tt(spec.success.zh,spec.success.en)):''}</dd></div></dl>
    ${spec&&!spec.enabled?'<p class="agent-task-note">'+tt('此应用已关闭；保留任务记录，启用后才能继续执行。','This app is disabled. Task records are kept; enable the app to continue.')+'</p>':''}
    ${mcpSources.length ? `<div class="agent-task-note"><b>${mcpAuthorizationValid ? tt('MCP 精确工具已在本机授权', 'Exact MCP tools authorized on this device') : tt('MCP 授权需要确认', 'MCP authorization required')}</b><p>${tt('readOnlyHint 只是服务端自报。导入或通用改写会使授权失效；请核对上方精确工具后再授权。', 'readOnlyHint is self-reported. Importing or generically editing the task invalidates authorization; review the exact tools above before authorizing.')}</p>${!mcpAuthorizationValid && spec?.enabled && rt.available('agentExecution') ? `<button class="btn btn-accent" data-agent-mcp-authorize>${tt('授权上述精确 MCP 工具', 'Authorize the exact MCP tools above')} →</button>` : ''}</div>` : ''}
    ${rt.available('agentExecution') ? `<div class="agent-task-actions">${canRun ? `<button class="btn btn-accent" data-agent-action="start">${radar && task.status === 'succeeded' ? tt('再次扫描', 'Scan again') : tt('开始执行', 'Start run')} →</button>` : ''}${canPause ? `<button class="btn" data-agent-action="pause">${tt('暂停', 'Pause')}</button>` : ''}${canResume ? `<button class="btn btn-accent" data-agent-action="resume">${tt('继续', 'Resume')} →</button>` : ''}${canCancel ? `<button class="btn" data-agent-action="cancel">${tt('取消任务', 'Cancel task')}</button>` : ''}</div>` : `<p class="agent-task-note">${tt('网页端仅查看从桌面备份导入的任务记录；真实执行和本地文件只在桌面版可用。', 'The web version only displays task records imported from a desktop backup. Execution and local files require the desktop app.')}</p>`}
    ${run?.error ? `<p class="agent-task-error">${cEsc(str(run.error))}</p>` : ''}
    <div class="sec"><p class="seclabel">— EXECUTION</p><h3 class="sectitle">${tt('执行计划', 'Execution plan')}<span class="dot">.</span></h3>${stepsHTML(steps)}</div>
    <div class="sec"><p class="seclabel">— ARTIFACTS</p><h3 class="sectitle">${tt('任务产物', 'Artifacts')}<span class="dot">.</span></h3>${artifactsHTML(artifacts)}</div>
    <div class="sec" style="border-bottom:none;"><p class="seclabel">— AUDIT LOG</p><h3 class="sectitle">${tt('运行记录', 'Run log')}<span class="dot">.</span></h3>${eventsHTML(events)}</div>
  </div>`;
}

/** @param {AgentTask[]} tasks @param {number} seq */
async function paint(tasks,seq) {
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
  const inputHTML=selected?(await workflow(selected.workflowId)?.describe(selected)||''):'';
  if(seq!==view.renderSeq || (view.composing && $('#taskComposer')))return;
  host.innerHTML = frontis('TASK AGENT', tt('任务中心', 'Task center')) + composerHTML() +
    `<div class="agent-task-layout"><section class="sec agent-task-sidebar"><div class="agent-task-heading"><div><p class="seclabel">— TASKS</p><h2 class="sectitle">${tt('任务', 'Tasks')}<span class="dot">.</span></h2></div>${tasks.length ? `<button class="btn-text" data-agent-new>${tt('+ 新建', '+ New')}</button>` : ''}</div>${taskListHTML(tasks, taskStates)}</section><section class="sec agent-task-main">${selected && selectedState ? detailHTML(selected, selectedState, steps, events, inputHTML) : `<p class="agent-task-muted">${tt('创建任务后，可在执行前检查其输入、权限与成功条件。', 'After creating a task, review its inputs, permissions, and success gate before running.')}</p>`}</section></div>` + signFoot();
  wire(run);void mountComposer();
  const polling = !view.composing && selected && (ACTIVE.has(selected.status) || (run && ACTIVE.has(run.status)));
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
    const tasks = await rt.agent.listTasks();
    if (seq !== view.renderSeq) return;
    tasks.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    await paint(tasks,seq);
  } catch (error) {
    if (seq !== view.renderSeq) return;
    host.innerHTML = frontis('TASK AGENT', tt('任务中心', 'Task center')) + `<div class="sec"><p class="agent-task-error">${tt('读取任务失败：', 'Could not load tasks: ')}${errText(error)}</p></div>` + signFoot();
  }
}

/** @param {AgentRun | null} run */
function wire(run) {
  $$('#page-tasks [data-agent-new]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = ()=>openTaskComposer(); });
  $$('#page-tasks [data-agent-close]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { view.composing = false; void refresh(false); }; });
  $$('#page-tasks [data-agent-task]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { view.selectedTaskId = str(/** @type {HTMLElement} */ (button).dataset.agentTask); view.composing = false; void refresh(false); }; });
  const chooser=/** @type {HTMLSelectElement|null} */($('#taskWorkflow'));if(chooser)chooser.onchange=()=>{view.workflowId=chooser.value;void mountComposer();};
    const authorize = /** @type {HTMLButtonElement | null} */ ($('#page-tasks [data-agent-mcp-authorize]'));
  if (authorize) authorize.onclick = () => { void authorizeMcp(authorize); };
  $$('#page-tasks [data-agent-action]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { void controlRun(str(/** @type {HTMLElement} */ (button).dataset.agentAction), run); }; });
  $$('#page-tasks [data-agent-preview]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { void previewArtifact(str(/** @type {HTMLElement} */ (button).dataset.agentPreview)); }; });
  $$('#page-tasks [data-agent-export]').forEach(button=>{/** @type {HTMLElement} */(button).onclick=()=>{void exportArtifact(str(/** @type {HTMLElement} */(button).dataset.agentExport));};});
  $$('#page-tasks [data-agent-save]').forEach(button=>{/** @type {HTMLButtonElement} */(button).onclick=async()=>{
    const b=/** @type {HTMLButtonElement} */(button);b.disabled=true;
    try{const text=await rt.agent.readArtifact(str(b.dataset.agentSave));await window.SeekerShell.saveNote({title:tt('资料报告副本','Material report copy'),text});toast(tt('已另存笔记，可在资料库编辑','Saved as a note. Edit it in Library.'));}
    catch(e){toast(errText(e));b.disabled=false;}
  };});
  $$('#page-tasks [data-agent-open]').forEach((button) => { /** @type {HTMLElement} */ (button).onclick = () => { void openArtifact(str(/** @type {HTMLElement} */ (button).dataset.agentOpen)); }; });
}

/** @param {HTMLButtonElement} button */
async function authorizeMcp(button) {
  if (view.busy) return;
  view.busy = true; button.disabled = true;
  try {
    await rt.agent.authorizeMcp(view.selectedTaskId);
    toast(tt('已授权当前任务列出的精确 MCP 工具', 'The exact MCP tools listed for this task are now authorized'));
  } catch (error) { toast(tt('授权失败：', 'Authorization failed: ') + errText(error)); }
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
    if (host) { host.innerHTML = mdRender(text); host.hidden = false; host.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  } catch (error) { toast(tt('预览失败：', 'Preview failed: ') + errText(error)); schedulePoll(true, 100); }
}

/** @param {string} artifactId */
async function openArtifact(artifactId) {
  try { await rt.agent.openArtifact(artifactId); }
  catch (error) { toast(tt('打开失败：', 'Open failed: ') + errText(error)); schedulePoll(true, 100); }
}

/** @param {string} [workflowId] */
export function openTaskComposer(workflowId) { view.workflowId=workflowId||'';view.composing = true; document.querySelector('#taskComposer')?.remove();void refresh(false); }
/** @param {string} taskId */
export function openTask(taskId){view.selectedTaskId=taskId;view.composing=false;void refresh(false);}
/** @param {string} id */
async function exportArtifact(id){try{const path=await rt.agent.exportArtifact(id);toast(tt('已导出：','Exported: ')+cEsc(path));}catch(e){toast(errText(e));schedulePoll(true,100);}}
export function renderTasks() { ensureSubscription(); void refresh(true); }
