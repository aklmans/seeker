// @ts-check
/** jobseek · 机会雷达可信管理面。搜索执行、验链、入库和接受撤销均由 Rust 核负责。 */
import { rt } from '../../../platform/runtime/index.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { $, $$ } from '../../../platform/shell/dom.js';
import { tt } from '../../../platform/shell/i18n.js';
import { frontis, signFoot, go } from '../../../platform/shell/nav.js';
import { errText, toast, toastUndo } from '../../../platform/shell/toast.js';
import { saveSchedule } from '../../../platform/shell/schedule-store.js';
import { hydrateJobs } from '../logic/persistence.js';

/** @typedef {import('../../../platform/runtime/types').JobOpportunity} JobOpportunity */
/** @typedef {import('../../../platform/runtime/types').McpServerInfo} McpServerInfo */

const state = { composing: false, busy: false, filter: 'active' };
const STATUS = {
  new: ['待审', 'New'], reviewed: ['已审阅', 'Reviewed'], accepted: ['已接受', 'Accepted'],
  dismissed: ['已拒绝', 'Dismissed'], stale: ['已过期', 'Stale'],
};

/** @param {unknown} value */
const str = (value) => value == null ? '' : String(value);
/** @param {unknown} value */
const idOf = (value) => str(/** @type {any} */ (value)?.id);
/** @param {string} value */
const splitList = (value) => [...new Set(value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean))];
/** @param {string} status */
const statusText = (status) => {
  const pair = /** @type {Record<string, string[]>} */ (STATUS)[status];
  return pair ? tt(pair[0], pair[1]) : status;
};

/** @param {unknown} value */
function mcpAcceptsQueryOnly(value) {
  const schema = /** @type {any} */ (value && typeof value === 'object' ? value : {});
  const required = Array.isArray(schema.required) ? schema.required : [];
  return schema.type === 'object'
    && schema.properties?.query?.type === 'string'
    && required.every((/** @type {unknown} */ field) => field === 'query');
}

/** @param {McpServerInfo[]} servers */
function composerHTML(servers) {
  if (!state.composing) return '';
  if (!rt.available('agentExecution')) return `<section class="sec agent-task-compose"><div class="agent-task-heading"><h2 class="sectitle">${tt('桌面版执行', 'Desktop execution')}<span class="dot">.</span></h2><button class="btn-text" data-radar-close>${tt('收起', 'Close')}</button></div><p class="agent-task-note">${tt('网页端只展示从桌面备份导入的机会，不会伪装搜索、验链、写报告或接受岗位。', 'The web version only displays opportunities imported from desktop backups. It does not pretend to search, verify, write reports, or accept jobs.')}</p></section>`;
  const tools = servers.flatMap((server) => server.connected ? server.tools.filter((tool) => tool.readOnly && mcpAcceptsQueryOnly(tool.inputSchema)).map((tool) => ({ server: server.name, tool: tool.name, description: tool.description })) : []);
  return `<section class="sec agent-task-compose">
    <div class="agent-task-heading"><div><p class="seclabel">— NEW RADAR</p><h2 class="sectitle">${tt('配置机会雷达', 'Configure opportunity radar')}<span class="dot">.</span></h2></div><button class="btn-text" data-radar-close>${tt('收起', 'Close')}</button></div>
    <p class="agent-task-copy">${tt('查询只发送职业关键词，不发送个人资料、联系方式或简历。候选先进入待审区，绝不会自动投递。', 'Queries contain professional keywords only—never profile, contact, or resume data. Candidates enter review first and are never auto-applied.')}</p>
    <div class="field-row"><div class="field"><label>${tt('目标职位（逗号分隔）', 'Target roles (comma-separated)')}</label><input class="input" data-radar-roles placeholder="Backend Engineer, Platform Engineer"></div><div class="field"><label>${tt('职级', 'Seniority')}</label><input class="input" data-radar-seniority placeholder="Senior, Staff"></div></div>
    <div class="field-row"><div class="field"><label>${tt('地点', 'Locations')}</label><input class="input" data-radar-locations placeholder="Remote, Seattle"></div><div class="field"><label>${tt('必备技能', 'Required skills')}</label><input class="input" data-radar-skills placeholder="Rust, SQL"></div></div>
    <div class="field-row"><div class="field"><label>${tt('远程偏好', 'Remote preference')}</label><select class="select" data-radar-remote><option value="any">${tt('不限', 'Any')}</option><option value="remote">${tt('远程', 'Remote')}</option><option value="hybrid">${tt('混合', 'Hybrid')}</option><option value="onsite">${tt('现场', 'On-site')}</option></select></div><div class="field"><label>${tt('排除关键词', 'Excluded keywords')}</label><input class="input" data-radar-excluded placeholder="unpaid, contract"></div></div>
    <div class="field"><label>${tt('关注公司', 'Watched companies')}</label><input class="input" data-radar-companies placeholder="Acme"></div>
    <div class="field"><label>${tt('固定招聘页 URL（每行一个）', 'Official careers URLs (one per line)')}</label><textarea class="textarea" data-radar-urls style="min-height:88px" placeholder="https://example.com/careers"></textarea></div>
    <div class="field"><label>${tt('只读搜索 MCP（可多选）', 'Read-only search MCP tools')}</label><div class="agent-task-choices">${tools.length ? tools.map((item) => `<label class="agent-task-choice"><input type="checkbox" data-radar-mcp data-server="${cEsc(item.server)}" data-tool="${cEsc(item.tool)}"><span><b>${cEsc(item.server)} · ${cEsc(item.tool)}</b><small>${cEsc(item.description)}</small></span></label>`).join('') : `<p class="agent-task-muted">${tt('没有已连接的只读 MCP；可以仅使用上方固定 URL。搜索工具还必须声明字符串 query 参数，Rust 会再次校验。', 'No connected read-only MCP tools. You can use fixed URLs only. Search tools must also declare a string query parameter; Rust verifies this again.')}</p>`}</div></div>
    <div class="agent-task-permission"><b>${tt('固定权限', 'Fixed permissions')}</b><span>job_opportunities</span><span>read_only · external_read · local_create</span><span>${tt('最多 4 条查询 / 12 次来源调用 / 40 条候选 / 1 次模型调用', 'Up to 4 queries / 12 source calls / 40 candidates / 1 model call')}</span></div>
    <label class="agent-task-choice radar-schedule"><input type="checkbox" data-radar-schedule><span><b>${tt('创建定时计划', 'Create a schedule')}</b><small>${tt('仅 Seeker 开着时触发；错过不补跑', 'Runs only while Seeker is open; missed runs are not replayed')}</small></span></label>
    <div class="field-row" data-radar-schedule-options hidden><div class="field"><label>${tt('频率', 'Repeat')}</label><select class="select" data-radar-kind><option value="daily">${tt('每天', 'Daily')}</option><option value="weekly">${tt('每周', 'Weekly')}</option></select></div><div class="field"><label>${tt('时间', 'Time')}</label><input class="input" type="time" data-radar-time value="09:00"></div></div>
    <div class="agent-task-actions"><button class="btn" data-radar-close>${tt('取消', 'Cancel')}</button><button class="btn btn-accent" data-radar-create>${tt('创建并前往检查', 'Create and review')} →</button></div>
  </section>`;
}

/** @param {JobOpportunity[]} opportunities */
function listHTML(opportunities) {
  const visible = opportunities.filter((item) => state.filter === 'all' || (state.filter === 'active' ? !['dismissed', 'stale'].includes(item.status) : item.status === state.filter));
  if (!visible.length) return `<div class="guide-step"><span class="gnum">— 01</span><div><h3>${tt('还没有符合筛选条件的机会', 'No opportunities match this filter')}</h3><p>${tt('创建雷达任务并在任务中心检查、运行。通过验链和去重的候选会出现在这里。', 'Create a radar task, review it in the task center, and run it. Candidates that pass verification and deduplication appear here.')}</p></div></div>`;
  return `<div class="radar-grid">${visible.map((item) => {
    const sourceTrusted = item.sourceVerified === true;
    const actions = rt.available('agentExecution') && item.status !== 'accepted'
      ? `<button class="btn" data-radar-status="reviewed" data-opportunity="${cEsc(idOf(item))}">${tt('标为已审', 'Mark reviewed')}</button><button class="btn" data-radar-status="dismissed" data-opportunity="${cEsc(idOf(item))}">${tt('拒绝', 'Dismiss')}</button>${sourceTrusted ? `<button class="btn btn-accent" data-radar-accept="${cEsc(idOf(item))}">${tt('接受为岗位', 'Accept as job')} →</button>` : ''}`
      : '';
    return `<article class="radar-card ${sourceTrusted ? '' : 'is-unverified'}"><div class="radar-card-head"><div><span class="agent-task-status ${item.status === 'accepted' ? 'is-ok' : ''}">${cEsc(statusText(item.status))}</span><span class="agent-artifact-trust">${sourceTrusted ? tt('来源已验证', 'Source verified') : tt('来源未验证 / 不能接受', 'Source unverified / cannot accept')}</span><h3>${cEsc(item.company)} · ${cEsc(item.role || item.title)}</h3></div><strong>${Number(item.matchScore || 0).toFixed(1)}</strong></div><p>${cEsc(item.summary || tt('暂无摘要', 'No summary'))}</p><div class="radar-meta"><span>${cEsc(item.location || '—')}</span><span>${cEsc(item.remote || '—')}</span><span>${cEsc(new Date(item.observedAt).toLocaleDateString())}</span></div><div class="radar-skills">${(item.requiredSkills || []).slice(0, 8).map((skill) => `<span>${cEsc(skill)}</span>`).join('')}</div><div class="agent-task-actions"><button class="btn-text" data-radar-open="${cEsc(item.url)}">${tt('查看来源', 'Open source')}</button>${actions}</div></article>`;
  }).join('')}</div>`;
}

async function refresh() {
  const host = $('#page-opportunities');
  if (!host) return;
  try {
    const [opportunities, servers] = await Promise.all([
      rt.agent.listOpportunities(),
      state.composing && rt.available('agentExecution') ? rt.mcp.list() : Promise.resolve([]),
    ]);
    opportunities.sort((a, b) => Number(b.matchScore || 0) - Number(a.matchScore || 0) || Number(b.observedAt || 0) - Number(a.observedAt || 0));
    host.innerHTML = frontis('OPPORTUNITY RADAR', tt('机会雷达', 'Opportunity radar')) + composerHTML(servers) + `<section class="sec"><div class="agent-task-heading"><div><p class="seclabel">— REVIEW QUEUE</p><h2 class="sectitle">${tt('候选机会', 'Candidate opportunities')}<span class="dot">.</span></h2></div><div class="radar-filters"><button class="btn-text" data-radar-filter="active">${tt('待处理', 'Active')}</button><button class="btn-text" data-radar-filter="accepted">${tt('已接受', 'Accepted')}</button><button class="btn-text" data-radar-filter="dismissed">${tt('已拒绝', 'Dismissed')}</button><button class="btn-text" data-radar-filter="all">${tt('全部', 'All')}</button></div></div>${listHTML(opportunities)}</section>` + signFoot();
    wire();
  } catch (error) {
    host.innerHTML = frontis('OPPORTUNITY RADAR', tt('机会雷达', 'Opportunity radar')) + `<section class="sec"><p class="agent-task-error">${tt('读取失败：', 'Could not load: ')}${errText(error)}</p></section>` + signFoot();
  }
}

function wire() {
  $$('#page-opportunities [data-radar-new]').forEach((node) => { /** @type {HTMLElement} */ (node).onclick = openOpportunityComposer; });
  $$('#page-opportunities [data-radar-close]').forEach((node) => { /** @type {HTMLElement} */ (node).onclick = () => { state.composing = false; void refresh(); }; });
  const schedule = /** @type {HTMLInputElement|null} */ ($('#page-opportunities [data-radar-schedule]'));
  if (schedule) schedule.onchange = () => { const row = /** @type {HTMLElement|null} */ ($('#page-opportunities [data-radar-schedule-options]')); if (row) row.hidden = !schedule.checked; };
  const create = /** @type {HTMLButtonElement|null} */ ($('#page-opportunities [data-radar-create]'));
  if (create) create.onclick = () => { void createRadar(create); };
  $$('#page-opportunities [data-radar-filter]').forEach((node) => { /** @type {HTMLElement} */ (node).onclick = () => { state.filter = str(/** @type {HTMLElement} */ (node).dataset.radarFilter); void refresh(); }; });
  $$('#page-opportunities [data-radar-open]').forEach((node) => { /** @type {HTMLElement} */ (node).onclick = () => { void rt.web.open(str(/** @type {HTMLElement} */ (node).dataset.radarOpen)).catch((error) => toast(errText(error))); }; });
  $$('#page-opportunities [data-radar-status]').forEach((node) => { /** @type {HTMLElement} */ (node).onclick = () => { const el = /** @type {HTMLElement} */ (node); void setStatus(str(el.dataset.opportunity), /** @type {'reviewed'|'dismissed'} */ (el.dataset.radarStatus)); }; });
  $$('#page-opportunities [data-radar-accept]').forEach((node) => { /** @type {HTMLElement} */ (node).onclick = () => { void acceptOpportunity(str(/** @type {HTMLElement} */ (node).dataset.radarAccept)); }; });
}

/** @param {HTMLButtonElement} button */
async function createRadar(button) {
  if (state.busy) return;
  const roles = splitList(str(/** @type {HTMLInputElement|null} */ ($('#page-opportunities [data-radar-roles]'))?.value));
  const urls = splitList(str(/** @type {HTMLTextAreaElement|null} */ ($('#page-opportunities [data-radar-urls]'))?.value));
  if (!roles.length) { toast(tt('请至少填写一个目标职位', 'Add at least one target role')); return; }
  if (urls.some((url) => !/^https?:\/\//i.test(url))) { toast(tt('固定来源仅支持 HTTP/HTTPS URL', 'Fixed sources must use HTTP/HTTPS URLs')); return; }
  const mcp = $$('#page-opportunities [data-radar-mcp]').filter((node) => /** @type {HTMLInputElement} */ (node).checked).map((node) => ({ kind: /** @type {'mcp'} */ ('mcp'), server: str(/** @type {HTMLElement} */ (node).dataset.server), tool: str(/** @type {HTMLElement} */ (node).dataset.tool) }));
  const sources = [...urls.map((url) => ({ kind: /** @type {'url'} */ ('url'), url })), ...mcp];
  if (!sources.length) { toast(tt('请至少选择一个固定 URL 或只读搜索 MCP', 'Choose at least one fixed URL or read-only search MCP')); return; }
  state.busy = true; button.disabled = true;
  try {
    const task = await rt.agent.createTask({
      workflowId: 'job_opportunity_radar', title: tt('机会雷达扫描', 'Opportunity radar scan'),
      goal: tt('发现、验证并整理值得审阅的岗位机会', 'Discover, verify, and organize opportunities worth reviewing'),
      inputs: { criteria: { roles, seniority: splitList(str(/** @type {HTMLInputElement|null} */ ($('#page-opportunities [data-radar-seniority]'))?.value)), locations: splitList(str(/** @type {HTMLInputElement|null} */ ($('#page-opportunities [data-radar-locations]'))?.value)), remotePreference: /** @type {any} */ (/** @type {HTMLSelectElement} */ ($('#page-opportunities [data-radar-remote]')).value), requiredSkills: splitList(str(/** @type {HTMLInputElement|null} */ ($('#page-opportunities [data-radar-skills]'))?.value)), excludedKeywords: splitList(str(/** @type {HTMLInputElement|null} */ ($('#page-opportunities [data-radar-excluded]'))?.value)), watchedCompanies: splitList(str(/** @type {HTMLInputElement|null} */ ($('#page-opportunities [data-radar-companies]'))?.value)) }, sources, language: 'zh' },
    });
    const schedule = /** @type {HTMLInputElement|null} */ ($('#page-opportunities [data-radar-schedule]'));
    let scheduleError = '';
    if (schedule?.checked) {
      const now = Date.now();
      try {
        await saveSchedule({ id: `sc_${idOf(task)}`, agentTaskId: idOf(task), kind: /** @type {any} */ (/** @type {HTMLSelectElement} */ ($('#page-opportunities [data-radar-kind]')).value), time: str(/** @type {HTMLInputElement} */ ($('#page-opportunities [data-radar-time]')).value), dow: 1, enabled: true, created_at: now, last_run_at: 0, last_status: '', updated_at: now });
      } catch (error) {
        scheduleError = errText(error);
      }
    }
    state.composing = false;
    toast(scheduleError
      ? tt('雷达任务已创建，但定时计划保存失败：', 'Radar task created, but its schedule could not be saved: ') + scheduleError
      : tt('雷达任务已创建，请在任务中心检查后启动', 'Radar task created; review and start it in the task center'));
    go('tasks');
  } catch (error) { toast(tt('创建失败：', 'Create failed: ') + errText(error)); }
  finally { state.busy = false; button.disabled = false; }
}

/** @param {string} id @param {'reviewed'|'dismissed'} status */
async function setStatus(id, status) {
  try { await rt.agent.setOpportunityStatus(id, status); await refresh(); }
  catch (error) { toast(errText(error)); }
}

/** @param {string} id */
async function acceptOpportunity(id) {
  try {
    const result = await rt.agent.acceptOpportunity(id);
    await hydrateJobs();
    await refresh();
    toastUndo(tt('机会已加入目标岗位', 'Opportunity added to tracked jobs'), async () => {
      try { await rt.agent.undoOpportunity(result.undoToken); await hydrateJobs(); await refresh(); return true; }
      catch (error) { toast(errText(error)); return false; }
    });
  } catch (error) { toast(errText(error)); }
}

export function openOpportunityComposer() { state.composing = true; void refresh(); }
export function renderOpportunities() { void refresh(); }
