// @ts-check
import {tt} from './i18n.js';
import {openModal} from './modal.js';
import {currentProjectId} from './project-state.js';
import {hydrateConversations} from './conversation-store.js';
import {hydrateMessages} from './copilot-chrome.js';
import {aiStreamBusy} from './ai-engine.js';
import {clearCollectionsSafely} from '../runtime/data-clear.js';
import {errText,toast} from './toast.js';

export async function openHistoryManager(){
  const rt=window.SeekerRT;
  const m=openModal(`<div class="modal-head"><h2>${tt('会话历史','Chat history')}</h2><button class="x">×</button></div><div class="modal-body"><label for="historyScope">${tt('查看范围','View scope')}</label><select class="select" id="historyScope"><option value="current">${tt('当前工作空间','Current workspace')}</option><option value="all">${tt('全部工作空间','All workspaces')}</option></select><div id="histBody" style="margin-top:16px;"></div></div><div class="modal-foot"><button class="btn" id="histClear">${tt('备份并清除全部空间会话','Back up and clear all workspace chats')}</button><button class="btn" data-close>${tt('完成','Done')}</button></div>`,true);
  if(!m)return;
  const body=/** @type {HTMLElement} */(m.querySelector('#histBody'));
  const scope=/** @type {HTMLSelectElement} */(m.querySelector('#historyScope'));
  const clear=/** @type {HTMLButtonElement} */(m.querySelector('#histClear'));
  const render=async()=>{
    clear.disabled=true;body.textContent=tt('读取中…','Loading…');
    try{
      const all=await rt.db.list('messages');if(!body.isConnected)return;
      const rows=all.filter(r=>scope.value==='all'||(r.projectId||'')===currentProjectId()).sort((a,b)=>Number(a.ts||0)-Number(b.ts||0));
      body.replaceChildren();const total=document.createElement('p');total.textContent=rows.length+tt(' 条消息',' messages');body.appendChild(total);
      for(const r of rows){const entry=document.createElement('div');entry.style.cssText='border-bottom:.5px solid var(--border);padding:12px 0;white-space:pre-wrap;overflow-wrap:anywhere;';entry.textContent=(r.role==='user'?tt('我','Me'):'Seeker')+' · '+new Date(Number(r.ts)||0).toLocaleString()+'\n'+String(r.text||'');body.appendChild(entry);}
      clear.disabled=!all.length;
    }catch(e){body.textContent=tt('历史未能读取：','Could not load history: ')+errText(e);}
  };
  scope.onchange=()=>{void render();};await render();
  clear.onclick=()=>{
    if(aiStreamBusy()){toast(tt('请先停止当前回答再清除。','Stop the current answer before clearing.'));return;}
    window.SeekerGuardrail?.confirmDestructive({title:tt('清除全部工作空间的会话？','Clear chats in all workspaces?'),
      detail:tt('将先保存完整 JSON 备份，再一次性清除所有空间的对话和消息。工作空间、资料、作品与任务保留。可通过设置导入备份恢复；备份失败不会删除。','Save a full JSON backup, then clear conversations and messages across all workspaces in one transaction. Workspaces, materials, creations and tasks are kept. Restore by importing the backup in Settings; backup failure prevents deletion.'),
      confirmLabel:tt('备份并清除','Back up and clear'),
      onConfirm:async()=>{
        if(aiStreamBusy())throw new Error(tt('请先停止当前回答','Stop the current answer first'));
        let result;
        try{result=await clearCollectionsSafely(rt,['messages','platform_conversations']);}
        catch(e){toast(tt('清除失败，未报告成功：','Clear failed; no success was reported: ')+errText(e));return false;}
        toast(tt('已清除，恢复备份：','Cleared. Recovery backup: ')+result.backupPath);
        try{await hydrateConversations();await hydrateMessages();await render();}
        catch(e){toast(tt('会话已清除，界面刷新失败，请重新打开：','Chats were cleared, but the view could not refresh. Reopen it: ')+errText(e));}
      }});
  };
}
