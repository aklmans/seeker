// @ts-check
import {tt} from './i18n.js';
import {currentProjectId} from './project-state.js';
import {listProjects} from './project-store.js';
import {workspacePreferences} from './workspace-preferences.js';
import {go} from './nav.js';

/** Metadata only; never send these records to AI. @param {HTMLElement|null} host */
export async function renderDataSummary(host){
  if(!host)return;
  host.textContent=tt('读取本机数据概览…','Loading device data overview…');
  const rt=window.SeekerRT;if(!rt){host.textContent=tt('数据尚未就绪，请重新打开设置。','Data is not ready. Reopen Settings.');return;}
  const groups=[{label:tt('工作空间会话','Workspace conversations'),collections:['platform_conversations','messages'],page:'workspaces'},
    {label:tt('作品与样式（含已移除作品）','Creations and styles (including removed items)'),collections:['platform_creations'],page:'creations'},
    ...window.SeekerShell.list().map(a=>({label:tt(a.name.zh,a.name.en)+(window.SeekerShell.enabled(a.id)?'':tt('（已关闭，数据保留）',' (disabled, data kept)')),collections:a.collections||[],page:'workspaces'})),
    {label:tt('任务记录（所有空间共享）','Tasks (shared across workspaces)'),collections:['platform_agent_tasks'],page:'tasks'}];
  const results=await Promise.all(groups.map(async g=>{
    try{return {g,rows:await Promise.all(g.collections.map(c=>rt.db.list(/** @type {import('../runtime/types').Collection} */(c))))};}
    catch{return {g,rows:null};}
  }));
  if(!host.isConnected)return;host.replaceChildren();
  const name=listProjects().find(p=>p.id===currentProjectId())?.name||workspacePreferences().name||tt('日常','Everyday');
  const heading=document.createElement('p');heading.textContent=tt('当前空间：','Current workspace: ')+name;host.appendChild(heading);
  for(const {g,rows} of results){
    const row=document.createElement('div');row.className='set-row';const label=document.createElement('span');label.textContent=g.label;row.appendChild(label);
    const count=document.createElement('span');
    count.textContent=rows===null?tt('读取失败，请重试','Could not load; retry'):String(rows.reduce((n,list)=>n+list.length,0))+tt(' 条本机记录',' device records');
    if(rows && g.collections[0]==='platform_conversations')count.textContent=tt('当前空间消息 ','Messages here: ')+rows[1].filter(r=>(r.projectId||'')===currentProjectId()).length+tt(' 条；全部空间消息 ','; all workspaces: ')+rows[1].length;
    row.appendChild(count);host.appendChild(row);
  }
  const button=document.createElement('button');button.className='btn';button.textContent=tt('管理工作空间与应用','Manage workspaces and apps');button.onclick=()=>go('workspaces');host.appendChild(button);
}
