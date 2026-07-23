// @ts-check
/** 平台 · 首次引导(全端)—— 首开一张欢迎卡:定位一句 + 三步上手 + 隐私一句 + 两出口。
 *  反焦虑:单卡不分页、不聚光灯、看一次永不再弹(localStorage);「关于」页可随时重看。
 *  文案平台自持硬编码(§4-4);第三步按运行时自适应(桌面=配 Key / Web=访问码或先逛)。 */
import { $ } from './dom.js';
import { tt } from './i18n.js';
import { openModal, closeModal } from './modal.js';
import { go } from './nav.js';

const FLAG = 'jh-onboarded';

/** 三步行。 @param {string} n @param {string} zh @param {string} en */
function step(n, zh, en) {
  return `<div style="display:flex;gap:12px;align-items:flex-start;margin:13px 0;">
    <span class="mono" style="flex:none;font-size:10px;letter-spacing:0.08em;color:var(--accent);border:0.5px solid var(--accent-soft);border-radius:99px;padding:3px 8px;margin-top:1px;">${n}</span>
    <span style="font-size:13px;color:var(--ink-2);line-height:1.75;">${tt(zh, en)}</span>
  </div>`;
}

/** 首开展示(已看过则 no-op);force=true 供「关于」页重看。 @param {boolean} [force] */
export function maybeShowOnboarding(force) {
  try { if (!force && localStorage.getItem(FLAG) === 'done') return; } catch (_e) { /* 私隐模式:每次都弹,可接受 */ }
  const desktop = !!(/** @type {any} */ (globalThis).__TAURI__);
  const step3 = desktop
    ? step('03', '<b>接上你的模型</b> —— 到「数据设置 → 模型配置」填自己的 API Key(OpenAI 兼容 / Anthropic / Gemini / 本地 Ollama 免费)。', '<b>Connect your model</b> — add your own API key in Settings → Models (OpenAI-compatible / Anthropic / Gemini / free local Ollama).')
    : step('03', '<b>想聊真模型?</b> 顶栏「输入访问码」即可接入 —— 没有码也可以先随便逛,演示数据都是活的。', '<b>Want live chat?</b> Enter an access code from the top bar — or just explore first; the demo data is all interactive.');
  const m = openModal(`<div class="modal-head"><div><p class="eyebrow">— WELCOME</p><h2 style="margin-top:5px;">${tt('欢迎来到探索者', 'Welcome to Seeker')}<span class="dot">.</span></h2></div><button class="x">×</button></div>
    <div class="modal-body">
      <p style="font-size:13.5px;color:var(--ink);line-height:1.9;margin-bottom:4px;">${tt(
        '这是一个<b>本地优先的个人 AI Agent 平台</b>:对话即入口,数据存在你自己的设备里。首个内置应用是求职工作台。',
        'A <b>local-first personal AI agent platform</b>: conversation is the entry point, and your data stays on your device. The first built-in app is a job-hunt workbench.'
      )}</p>
      ${step('01', '<b>直接说需求</b> —— 在下方输入框打字,或点输入框上方的快捷技能(试试「智能匹配」),Agent 判断该做什么并执行。', '<b>Just say what you need</b> — type below, or tap a quick skill above the input (try “Smart match”); the Agent decides and acts.')}
      ${step('02', '<b>逛逛左侧应用</b> —— 求职工作台已装好演示数据;页面在右侧画布展开(手机上全屏,右下角 AGENT 键随时回对话)。', '<b>Browse the apps</b> — the workbench ships with demo data; pages open in the right canvas (fullscreen on phones — the AGENT pill brings you back).')}
      ${step3}
      <div class="lock-note" style="margin:14px 0 0;"><span class="li">🔒</span><span>${tt(
        '数据默认只存本机;个人隐私字段 AI 在结构上就读不到;所有删除都可撤销 —— 放心点。',
        'Data stays on your machine by default; private fields are structurally unreadable to the AI; every deletion is undoable — click away.'
      )}</span></div>
    </div>
    <div class="modal-foot">
      <button class="btn" id="obAbout">${tt('了解更多 →', 'Learn more →')}</button>
      <button class="btn btn-accent" id="obGo">${tt('开始探索', 'Start exploring')}</button>
    </div>`);
  if (!m) return;
  const done = () => { try { localStorage.setItem(FLAG, 'done'); } catch (_e) { /* ignore */ } };
  const okBtn = m.querySelector('#obGo');
  if (okBtn) /** @type {HTMLElement} */ (okBtn).onclick = () => { done(); closeModal(); };
  const aboutBtn = m.querySelector('#obAbout');
  if (aboutBtn) /** @type {HTMLElement} */ (aboutBtn).onclick = () => { done(); closeModal(); go('about'); };
  const x = m.querySelector('.x');
  if (x) /** @type {HTMLElement} */ (x).addEventListener('click', done); // 右上角关闭同样记忆(不反复打扰)
}
