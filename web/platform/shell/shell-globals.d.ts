/**
 * 3.y 类型化 · 平台侧过渡账本(tsc 桥)—— 收敛中。
 *
 * 已转 ES module 的壳基元,其**尚未改 import 的 @ts-check 消费者**(仍按全局名引用)
 * 在此声明为 ambient —— 与该模块尾部运行时 window 桥配对,让 tsc 零回归。
 * 消费者改 `import { ... } from '../../platform/shell/<模块>.js'` 后**逐条销**;清空即删
 * (同 apps/jobseek/monolith-globals.d.ts 账本收敛)。
 *
 * 批7(2026-07-07)收敛:assets/pages/{prompts,notes}.js 已全部改 import,其消费的
 *   $ / $$ / IC / openModal / closeModal / toast / toastUndo / persistColl / collPersistOn /
 *   hydrateColl / currentPage / frontis / signFoot(13 条;el 从无消费者)逐条销;
 *   renderPrompts/renderNotes 由 assets/manifest.js import 直取、不再上 window 桥。
 *
 * 仅存条目:
 *   i18n.js → tt —— 消费者 jobseek/manifest.js(裸全局引用;该 manifest 尚未改 import)。
 *   待其改 import(账本清空 · 批10),本文件整删。
 */

declare function tt(zh: string, en: string): string;
