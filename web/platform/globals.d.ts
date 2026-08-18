import type { RuntimeApi } from './runtime/types';
import type { SeekerShellApi } from './shell/types';

interface GuardrailOptions {
  title?: string;
  detail?: string;
  confirmLabel?: string;
  changes?: Array<{ label?: string; before?: string; after?: string }>;
  onConfirm: () => void | boolean | number | Promise<void | boolean | number>;
  onUndo?: () => void | Promise<void>;
  undoText?: string;
  undoMs?: number;
  source?: string;
}

declare global {
  interface Window {
    /** 由 index.html 的运行时启动模块在 `seeker-rt-ready` 之前安装。 */
    SeekerRT: RuntimeApi;
    /** 应用注册与壳装配的唯一跨层契约。 */
    SeekerShell: SeekerShellApi;
    /** 破坏性操作统一预览/确认/撤销入口。 */
    SeekerGuardrail?: {
      confirmDestructive(options: GuardrailOptions): Promise<boolean>;
    };
  }
}

export {};
