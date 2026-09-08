// @ts-check
import { rt } from '../../platform/runtime/index.js';
import { tt } from '../../platform/shell/i18n.js';
import { cEsc } from '../../platform/shell/copilot-chrome.js';
import { toast,errText } from '../../platform/shell/toast.js';
import { noteTitle } from './note-store.js';

/** @param {HTMLElement} host @param {(id:string)=>void} onCreated */
async function compose(host,onCreated){
  const [documents,notes]=await Promise.all([rt.library.list(),rt.db.list('assets_notes')]);
  if(!host.isConnected)return;
  const choices=[...documents.filter(d=>!d.invalid).map(d=>({kind:/** @type {'document'} */('document'),id:d.id,title:d.name,characters:d.characters,updated:d.updated})),...notes.filter(n=>typeof n.text==='string'&&n.text.trim()).map(n=>({kind:/** @type {'note'} */('note'),id:n.id,title:noteTitle(/** @type {any} */(n)),characters:[...String(n.text)].length,updated:Number(n.updated)||0}))];
  host.innerHTML=`<p class="agent-task-copy">${tt('选择 1–5 份文件或笔记，说明想整理什么。创建后会保存本次资料快照；仅在开始执行时，把这些资料发送给当前模型。','Choose 1–5 files or notes and describe your goal. Creating the task saves these source snapshots. They go to the current model only when you start the run.')}</p><p class="agent-task-note">${tt('交付 Markdown 和 DOCX 报告，包含概览、分材料要点、综合整理、资料缺口与来源。所选正文合计最多 30,000 字符。','Receive Markdown and DOCX reports with an overview, source summaries, synthesis, gaps and references. Selected source text must total at most 30,000 characters.')}</p><div class="field"><label>${tt('任务名称','Task name')}</label><input class="input" id="materialTaskTitle" value="${tt('资料整理报告','Material report')}"></div><div class="field"><label>${tt('整理目标','Goal')}</label><textarea class="input" id="materialTaskGoal" rows="3" style="width:100%;" placeholder="${tt('例如：整理主要特点、共同点、差异和待确认问题。','For example: summarize key features, similarities, differences and open questions.')}" aria-label="${tt('整理目标','Goal')}"></textarea></div><div class="field"><label>${tt('选择资料','Select sources')}</label>${choices.length?`<div class="agent-task-choices" style="max-height:320px;overflow:auto;">${choices.map((c,i)=>`<label class="agent-task-choice"><input type="checkbox" data-material-choice="${i}" ${c.characters>30000?'disabled':''}><span><b>${cEsc(c.title)}</b><small>${c.kind==='note'?tt('笔记','Note'):tt('文件','File')} · ${c.characters.toLocaleString()} ${tt('字符','characters')}${c.characters>30000?' · '+tt('请先拆分','Split this source first'):''}</small></span></label>`).join('')}</div>`:`<p>${tt('请先在资料库导入文件或保存笔记。','Import a file or save a note in Library first.')}</p>`}</div><p id="materialSelectionCount" role="status"></p><div class="field"><label>${tt('报告语言','Report language')}</label><select class="select" id="materialTaskLanguage"><option value="zh" ${tt('zh','en')==='zh'?'selected':''}>中文</option><option value="en" ${tt('zh','en')==='en'?'selected':''}>English</option></select></div><button class="btn btn-accent" data-agent-create ${choices.length?'':'disabled'}>${tt('创建并检查','Create and review')} →</button>`;
  const selected=()=>[...host.querySelectorAll('[data-material-choice]')].filter(e=>/** @type {HTMLInputElement} */(e).checked).map(e=>choices[Number(/** @type {HTMLElement} */(e).dataset.materialChoice)]).filter(Boolean);
  const update=()=>{const chosen=selected(),node=host.querySelector('#materialSelectionCount');if(node)node.textContent=tt('已选 '+chosen.length+' 份 · ','Selected '+chosen.length+' sources · ')+chosen.reduce((n,c)=>n+c.characters,0).toLocaleString()+tt(' 字符',' characters');};
  host.querySelectorAll('[data-material-choice]').forEach(e=>{/** @type {HTMLInputElement} */(e).onchange=update;});update();
  const create=/** @type {HTMLButtonElement} */(host.querySelector('[data-agent-create]'));
  create.onclick=async()=>{
    const chosen=selected(),goal=/** @type {HTMLTextAreaElement} */(host.querySelector('#materialTaskGoal')).value.trim();
    if(!goal||[...goal].length>2000){toast(tt('请填写 1–2,000 字符的整理目标','Enter a goal of 1–2,000 characters'));return;}
    if(!chosen.length||chosen.length>5){toast(tt('请选择 1–5 份资料','Select 1–5 sources'));return;}
    if(chosen.reduce((n,c)=>n+c.characters,0)>30000){toast(tt('所选资料合计超过 30,000 字符，请减少资料','Selected materials exceed 30,000 characters. Select fewer sources.'));return;}
    create.disabled=true;
    try{const task=await rt.agent.createTask({workflowId:'material_report',title:/** @type {HTMLInputElement} */(host.querySelector('#materialTaskTitle')).value,goal,inputs:{materials:chosen.map(({kind,id,updated})=>({kind,id,updated})),language:/** @type {'zh'|'en'} */(/** @type {HTMLSelectElement} */(host.querySelector('#materialTaskLanguage')).value)}});toast(tt('资料快照已保存，请检查后开始执行','Source snapshots saved. Review them before starting.'));onCreated(task.id);}
    catch(e){toast(errText(e));create.disabled=false;}
  };
}

/** @type {import('../../platform/shell/types').TaskWorkflowUi} */
export const materialTaskWorkflow={
  id:'material_report',name:{zh:'资料整理助手',en:'Material organizer'},order:10,
  requiredArtifacts:['material_report_md','material_report_docx'],artifactNames:{material_report_md:{zh:'资料报告 · Markdown',en:'Material report · Markdown'},material_report_docx:{zh:'资料报告 · DOCX',en:'Material report · DOCX'}},
  permission:{zh:'只使用下方所选资料快照与整理目标，调用当前模型并创建本地报告。',en:'Use only the selected snapshots and goal below, call the current model and create local reports.'},
  success:{zh:'报告结构与引用通过检查，Markdown 和 DOCX 实际写入并重读验证。',en:'Report structure and quotations pass checks; Markdown and DOCX are written and verified by rereading.'},
  compose,
  describe:task=>{const inputs=/** @type {import('../../platform/runtime/types').MaterialTaskInputs} */(task.inputs);const sources=Array.isArray(inputs.snapshot?.sources)?inputs.snapshot.sources:[];return '<div><dt>'+tt('本次资料快照','Selected source snapshots')+'</dt><dd>'+sources.slice(0,5).map(s=>'<details><summary>'+cEsc(s.title)+' · '+Number(s.characters).toLocaleString()+tt(' 字符',' characters')+'</summary><pre style="white-space:pre-wrap;max-height:260px;overflow:auto;">'+cEsc((Array.isArray(s.fragments)?s.fragments:[]).map(f=>'['+s.id+'/'+f.id+']\n'+f.text).join('\n\n'))+'</pre></details>').join('')+'</dd></div><div><dt>'+tt('报告语言','Report language')+'</dt><dd>'+cEsc(inputs.language==='en'?'English':'中文')+'</dd></div>';},
};
