// @ts-check
import {tt} from './i18n.js';
import {$} from './dom.js';
import {frontis,signFoot} from './nav.js';
import {cEsc,renderProjectSwitch,switchProject} from './copilot-chrome.js';
import {renderProjects} from './projects.js';
import {currentProjectId} from './project-state.js';
import {hydrateProjects,listProjects} from './project-store.js';
import {workspacePreferences,saveWorkspacePreferences} from './workspace-preferences.js';
import {toast,errText} from './toast.js';

export function renderWorkspaces(){
  const host=$('#page-workspaces');if(!host)return;
  host.innerHTML=frontis('WORKSPACES',tt('工作空间','Workspaces'))+'<div class="sec" id="workspaceSettings"></div>'+signFoot();
  void renderWorkspaceSettings(/** @type {HTMLElement} */(host.querySelector('#workspaceSettings')));
}

/** @param {HTMLElement} host */
export async function renderWorkspaceSettings(host){
  const loaded=await hydrateProjects();if(!host.isConnected)return;
  if(!loaded){host.textContent=tt('无法读取工作空间，请重新打开重试。','Could not load workspaces. Reopen to retry.');return;}
  const prefs=workspacePreferences();
  const pages=window.SeekerShell.pages().filter(p=>!p.hidden);
  const baseName=prefs.name||tt('日常','Everyday');
  const projects=listProjects().filter(p=>!p.archived);
  host.innerHTML=`<p style="color:var(--ink-2);line-height:1.8;">${tt('为学习、工作或生活分别建立工作空间，每个空间拥有自己的对话和助手指令。资料库、任务、应用开关及模型连接由本机所有工作空间共享。','Create workspaces for learning, work or life, each with its own conversations and assistant instructions. Library, tasks, app switches and model connections are shared on this device.')}</p>
    <div class="set-row"><label for="workspaceCurrent">${tt('当前工作空间','Current workspace')}</label><select class="select" id="workspaceCurrent"><option value="">${cEsc(baseName)}</option>${projects.map(p=>`<option value="${cEsc(p.id)}">${cEsc(p.name)}</option>`).join('')}</select></div>
    <div id="workspaceProjects" style="margin:18px 0;"></div>
    <h3>${tt('本机工作台偏好','Device workspace preferences')}</h3>
    <div class="set-row"><label for="workspaceName">${tt('默认空间名称','Default workspace name')}</label><input class="input" maxlength="80" id="workspaceName" value="${cEsc(prefs.name)}" placeholder="${tt('日常','Everyday')}"></div>
    <div class="set-row"><label for="workspaceStart">${tt('启动时打开','Open on launch')}</label><select class="select" id="workspaceStart">${pages.map(p=>`<option value="${cEsc(p.id)}">${cEsc(tt(p.label,p.en))}</option>`).join('')}</select></div>
    <div class="set-row"><span>${tt('首页展示','Show on Home')}</span><div><label><input type="checkbox" id="workspaceMaterials" ${prefs.showMaterials?'checked':''}> ${tt('最近资料','Recent materials')}</label> <label><input type="checkbox" id="workspaceTasks" ${prefs.showTasks?'checked':''}> ${tt('最近任务','Recent tasks')}</label></div></div>
    <button class="btn btn-accent" id="workspaceSave">${tt('保存偏好','Save preferences')}</button><p id="workspaceStatus" role="status"></p>
    <h3 style="margin-top:28px;">${tt('使用哪些应用','Choose your apps')}</h3><p style="color:var(--ink-3);">${tt('关闭只隐藏入口并停用能力，已有数据继续保留。','Disabling an app hides its pages and tools; existing data is kept.')}</p><div id="workspaceApps"></div>`;
  const select=/** @type {HTMLSelectElement} */(host.querySelector('#workspaceCurrent'));select.value=currentProjectId();
  select.onchange=async()=>{await switchProject(select.value);await renderProjectSwitch();await renderWorkspaceSettings(host);};
  const start=/** @type {HTMLSelectElement} */(host.querySelector('#workspaceStart'));start.value=pages.some(p=>p.id===prefs.startPage)?prefs.startPage:'home';
  /** @type {HTMLButtonElement} */(host.querySelector('#workspaceSave')).onclick=()=>{
    const status=/** @type {HTMLElement} */(host.querySelector('#workspaceStatus'));
    try{
      saveWorkspacePreferences({name:/** @type {HTMLInputElement} */(host.querySelector('#workspaceName')).value,startPage:start.value,
        showMaterials:/** @type {HTMLInputElement} */(host.querySelector('#workspaceMaterials')).checked,showTasks:/** @type {HTMLInputElement} */(host.querySelector('#workspaceTasks')).checked});
      status.textContent=tt('偏好已保存，启动页面将在下次打开时生效。','Preferences saved. The launch page applies next time you open the app.');
      select.options[0].text=workspacePreferences().name||tt('日常','Everyday');
      void renderProjectSwitch();
    }catch(e){status.textContent=tt('未能保存：','Could not save: ')+errText(e);}
  };
  const apps=/** @type {HTMLElement} */(host.querySelector('#workspaceApps'));
  for(const app of window.SeekerShell.ordered()){
    const row=document.createElement('div');row.className='set-row';
    const label=document.createElement('span');label.textContent=tt(app.name.zh,app.name.en);row.appendChild(label);
    const button=document.createElement('button');button.className='btn';button.dataset.workspaceApp=app.id;
    button.textContent=window.SeekerShell.enabled(app.id)?tt('已开启 · 关闭','Enabled · Disable'):tt('已关闭 · 开启','Disabled · Enable');
    button.setAttribute('aria-pressed',String(window.SeekerShell.enabled(app.id)));
    button.onclick=()=>{try{window.SeekerShell.setEnabled(app.id,!window.SeekerShell.enabled(app.id));void renderWorkspaceSettings(host);}catch(e){toast(tt('未能保存：','Could not save: ')+errText(e));}};
    row.appendChild(button);apps.appendChild(row);
  }
  await renderProjects(/** @type {HTMLElement} */(host.querySelector('#workspaceProjects')));
}

window.addEventListener('seeker-workspaces-changed',()=>{
  const host=$('#workspaceSettings');if(host?.isConnected)void renderWorkspaceSettings(/** @type {HTMLElement} */(host));
});
