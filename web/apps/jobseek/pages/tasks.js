// @ts-check
/** Job-specific forms contributed to the platform task center. */
import { rt } from '../../../platform/runtime/index.js';
import { tt } from '../../../platform/shell/i18n.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import { toast,errText } from '../../../platform/shell/toast.js';
import { openTaskComposer as openPlatformComposer,renderTasks } from '../../../platform/shell/tasks.js';
import { hasJobContent,hasProfessionalContent } from '../logic/resume-validity.js';
export {renderTasks};
export function openTaskComposer(){openPlatformComposer('job_application_package');}
/** @param {unknown} v */
const str=v=>v==null?'':String(v);
/** @param {any} v */
const idOf=v=>str(v?.id);
/** @param {import('../../../platform/runtime/types').Record} job */
function jobLabel(job){return [str(job.co),str(job.role)].filter(Boolean).join(' · ')||idOf(job);}
/** @param {import('../../../platform/runtime/types').Record[]} jobs @param {import('../../../platform/runtime/types').Record[]} resumes */
function jobComposerHTML(jobs, resumes) {
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


/** @param {HTMLElement} host @param {(id:string)=>void} onCreated */
async function composeJob(host,onCreated){
  const [jobs,resumes]=await Promise.all([rt.db.list('jobs'),rt.db.list('resumes')]);
  if(!host.isConnected)return;host.innerHTML=jobComposerHTML(jobs,resumes);
  const button=/** @type {HTMLButtonElement|null} */(host.querySelector('[data-agent-create]'));if(!button)return;
  button.onclick=async()=>{
    const jobIds=[...host.querySelectorAll('[data-agent-job]')].filter(el=>/** @type {HTMLInputElement} */(el).checked).map(el=>/** @type {HTMLElement} */(el).dataset.agentJob||'');
    const resumeId=/** @type {HTMLSelectElement} */(host.querySelector('[data-agent-resume]')).value;
    if(!jobIds.length||jobIds.length>5){toast(tt('请选择 1–5 个岗位','Choose 1–5 jobs'));return;}
    if(!resumeId){toast(tt('请选择源简历','Choose a source resume'));return;}
    button.disabled=true;
    try{const task=await rt.agent.createTask({workflowId:'job_application_package',title:/** @type {HTMLInputElement} */(host.querySelector('[data-agent-title]')).value,goal:tt('选择最匹配岗位并生成完整、可验证的投递包','Choose the best-matching role and build a verifiable application package'),inputs:{jobIds,resumeId,language:/** @type {'zh'|'en'} */(/** @type {HTMLSelectElement} */(host.querySelector('[data-agent-language]')).value)}});toast(tt('任务已创建，请检查后开始执行','Task created; review it before starting'));onCreated(task.id);}
    catch(e){toast(tt('创建失败：','Create failed: ')+errText(e));button.disabled=false;}
  };
}
/** @type {import('../../../platform/shell/types').TaskWorkflowUi[]} */
export const jobTaskWorkflows=[{
  id:'job_application_package',name:{zh:'岗位投递包',en:'Application package'},order:20,
  requiredArtifacts:['match_report','tailored_resume','cover_letter','interview_checklist'],
  artifactNames:{match_report:{zh:'岗位匹配报告',en:'Job match report'},tailored_resume:{zh:'针对性简历',en:'Tailored resume'},cover_letter:{zh:'求职信草稿',en:'Cover letter draft'},interview_checklist:{zh:'面试准备清单',en:'Interview checklist'}},
  permission:{zh:'读取所选岗位、职业资产与专业简历；创建本地文件。',en:'Read selected jobs, career assets and the professional resume; create local files.'},
  success:{zh:'4 个文件存在、格式有效且摘要一致。',en:'Four files exist, have valid formats and match their hashes.'},compose:composeJob,
  describe:async task=>{const inputs=/** @type {import('../../../platform/runtime/types').JobPackageTaskDraft['inputs']} */(task.inputs);const jobs=await Promise.all((Array.isArray(inputs.jobIds)?inputs.jobIds:[]).slice(0,5).map(id=>rt.db.get('jobs',id)));return '<div><dt>'+tt('岗位输入','Job inputs')+'</dt><dd>'+jobs.map(j=>cEsc(j?jobLabel(j):tt('原岗位已删除','Original job deleted'))).join('<br>')+'</dd></div><div><dt>'+tt('源简历','Source resume')+'</dt><dd>'+cEsc(str(inputs.resumeId))+'</dd></div>';}
},{
  id:'job_opportunity_radar',name:{zh:'机会雷达',en:'Opportunity radar'},order:30,repeatable:true,
  requiredArtifacts:['opportunity_report'],artifactNames:{opportunity_report:{zh:'机会雷达报告',en:'Opportunity radar report'}},
  permission:{zh:'只访问已明确选择的网页或精确 MCP 工具，创建机会报告。',en:'Access only selected pages or exact MCP tools and create an opportunity report.'},
  success:{zh:'候选已验链、去重，报告摘要一致。',en:'Candidates verified and deduplicated; report hash matches.'},
  describe:task=>{const inputs=/** @type {import('../../../platform/runtime/types').OpportunityRadarInputs} */(task.inputs);return '<div><dt>'+tt('目标职位','Target roles')+'</dt><dd>'+(inputs.criteria?.roles||[]).map(cEsc).join('<br>')+'</dd></div><div><dt>'+tt('机会来源','Sources')+'</dt><dd>'+(Array.isArray(inputs.sources)?inputs.sources:[]).map(s=>s.kind==='mcp'?'MCP · '+cEsc(s.server)+'/'+cEsc(s.tool):cEsc(s.url)).join('<br>')+'</dd></div>';}
}];
