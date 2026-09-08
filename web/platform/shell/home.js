// @ts-check
import { tt } from './i18n.js';
import { $ } from './dom.js';
import { frontis, signFoot, go } from './nav.js';
import { startNewConversation, openConversation } from './copilot-chrome.js';
import { listConversations, conversationTitle } from './conversation-store.js';
import { toast, errText } from './toast.js';

export function renderHome() {
  const host = $('#page-home'); if (!host) return;
  host.innerHTML = frontis('EVERYDAY', tt('今天，想完成什么', 'What would you like to do today'))
    + '<div class="sec"><p style="font-size:15px;line-height:1.9;color:var(--ink-2);">'+tt('提问、处理文字，或把有用的信息留在自己的资料库。','Ask a question, work on text, or keep useful information in your own library.')+'</p><div id="homeShortcuts" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:20px;"></div></div>'
    + '<div class="sec"><h3>'+tt('最近对话','Recent conversations')+'</h3><div id="homeConversations"></div></div>'
    + '<div class="sec" style="border-bottom:none;"><p style="color:var(--ink-3);">'+tt('数据保存在本机。使用云端模型时，你提交的内容会发送给所选服务商。','Data is stored on this device. When using a cloud model, submitted content is sent to your selected provider.')+'</p><button class="btn" id="homeModels">'+tt('连接模型','Connect a model')+'</button></div>'+signFoot();
  const actions = [
    [tt('开始对话','Start a conversation'), ''],
    [tt('翻译一段话','Translate text'), tt('请把下面的文字翻译成英文：\n','Translate the following text into Chinese:\n')],
    [tt('润色文字','Polish writing'), tt('请润色下面的文字，保持原意：\n','Polish the following text while preserving its meaning:\n')],
    [tt('总结要点','Summarize'), tt('请总结下面内容的要点：\n','Summarize the key points in the following text:\n')],
  ];
  const shortcuts = host.querySelector('#homeShortcuts');
  for (const [label, prompt] of actions) {
    const button = document.createElement('button'); button.className='btn'; button.textContent=label;
    button.onclick=async()=>{if(!await startNewConversation())return; const input=/** @type {HTMLTextAreaElement} */ ($('#agentInput')); input.value=prompt; input.focus();};
    shortcuts?.appendChild(button);
  }
  const list = host.querySelector('#homeConversations');
  for (const c of listConversations().slice(0, 6)) {
    const button = document.createElement('button'); button.className='btn-text'; button.style.cssText='display:block;text-align:left;margin:12px 0;'; button.textContent=conversationTitle(c);
    button.onclick=()=>{openConversation(c.id).catch(e=>toast(errText(e)));}; list?.appendChild(button);
  }
  if(list && !list.childElementCount) list.textContent=tt('还没有对话。从一个问题开始吧。','No conversations yet. Start with a question.');
  const models=/** @type {HTMLButtonElement} */ (host.querySelector('#homeModels')); models.onclick=()=>go('settings');
}
window.addEventListener('seeker-conversations-changed', renderHome);
