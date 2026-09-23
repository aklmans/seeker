// @ts-check
import { tt } from './i18n.js';
import { openModal, closeModal } from './modal.js';
import { go } from './nav.js';

/** @param {boolean} [force] */
export function maybeShowOnboarding(force) {
  try { if(!force && localStorage.getItem('jh-onboarded')) return; } catch { /* welcome can still be dismissed */ }
  const m=openModal('<div class="modal-head"><div><p class="eyebrow">WELCOME</p><h2>'+tt('欢迎来到探索者','Welcome to Seeker')+'<span class="dot">.</span></h2></div><button class="x">×</button></div>'
    + '<div class="modal-body"><p style="font-size:15px;line-height:1.9;">'+tt('你的日常 AI 助手。提问、处理文字，把有用的内容留在自己的设备里。','Your everyday AI assistant. Ask questions, work on text, and keep useful material on your own device.')+'</p>'
    + '<ol style="padding-left:20px;line-height:2.2;"><li>'+tt('从首页开始对话，或选择一个日常工具。','Start a conversation or choose an everyday tool from Home.')+'</li><li>'+tt('在资料库保存笔记，没有模型也能使用。','Keep notes in your library, even without a model.')+'</li><li>'+tt('桌面版需要连接一次模型；Web 试用按站点当前开放方式连接限量聊天服务。','Connect a model once on desktop. The Web demo uses the site’s current limited-access chat service.')+'</li></ol>'
    + '<p style="color:var(--ink-3);line-height:1.8;">'+tt('数据默认本地保存。使用云端 AI 时，提交的内容会发送给你选择的模型服务商。','Data is saved locally by default. Content submitted to cloud AI is sent to your selected model provider.')+'</p></div>'
    + '<div class="modal-foot"><button class="btn" id="obModels">'+tt('设置模型','Model settings')+'</button><button class="btn btn-accent" id="obGo">'+tt('开始探索','Get started')+'</button></div>');
  if(!m)return;
  const done=()=>{try{localStorage.setItem('jh-onboarded','done');}catch{} closeModal();};
  m.querySelector('#obGo')?.addEventListener('click',done);
  m.querySelector('.x')?.addEventListener('click',done);
  m.querySelector('#obModels')?.addEventListener('click',()=>{done();go('settings');});
}
