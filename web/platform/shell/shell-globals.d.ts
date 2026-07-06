/**
 * 3.y 类型化 · 平台侧过渡账本(tsc 桥)。
 *
 * 已转 ES module 的壳基元,其 **@ts-check 消费者**(apps 等,仍按全局名引用、尚未改 import)
 * 在此声明为 ambient —— 与该模块尾部的**运行时 window 桥**配对,让 tsc 零回归。
 * 消费者逐个改 `import { ... } from '../../platform/shell/<模块>.js'` 后,从此**逐条销**;
 * 清空即删(同 apps/jobseek/monolith-globals.d.ts 账本收敛)。
 *
 * 当前条目:
 *   modal.js(3.y 首刀)→ openModal / closeModal(消费者:apps/assets/pages/{prompts,notes}.js)
 *   toast.js(3.y 有状态刀)→ toast / toastUndo(消费者同上;errText/runLastUndo 无 @ts-check 消费者、lastUndo 不外露→均不入桥)
 */

declare function openModal(html: string, wide?: boolean): Element;
declare function closeModal(): void;
declare function toast(msg: string): void;
declare function toastUndo(msg: string, restoreFn: () => void): void;
