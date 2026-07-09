/** 平台 · 能力中心(Capability Center · P1-a)——壳自持管理面(**非 app**,§1 铁律:能力是跨应用平台资源)。
 *
 *  聚合「给人看」的平台能力总览:Connector(MCP)/ 工具·能力 / 记忆 / 知识库;Skills/Project/定时任务 绿地占位。
 *
 *  ★读/写界(CLAUDE.md §4-2 + 评审第53轮 [应改]A · 本页据此守界):
 *   - 本页是**前端「给人看」视图** —— 读 `rt.*.list()` 渲染进 DOM,**永不喂模型**;端点/命令/密钥等配置细节
 *     只在此 UI 呈现给用户,**绝不进模型上下文**(模型侧读若将来要做,须走「静态最小投影」新红线,见 proposal §7)。
 *   - **写**(增删连接器 / 填密钥 / 启停)= 设置类,走各自管理面、不经对话;本刀 P1-a 只做**只读总览 + 归属 + 入口**,
 *     深度管理(Connector 提一等公民、记忆/知识库查删)= P1-b/c。 */
import { $ } from './dom.js';
import { tt } from './i18n.js';
import { frontis, signFoot } from './nav.js';

// 用户数据(连接器名 / 能力 id)进 DOM 前逐字转义(纵深防御:虽是用户自填配置,仍防意外 HTML)。
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rt = () => window.SeekerRT;

// 域块骨架:统一 eyebrow/标题/副说明 + 异步填充容器(id)。
const block = (id, eyebrow, title, sub) =>
  `<div style="margin-bottom:26px;">
    <p class="seclabel">— ${eyebrow}</p>
    <h2 class="sectitle" style="font-size:19px;">${title}<span class="dot">.</span></h2>
    ${sub ? `<p style="font-size:12px;color:var(--ink-3);margin:6px 0 12px;max-width:640px;line-height:1.7;">${sub}</p>` : ''}
    <div id="${id}" style="max-width:660px;"><p style="color:var(--ink-mute);font-size:12px;padding:8px 0;">${tt('加载中…', 'Loading…')}</p></div>
  </div>`;

const emptyLine = (txt) => `<p style="color:var(--ink-3);font-size:12px;padding:8px 0;">${txt}</p>`;
const itemRow = (inner) => `<div style="padding:9px 0;border-bottom:0.5px solid var(--border);font-size:13.5px;color:var(--ink);">${inner}</div>`;

/** 平台壳导航页渲染(注册于 index.html setShell)。注入 `#page-capability` + 异步填充。 */
export function renderCapabilityCenter() {
  const host = $('#page-capability');
  if (!host) return;
  host.innerHTML =
    frontis('CAPABILITIES', tt('能力中心', 'Capability Center')) +
    `<div class="sec" style="border-bottom:none;padding-top:18px;">` +
    `<div class="lock-note" style="margin:0 0 22px;max-width:680px;"><span class="li">🧩</span><span>${tt(
      '能力中心是平台的统一管理面 —— 在这里查看你接入的所有能力。<b>配置、密钥、启停在此管理,不经对话修改</b>;AI 只能看到「有哪些工具、各自做什么」,<b>连接端点、命令、密钥永不进入 AI</b>。',
      'The Capability Center is the platform’s unified management surface — see every capability you’ve connected here. <b>Config, keys, and enable/disable are managed here, never changed via chat</b>; the AI only sees which tools exist and what they do — <b>endpoints, commands, and keys never reach the AI</b>.'
    )}</span></div>` +
    `<div style="display:flex;justify-content:flex-end;margin:-8px 0 10px;"><button class="btn" id="ccRefresh" style="padding:4px 12px;font-size:11px;">${tt('刷新', 'Refresh')}</button></div>` +
    block('cc-connector', 'CONNECTOR · MCP', tt('连接器', 'Connectors'), tt('接入外部工具(文件 / 数据库 / API…)。仅桌面端可用。', 'External tools (files / databases / APIs…). Desktop only.')) +
    block('cc-tools', 'TOOLS', tt('工具 · 能力', 'Tools & capabilities'), tt('Agent 可调用的能力(经工具循环、红线内执行)。', 'Capabilities the Agent can call (through the tool loop, within the red lines).')) +
    block('cc-memory', 'MEMORY', tt('长期记忆', 'Long-term memory'), tt('你主动写下、供 Agent 长期参考的信息。', 'Info you’ve volunteered for the Agent’s long-term context.')) +
    block('cc-docs', 'KNOWLEDGE', tt('知识库', 'Knowledge base'), tt('你加入、供检索作答的文档语料(需嵌入模型)。', 'Docs you’ve added for retrieval-augmented answers (needs an embed model).')) +
    block('cc-soon', 'ON THE ROADMAP', tt('规划中', 'On the roadmap'), tt('Skills / Project / 定时任务 —— 后端建设中,后续开放。', 'Skills / Project / Scheduled tasks — backend in progress, coming later.')) +
    `</div>` +
    signFoot();
  const rb = $('#ccRefresh');
  if (rb) rb.onclick = () => populate(); // 手动刷新(P1-a 快照式取数;导航即刷新 = P1-b 深化时接)
  populate();
}

// 逐域异步填充:一域失败(如 web 端 notImpl)只降级本域、不拖累其他域。
async function fill(id, fn) {
  const box = $('#' + id);
  if (!box) return;
  try {
    box.innerHTML = await fn();
  } catch (_e) {
    box.innerHTML = emptyLine(tt('桌面端可用(网页端不支持此项)', 'Desktop only (unavailable on web)'));
  }
}

function populate() {
  // ── Connector(MCP):名称 + 传输类型 + 状态/工具数(只读总览;深度管理 = P1-b)。
  fill('cc-connector', async () => {
    const rows = await rt().mcp.list();
    if (!rows.length) return emptyLine(tt('还没有连接器。到「设置 · 扩展」添加,让 Agent 用上外部工具。', 'No connectors yet. Add one under Settings · Extensions to give the Agent external tools.'));
    return rows.map((s) => {
      const http = s.transport === 'http';
      const tag = `<span class="mono" style="font-size:9.5px;color:var(--ink-3);border:0.5px solid var(--border);border-radius:3px;padding:0 4px;">${http ? tt('远程', 'REMOTE') : tt('本地', 'LOCAL')}</span>`;
      const status = s.error
        ? `<span style="color:var(--ink-3);">${tt('连接失败', 'Failed')}</span>`
        : s.enabled
          ? (s.connected ? `<span style="color:var(--status-done,#5a8);">${s.toolCount} ${tt('工具', 'tools')}</span>` : `<span style="color:var(--ink-3);">${tt('连接中…', 'Connecting…')}</span>`)
          : `<span style="color:var(--ink-3);">${tt('已停用', 'Disabled')}</span>`;
      return itemRow(`${tag} <span style="font-weight:500;">${esc(s.name)}</span> · ${status}`);
    }).join('');
  });

  // ── 工具 · 能力:注册表条目(id + 可用性)。读平台 cap_list = 平台读平台、无 platform→app import([建议]C)。
  fill('cc-tools', async () => {
    const caps = await rt().capability.list();
    if (!caps || !caps.length) return emptyLine(tt('暂无已注册能力。', 'No capabilities registered.'));
    return caps.map((c) => {
      const ok = !!c.available;
      const badge = `<span style="color:${ok ? 'var(--status-done,#5a8)' : 'var(--ink-3)'};font-size:12px;">${ok ? tt('可用', 'Ready') : tt('不可用', 'Unavailable')}</span>`;
      return itemRow(`<span class="mono" style="font-size:12.5px;color:var(--ink-2);">${esc(c.id)}</span> · ${badge}`);
    }).join('');
  });

  // ── 记忆 / 知识库:计数总览(查/删 = P1-c)。
  fill('cc-memory', async () => {
    const rows = await rt().memory.list();
    return rows.length
      ? itemRow(`<b>${rows.length}</b> ${tt('条长期记忆', 'long-term memories')}`)
      : emptyLine(tt('还没有长期记忆。你主动写给 Agent 的信息会出现在这里。', 'No long-term memory yet. Info you volunteer to the Agent shows up here.'));
  });
  fill('cc-docs', async () => {
    const rows = await rt().docs.list();
    return rows.length
      ? itemRow(`<b>${rows.length}</b> ${tt('篇知识库文档', 'knowledge docs')}`)
      : emptyLine(tt('知识库还是空的。加入文档,让 Agent 检索作答。', 'Knowledge base is empty. Add docs for the Agent to retrieve from.'));
  });

  // ── 绿地(诚实占位):Skills/Project/定时任务 后端零基础,不假装「已建」。
  fill('cc-soon', async () =>
    ['Skills', 'Project', tt('定时任务', 'Scheduled tasks')]
      .map((n) => itemRow(`<span style="color:var(--ink-2);">${n}</span> · <span style="color:var(--ink-mute);font-size:12px;">${tt('规划中', 'Planned')}</span>`))
      .join('')
  );
}
