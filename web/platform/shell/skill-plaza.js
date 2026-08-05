// @ts-check
/** 平台 · 技能广场(需求侧探针)—— 精选技能一键导入。
 *  纪律:导入复用 I1 载重不变式(importSkillWire 白名单提取 + 字面 imported:true/reviewed:false)
 *  ⇒ 广场技能与粘贴导入**同一条审阅门**,平台自持内容也不享受免检特权(纪律无例外才是纪律)。
 *  数据源 web/skills-gallery.json(平台自持,随仓发布);信标 GET api/plaza?skill=id 只记精选 id 计数
 *  (204 无内容,失败静默 —— GitHub Pages 等无代理环境自然无信标)。 */
import { renderCapabilityCenter } from './capability-center.js'; // 导入后重渲(壳页 boot 一次性渲染,导航只切显隐 —— 不重渲则能力中心停留旧画面)
import { $, $$ } from './dom.js';
import { tt } from './i18n.js';
import { frontis, signFoot } from './nav.js';
import { importSkillWire } from './skill-model.js';
import { listSkills, saveSkill } from './skill-store.js';
import { toast, errText } from './toast.js';

/** @type {any[]|null} */
let gallery = null;

function newId() { return 'sk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/** @param {string} s */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

export function renderSkillPlaza() {
  const host = $('#page-plaza');
  if (!host) return;
  const head = frontis('SKILLS', tt('技能广场', 'Skills Plaza'))
    + `<div class="sec" style="border-bottom:none;padding-bottom:6px;">
      <p style="font-size:13px;color:var(--ink-3);line-height:1.8;max-width:640px;">${tt(
        '精选技能,一键导入。<b>导入后须在能力中心审阅通过才可运行</b> —— 广场技能也不例外:不认识的指令不该有免检特权。',
        'Curated skills, one-click import. <b>Imported skills must pass your review in the Capability Center before they can run</b> — plaza skills included: no instruction deserves a free pass.'
      )}</p></div>`;
  if (!gallery) {
    host.innerHTML = head + `<div class="sec" style="border-bottom:none;"><p style="font-size:12px;color:var(--ink-mute);">${tt('加载中…', 'Loading…')}</p></div>` + signFoot();
    fetch('skills-gallery.json').then((r) => r.json()).then((j) => {
      gallery = Array.isArray(j && j.skills) ? j.skills : [];
      renderSkillPlaza();
    }).catch(() => {
      const h = $('#page-plaza');
      if (h) h.innerHTML = head + `<div class="sec" style="border-bottom:none;"><p style="font-size:12px;color:var(--ink-mute);">${tt('精选清单加载失败,稍后再试。', 'Could not load the gallery — try again later.')}</p></div>` + signFoot();
    });
    return;
  }
  const have = new Set(listSkills().map((s) => s.name));
  const cards = gallery.map((g) => `<div class="sec" style="padding:16px 0;">
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;">
        <h3 style="font-size:15px;color:var(--ink);margin:0;font-weight:600;">${esc(g.name)}</h3>
        <span class="mono" style="font-size:9.5px;letter-spacing:0.08em;color:var(--ink-3);border:0.5px solid var(--border);padding:2px 7px;">${esc(g.tag || '')}</span>
        <span style="flex:1;"></span>
        ${have.has(g.name)
          ? `<span class="mono" style="font-size:10px;color:var(--ink-3);">${tt('已在你的 Skills', 'In your skills')}</span>`
          : `<button class="btn btn-accent" data-plzadd="${esc(g.id)}" style="padding:4px 12px;font-size:11.5px;">${tt('导入', 'Import')}</button>`}
      </div>
      <p style="font-size:12.5px;color:var(--ink-2);line-height:1.75;margin:8px 0 0;max-width:640px;">${esc(g.desc)}</p>
      <details style="margin-top:8px;"><summary class="mono" style="font-size:10px;letter-spacing:0.06em;color:var(--ink-3);cursor:pointer;">${tt('查看完整指令', 'View full prompt')}</summary>
        <pre style="margin:8px 0 0;padding:11px 13px;background:var(--bg-subtle);border:0.5px solid var(--border);font-size:11.5px;line-height:1.7;color:var(--ink-2);white-space:pre-wrap;word-break:break-word;max-height:300px;overflow-y:auto;">${esc(g.prompt)}</pre>
      </details>
    </div>`).join('');
  const foot = `<div class="sec" style="border-bottom:none;">
    <p style="font-size:12px;color:var(--ink-3);line-height:1.8;">${tt(
      '这些技能同步发布在开源技能仓(SKILL.md 格式,可用于 Claude Code 等任何兼容 Agent):',
      'Also published as an open skills repo (SKILL.md format, works in Claude Code and other compatible agents):'
    )} <button class="btn-text" data-plzrepo>github.com/aklmans/agent-skills →</button></p></div>`;
  host.innerHTML = head + cards + foot + signFoot();

  $$('#page-plaza [data-plzadd]').forEach((b) => {
    /** @type {HTMLElement} */ (b).onclick = async () => {
      const id = /** @type {HTMLElement} */ (b).dataset.plzadd;
      const g = (gallery || []).find((x) => x.id === id);
      if (!g) return;
      // 与粘贴导入完全同路:序列化 → importSkillWire 白名单提取 → 字面 imported/未审阅落库。
      const wire = importSkillWire(JSON.stringify({ name: g.name, description: g.desc, prompt: g.prompt }));
      if (!wire) { toast(tt('技能数据异常', 'Bad skill data')); return; }
      const rec = { id: newId(), name: wire.name, description: wire.description, prompt: wire.prompt, tools: wire.tools, imported: true, reviewed: false, updated_at: Date.now() };
      try { await saveSkill(rec); } catch (e) { toast(errText(e)); return; }
      try { fetch('api/plaza?skill=' + encodeURIComponent(String(id))).catch(() => {}); } catch (_e) { /* 无代理环境静默 */ }
      toast(tt('已导入 —— 去能力中心审阅通过后即可运行', 'Imported — review it in the Capability Center to enable'));
      try { renderCapabilityCenter(); } catch (_e) { /* 能力中心未挂载等异常不阻断广场 */ }
      renderSkillPlaza();
    };
  });
  const repo = $('#page-plaza [data-plzrepo]');
  if (repo) /** @type {HTMLElement} */ (repo).onclick = () => {
    try { /** @type {any} */ (window).SeekerRT.web.open('https://github.com/aklmans/agent-skills'); }
    catch (_e) { toast(tt('打开失败', 'Could not open')); }
  };
}
