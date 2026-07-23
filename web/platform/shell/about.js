// @ts-check
/** 平台 · 关于页 —— 让访客三十秒读懂项目,并给出仓库/下载/反馈的引流出口。
 *  文案与链接全部平台自持硬编码(§4-4:按钮语义不得由派生内容决定);外链经 rt.web.open
 *  (桌面走 Rust open_external 带 scheme 闸,网页端镜像同闸)。 */
import { $, $$ } from './dom.js';
import { tt } from './i18n.js';
import { frontis, signFoot } from './nav.js';
import { setState } from './shell-state.js'; // 微信二维码仅中文界面显示(英文访客用不上;setLang→rerenderPages 会重跑本渲染)
import { toast } from './toast.js';

const REPO = 'https://github.com/aklmans/seeker';

/** 特性/安全条目行。 @param {string} zh @param {string} en */
function li(zh, en) {
  return `<li style="margin:7px 0;line-height:1.8;">${tt(zh, en)}</li>`;
}
/** 外链按钮(data-extlink 委派)。 @param {string} zh @param {string} en @param {string} url @param {boolean} [accent] */
function lk(zh, en, url, accent) {
  return `<button class="btn${accent ? ' btn-accent' : ''}" data-extlink="${url}" style="padding:7px 14px;">${tt(zh, en)}</button>`;
}

export function renderAbout() {
  const host = $('#page-about');
  if (!host) return;
  host.innerHTML = frontis('ABOUT', tt('关于', 'About'))
    + `<div class="sec" style="padding-top:4px;">
      <p style="font-size:14.5px;color:var(--ink);line-height:2;max-width:640px;"><b>探索者 · Seeker</b> —— ${tt(
        '本地优先的个人 AI Agent 平台:一个壳,装着可自由开关的小应用。对话即入口,数据存在你自己的设备里,AI 只是你请来的帮手。',
        'A local-first personal AI agent platform: one shell, many toggleable mini-apps. Conversation is the entry point; your data stays on your device — the AI is just a helper you invited.'
      )}</p>
      <p style="font-size:13px;color:var(--ink-3);line-height:1.9;max-width:640px;margin-top:8px;">${tt(
        '首个内置应用是求职工作台(智能匹配 / 简历 / 面试陪练 / 市场价值);用完可以整个关掉,数据保留。Web 版是演示体验 —— 真实 AI 工具循环、记忆与连接器在桌面版。',
        'The first built-in app is a job-hunt workbench (smart match / resume / interview practice / market value); switch it off when done — data stays. The web version is a demo; the real AI tool loop, memory and connectors live in the desktop app.'
      )}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;">
        ${lk('下载桌面版', 'Download desktop', REPO + '/releases', true)}
        ${lk('GitHub 源码', 'Source on GitHub', REPO)}
        ${lk('提反馈 / Issues', 'Feedback / Issues', REPO + '/issues')}
      </div>
    </div>
    <div class="sec">
      <p class="seclabel">— ${tt('能做什么', 'WHAT IT DOES')}</p>
      <ul style="list-style:none;padding:0;margin:10px 0 0;font-size:13px;color:var(--ink-2);max-width:640px;">
        ${li('<b>Agent 对话入口</b> —— 说出需求即执行;斜杠命令、快捷技能一点即跑', '<b>Agent-first</b> — say what you need; slash commands & one-tap skills')}
        ${li('<b>能力中心</b> —— 连接器(MCP)、记忆、知识库、Skills、定时任务、项目,统一管理', '<b>Capability center</b> — MCP connectors, memory, knowledge, skills, schedules, projects in one place')}
        ${li('<b>多应用可开关</b> —— 关应用即下架其界面与 AI 权限,数据保留可回', '<b>Toggleable apps</b> — switching an app off retires its UI & AI access; data stays')}
        ${li('<b>自带模型钥匙(BYO)</b> —— OpenAI 兼容 / Anthropic / Gemini / 本地 Ollama 任选', '<b>Bring your own model</b> — OpenAI-compatible / Anthropic / Gemini / local Ollama')}
        ${li('<b>笔记与 Prompt 库</b> —— Markdown 编辑预览,授权后 AI 可检索引用', '<b>Notes & prompt library</b> — Markdown editing; AI can search them with your grant')}
      </ul>
    </div>
    <div class="sec">
      <p class="seclabel">— ${tt('隐私是结构,不是承诺', 'PRIVACY BY STRUCTURE')}</p>
      <ul style="list-style:none;padding:0;margin:10px 0 0;font-size:13px;color:var(--ink-2);max-width:640px;">
        ${li('数据默认存本机(桌面 SQLite / 网页浏览器内);联网只为调你自己填的模型端点', 'Data lives on your machine (SQLite on desktop / in-browser on web); network is only for the model endpoint you configure')}
        ${li('API 密钥只进系统钥匙串,不落文件、不进日志', 'API keys live only in the system keychain — never in files or logs')}
        ${li('姓名电话等隐私字段存独立区域,AI 在代码结构上读不到 —— 不是「承诺不读」,是「没有能读的那条路」', 'Personal fields sit in an isolated store the AI structurally cannot reach — not a promise, an absence of any code path')}
        ${li('破坏性操作:AI 只能提议,执行永远等你亲手确认;删除均可撤销', 'Destructive actions: the AI can only propose — execution always waits for your explicit confirm; deletions are undoable')}
      </ul>
    </div>
    <div class="sec">
      <p class="seclabel">— ${tt('项目', 'PROJECT')}</p>
      <p style="font-size:12.5px;color:var(--ink-3);line-height:1.9;max-width:640px;margin-top:10px;">${tt(
        'Tauri 2(Rust 内核 + 系统 WebView),前端原生 HTML/CSS/JS、零框架,安装包约 7MB。开源(MIT),由一名开发者与 AI 结对完成 —— 全程一百余轮独立评审,每条安全红线都有测试钉着。当前 v0.1,正在收集第一批真实反馈,用得顺手或别扭都欢迎告诉我。',
        'Tauri 2 (Rust core + system WebView), vanilla HTML/CSS/JS with zero frameworks, ~7MB installer. Open source (MIT), built by one developer pairing with AI — 100+ independent review rounds, every security red line pinned by tests. Now at v0.1, collecting its first real feedback — rough edges welcome.'
      )}</p>
    </div>
    <div class="sec" style="border-bottom:none;">
      <p class="seclabel">— ${tt('联系作者', 'CONTACT')}</p>
      <div style="display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;margin-top:12px;">
        ${setState.lang !== 'en' ? `<figure style="margin:0;text-align:center;">
          <img src="contact.jpg" alt="微信二维码 · Zhaphar" style="width:148px;max-width:40vw;padding:8px;background:#fff;border:0.5px solid var(--border-strong);border-radius:6px;display:block;box-sizing:border-box;">
          <figcaption class="mono" style="font-size:10px;color:var(--ink-3);margin-top:6px;letter-spacing:0.06em;">微信扫码加我</figcaption>
        </figure>` : ''}
        <div style="display:flex;flex-direction:column;gap:9px;min-width:220px;">
          <div style="display:flex;align-items:center;gap:10px;"><span class="mono" style="font-size:10px;color:var(--ink-3);width:52px;letter-spacing:0.06em;">X</span><button class="btn" data-extlink="https://x.com/ak_zhaphar" style="padding:5px 12px;">@ak_zhaphar</button></div>
          <div style="display:flex;align-items:center;gap:10px;"><span class="mono" style="font-size:10px;color:var(--ink-3);width:52px;letter-spacing:0.06em;">GITHUB</span><button class="btn" data-extlink="${REPO}" style="padding:5px 12px;">aklmans/seeker</button></div>
          <div style="display:flex;align-items:center;gap:10px;"><span class="mono" style="font-size:10px;color:var(--ink-3);width:52px;letter-spacing:0.06em;">${tt('官网', 'SITE')}</span><button class="btn" data-extlink="https://seeker.aklman.com/" style="padding:5px 12px;">seeker.aklman.com</button></div>
          <div style="display:flex;align-items:center;gap:10px;"><span class="mono" style="font-size:10px;color:var(--ink-3);width:52px;letter-spacing:0.06em;">EMAIL</span><button class="btn" id="aboutMail" style="padding:5px 12px;" title="${tt('点击复制', 'Click to copy')}">hi@zhaphar.com</button></div>
        </div>
      </div>
    </div>`
    + signFoot();
  $$('#page-about [data-extlink]').forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = () => {
      try { /** @type {any} */ (window).SeekerRT.web.open(/** @type {HTMLElement} */ (b).dataset.extlink); }
      catch (_e) { toast(tt('打开失败', 'Could not open')); }
    };
  });
  // 邮箱:点击复制(mailto 刻意不走 —— open_external 的 scheme 闸只放 http/https,不为便利开闸)。
  const mail = $('#aboutMail');
  if (mail) /** @type {HTMLElement} */ (mail).onclick = async () => {
    try { await navigator.clipboard.writeText('hi@zhaphar.com'); toast(tt('邮箱已复制', 'Email copied')); }
    catch (_e) { toast('hi@zhaphar.com'); /* 剪贴板不可用则直接展示,人工可抄 */ }
  };
}
