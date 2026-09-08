// @ts-check
import { tt } from './i18n.js';
import { $ } from './dom.js';
import { frontis, signFoot, go } from './nav.js';
import { startNewConversation, openConversation } from './copilot-chrome.js';
import { listConversations, conversationTitle } from './conversation-store.js';
import { toast, errText } from './toast.js';
import { openTask } from './tasks.js';
import { openModelSettings } from './settings.js';

let draft='',starting=false;

export function renderHome() {
  const host = $('#page-home'); if (!host) return;
  host.innerHTML = frontis('EVERYDAY', tt('今天，想完成什么', 'What would you like to do today'))
    + '<div class="sec"><p style="font-size:15px;line-height:1.9;color:var(--ink-2);">'+tt('提问、处理文字，或把有用的信息留在自己的资料库。','Ask a question, work on text, or keep useful information in your own library.')+'</p><label for="homeInput" style="display:block;margin:16px 0 8px;">'+tt('从一个问题开始','Start with a question')+'</label><textarea class="input" id="homeInput" rows="3" style="width:100%;resize:vertical;" placeholder="'+tt('例如：帮我把这段话写得更清楚。','For example: help me make this paragraph clearer.')+'"></textarea><button class="btn btn-accent" id="homeSend" style="margin-top:10px;" '+(starting?'disabled':'')+'>'+tt('新建对话并发送','Start a chat and send')+' →</button><div id="homeShortcuts" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:20px;"></div></div>'
    + '<div class="sec"><h3>'+tt('最近对话','Recent conversations')+'</h3><div id="homeConversations"></div></div>'
    + '<div class="sec"><h3>'+tt('最近资料','Recent materials')+'</h3><div id="homeMaterials"></div></div>'
    + '<div class="sec"><h3>'+tt('最近任务','Recent tasks')+'</h3><div id="homeTasks"></div></div>'
    + '<div class="sec" style="border-bottom:none;"><p style="color:var(--ink-3);">'+tt('数据保存在本机。使用云端模型时，你提交的内容会发送给所选服务商。','Data is stored on this device. When using a cloud model, submitted content is sent to your selected provider.')+'</p><button class="btn" id="homeModels">'+tt('连接模型','Connect a model')+'</button></div>'+signFoot();
  const actions = [{label:tt('开始对话','Start a conversation'),run:()=>{startNewConversation();}},...window.SeekerShell.homeActions()];
  const shortcuts = host.querySelector('#homeShortcuts');
  for (const {label, run} of actions) {
    const button = document.createElement('button'); button.className='btn'; button.textContent=label;
    button.onclick=run;
    shortcuts?.appendChild(button);
  }
  const list = host.querySelector('#homeConversations');
  for (const c of listConversations().slice(0, 6)) {
    const button = document.createElement('button'); button.className='btn-text'; button.style.cssText='display:block;text-align:left;margin:12px 0;'; button.textContent=conversationTitle(c);
    button.onclick=()=>{openConversation(c.id).catch(e=>toast(errText(e)));}; list?.appendChild(button);
  }
  if(list && !list.childElementCount) list.textContent=tt('还没有对话。从一个问题开始吧。','No conversations yet. Start with a question.');
  const input=/** @type {HTMLTextAreaElement} */(host.querySelector('#homeInput'));input.value=draft;input.oninput=()=>{draft=input.value;};
  const send=async()=>{const text=draft.trim();if(!text||starting)return;starting=true;const button=/** @type {HTMLButtonElement} */(host.querySelector('#homeSend'));button.disabled=true;
    try{if(await startNewConversation()){draft='';renderHome();const chat=/** @type {HTMLTextAreaElement} */($('#agentInput'));chat.value=text;/** @type {HTMLButtonElement} */($('#agentSend')).click();}}
    finally{starting=false;const current=/** @type {HTMLButtonElement|null} */(host.querySelector('#homeSend'));if(current)current.disabled=false;}
  };
  /** @type {HTMLButtonElement} */(host.querySelector('#homeSend')).onclick=()=>{void send();};input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void send();}};
  const models=/** @type {HTMLButtonElement} */ (host.querySelector('#homeModels')); models.onclick=openModelSettings;
  const tasks=host.querySelector('#homeTasks');
  window.SeekerRT.agent.listTasks().then(items=>{
    if(!tasks?.isConnected)return;
    for(const item of items.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0)).slice(0,6)){const button=document.createElement('button');button.className='btn-text';button.style.cssText='display:block;text-align:left;margin:12px 0;';button.textContent=item.title;button.onclick=()=>{openTask(item.id);go('tasks');};tasks.appendChild(button);}
    if(!items.length)tasks.textContent=tt('从任务中心创建一份资料整理报告。','Create a material report in Tasks.');
  }).catch(()=>{if(tasks)tasks.textContent=tt('暂时无法加载任务。','Could not load tasks.');});
  const materials=host.querySelector('#homeMaterials');
  window.SeekerShell.recentItems().then(items=>{
    if(!materials?.isConnected)return;
    for(const item of items){const button=document.createElement('button');button.className='btn-text';button.style.cssText='display:block;text-align:left;margin:12px 0;';button.textContent=item.title;button.onclick=item.open;materials.appendChild(button);}
    if(!items.length)materials.textContent=tt('保存一条笔记后，可以从这里再次打开。','Save a note to find it here next time.');
  }).catch(()=>{if(materials)materials.textContent=tt('暂时无法加载最近资料，请在资料库重试。','Could not load recent materials. Retry in Library.');});
}
window.addEventListener('seeker-conversations-changed', renderHome);
window.addEventListener('seeker-library-changed', renderHome);
window.addEventListener('seeker-rt-ready', renderHome);
