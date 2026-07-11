/** 平台 · 能力中心(Capability Center · P1-a)——壳自持管理面(**非 app**,§1 铁律:能力是跨应用平台资源)。
 *
 *  聚合「给人看」的平台能力总览:Connector(MCP)/ 工具·能力 / 记忆 / 知识库 / Skills(可执行技能,S1 管理面);Project/定时任务 绿地占位。
 *
 *  ★读/写界(CLAUDE.md §4-2 + 评审第53轮 [应改]A · 本页据此守界):
 *   - 本页是**前端「给人看」视图** —— 读 `rt.*.list()` 渲染进 DOM,**永不喂模型**;端点/命令/密钥等配置细节
 *     只在此 UI 呈现给用户,**绝不进模型上下文**(模型侧读若将来要做,须走「静态最小投影」新红线,见 proposal §7)。
 *   - **写**(增删连接器 / 填密钥 / 启停)= 设置类,走各自管理面、不经对话;本刀 P1-a 只做**只读总览 + 归属 + 入口**,
 *     深度管理(Connector 提一等公民、记忆/知识库查删)= P1-b/c。 */
import { renderConnectors } from './connectors.js'; // ★P1-b:Connector 管理从 settings.js 模态搬迁至此,提为一等公民
import { cEsc } from './copilot-chrome.js'; // ★评审第54轮 [建议]:复用平台唯一转义器(&<>"),不再造 bespoke esc(防漂移;将来若挪进属性位,漏 " 即成注入缺口)
import { $ } from './dom.js';
import { tt } from './i18n.js';
import { renderDocs, renderMemory } from './memory-docs.js'; // ★P1-c:记忆 / 知识库管理同样从 settings.js 模态搬迁
import { renderSkills } from './skills.js'; // ★Skills S1b:平台可执行技能管理面(proposal-skills.md);从「规划中」占位提为一等公民
import { frontis, signFoot } from './nav.js';

// 用户数据(连接器名 / 能力 id)进 DOM 前逐字转义(纵深防御:虽是用户自填配置/平台定义 id,仍防意外 HTML)。
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
      '能力中心是平台的统一管理面 —— 在这里查看与管理你接入的所有能力。<b>配置、密钥、启停只在此管理,不经对话修改</b>。AI 能看到:有哪些工具及其用途,以及你写入的<b>长期记忆与知识库</b>(它们本就是 Agent 的上下文 —— 可在此随时查看与删除)。AI <b>永远看不到</b>:连接端点、启动命令、任何密钥。',
      'The Capability Center is the platform’s unified management surface — view and manage every capability you have connected. <b>Config, keys, and enable/disable are managed here only, never changed via chat.</b> The AI can see: which tools exist and what they do, plus the <b>long-term memory and knowledge docs</b> you have added (those are the Agent’s context by design — review or delete them here anytime). The AI <b>never</b> sees: connection endpoints, launch commands, or any keys.'
    )}</span></div>` +
    `<div style="display:flex;justify-content:flex-end;margin:-8px 0 10px;"><button class="btn" id="ccRefresh" style="padding:4px 12px;font-size:11px;">${tt('刷新', 'Refresh')}</button></div>` +
    block('cc-connector', 'CONNECTOR · MCP', tt('连接器', 'Connectors'), tt('接入外部工具(文件 / 数据库 / API…)。仅桌面端可用。', 'External tools (files / databases / APIs…). Desktop only.')) +
    block('cc-tools', 'TOOLS', tt('工具 · 能力', 'Tools & capabilities'), tt('Agent 可调用的能力(经工具循环、红线内执行)。', 'Capabilities the Agent can call (through the tool loop, within the red lines).')) +
    block('cc-memory', 'MEMORY', tt('长期记忆', 'Long-term memory'), tt('你主动写下、供 Agent 长期参考的信息。', 'Info you’ve volunteered for the Agent’s long-term context.')) +
    block('cc-docs', 'KNOWLEDGE', tt('知识库', 'Knowledge base'), tt('你加入、供检索作答的文档语料(需嵌入模型)。', 'Docs you’ve added for retrieval-augmented answers (needs an embed model).')) +
    block('cc-skills', 'SKILLS', tt('技能', 'Skills'), tt('把你反复用的指令沉淀成可执行技能 —— 本地保存,一点即运行(运行即将开放)。AI 看不到 Skill 内容(它们是你的指令,不是检索数据)。', 'Turn instructions you reuse into executable skills — stored locally, one-click run (coming soon). The AI can’t see skill contents (they’re your instructions, not retrieval data).')) +
    block('cc-soon', 'ON THE ROADMAP', tt('规划中', 'On the roadmap'), tt('Project / 定时任务 —— 后端建设中,后续开放。', 'Project / Scheduled tasks — backend in progress, coming later.')) +
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
  // ── Connector(MCP):**一等公民管理视图**(P1-b 从 settings.js 模态搬迁;增删启停 / 令牌 / env / 测试连接)。
  //    仍是「给人看」的前端面:端点/命令/密钥状态只呈现给用户,永不进模型(见页顶 lock-note 承诺)。
  (async () => {
    const box = $('#cc-connector');
    if (!box) return;
    try { await renderConnectors(box); }
    catch (_e) { box.innerHTML = emptyLine(tt('桌面端可用(网页端不支持此项)', 'Desktop only (unavailable on web)')); }
  })();

  // ── 工具 · 能力:注册表条目(id + 可用性)。读平台 cap_list = 平台读平台、无 platform→app import([建议]C)。
  fill('cc-tools', async () => {
    const caps = await rt().capability.list();
    if (!caps || !caps.length) return emptyLine(tt('暂无已注册能力。', 'No capabilities registered.'));
    return caps.map((c) => {
      const ok = !!c.available;
      const badge = `<span style="color:${ok ? 'var(--status-done,#5a8)' : 'var(--ink-3)'};font-size:12px;">${ok ? tt('可用', 'Ready') : tt('不可用', 'Unavailable')}</span>`;
      return itemRow(`<span class="mono" style="font-size:12.5px;color:var(--ink-2);">${cEsc(c.id)}</span> · ${badge}`);
    }).join('');
  });

  // ── 记忆 / 知识库:**一等公民管理视图**(P1-c 从 settings.js 两个模态搬迁;查 + 删,破坏性全走 guardrail/toastUndo)。
  //    内容可能含用户 PII(记忆)或外部不可信语料(文档)→ 进 DOM 全 cEsc;本视图不额外喂模型。
  (async () => {
    const box = $('#cc-memory');
    if (!box) return;
    try { await renderMemory(box); }
    catch (_e) { box.innerHTML = emptyLine(tt('桌面端可用(网页端不支持此项)', 'Desktop only (unavailable on web)')); }
  })();
  (async () => {
    const box = $('#cc-docs');
    if (!box) return;
    try { await renderDocs(box); }
    catch (_e) { box.innerHTML = emptyLine(tt('桌面端可用(网页端不支持此项)', 'Desktop only (unavailable on web)')); }
  })();

  // ── Skills(平台可执行技能 · proposal-skills.md S1):用户自撰指令的管理面(增删改;运行 = S2)。
  //    rt.db 双端可用 ⇒ 桌面/网页均生效。Skill 不进 QUERYABLE(永不 AI 可读);管理在此 UI、不经对话(设置红线)。
  (async () => {
    const box = $('#cc-skills');
    if (!box) return;
    try { await renderSkills(/** @type {HTMLElement} */ (box)); }
    catch (_e) { box.innerHTML = emptyLine(tt('暂不可用', 'Unavailable')); }
  })();

  // ── 绿地(诚实占位):Project/定时任务 后端零基础,不假装「已建」(Skills 已落地 → 上移为一等公民)。
  fill('cc-soon', async () =>
    ['Project', tt('定时任务', 'Scheduled tasks')]
      .map((n) => itemRow(`<span style="color:var(--ink-2);">${n}</span> · <span style="color:var(--ink-mute);font-size:12px;">${tt('规划中', 'Planned')}</span>`))
      .join('')
  );
}
