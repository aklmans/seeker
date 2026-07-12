// @ts-check
/**
 * jobseek · 市场价值 app-tool 装配(app-tool 契约 T3)。
 *
 * 纯计算 + 契约元数据在 market-value-compute.js(零 import、node 可测、注入沙箱);本文件装配 spec 并写 **render**——
 * render 在**前端**跑,故 `tt()` 可用 ⇒ **#6 双语债消掉**(旧 jobseek.rs 的卡 HTML 是 Rust 硬编码中文、够不到 locale)。
 * render 产物仍进三墙沙箱渲染(平台侧);技能名(用户数据)经 cEsc 转义,纵深防御。
 */
import { tt } from '../../../platform/shell/i18n.js';
import { cEsc } from '../../../platform/shell/copilot-chrome.js';
import {
  computeMarketValue,
  MARKET_VALUE_NAME,
  MARKET_VALUE_READS,
  MARKET_VALUE_DESC,
  MARKET_VALUE_OUTPUT,
} from './market-value-compute.js';

/**
 * 据**已投影** output 产市场价值卡(文案 tt 双语;与前端 openMarketValue 报告同源同框定)。
 * @param {{low:number, high:number, jobs:number, gaps:string[]}} o
 * @returns {import('../../../platform/shell/types').AppToolWidget}
 */
function renderMarketValue(o) {
  const chips = (o.gaps || [])
    .map((g) =>
      `<span style="display:inline-block;padding:3px 9px;border:0.5px solid var(--border,#d8d5cf);font-size:12px;color:var(--ink-2,#3a3a3a)">${tt('补齐 ', 'Close ')}${cEsc(g)}</span>`,
    )
    .join(' ');
  const html =
    `<div style="font-family:var(--font-sans,system-ui);padding:10px 6px">` +
    `<div style="font-size:10px;letter-spacing:.18em;color:var(--ink-3,#9a9a9a);font-family:var(--font-mono,monospace)">${tt('— 参考区间 · 年包(示意)', '— Reference range · annual (illustrative)')}</div>` +
    `<div style="font-size:34px;color:var(--accent,#c95f3d);font-weight:600;margin:8px 0 4px">${o.low}–${o.high}<span style="font-size:14px;color:var(--ink-3,#888);font-weight:400"> ${tt('万 / 年', '×10k / yr')}</span></div>` +
    `<div style="font-size:13px;color:var(--ink-2,#555);line-height:1.6;margin-bottom:14px">${tt('由你 ', 'Weighted from your ')}<b>${o.jobs}</b>${tt(' 个目标岗位的真实薪资、按你对各岗位的匹配分加权得出(示意级、非真实定价模型;仅供参考、勿作决策依据)。补齐下列高杠杆能力可上探上沿:', ' target roles by how well you match each (illustrative — not a real pricing model; reference only). Closing these high-leverage gaps can push the upper bound:')}</div>` +
    `<div style="display:flex;gap:6px;flex-wrap:wrap">${chips}</div></div>`;
  return { html, title: tt('市场价值估算', 'Market value estimate'), minHeight: 180 };
}

/** @type {import('../../../platform/shell/types').AppToolSpec} */
export const marketValueTool = {
  name: MARKET_VALUE_NAME,
  description: MARKET_VALUE_DESC,
  parameters: { type: 'object', properties: {} },
  reads: MARKET_VALUE_READS,
  compute: computeMarketValue,
  output: MARKET_VALUE_OUTPUT,
  render: renderMarketValue,
};
