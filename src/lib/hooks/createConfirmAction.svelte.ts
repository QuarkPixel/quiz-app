import { CONFIRM_TIMEOUT_MS } from "@/config";

interface ConfirmActionOptions {
  /** 第一次 trigger 后到自动复位的时长（毫秒），默认 CONFIRM_TIMEOUT_MS。 */
  timeoutMs?: number;
}

export interface ConfirmAction {
  /** 当前是否处于「等待第二次点击确认」状态。 */
  readonly confirming: boolean;

  /**
   * 触发动作：
   *   - 不在 confirming 状态 → 进入 confirming，启动超时
   *   - 在 confirming 状态 → 清超时，复位，调用 onConfirm
   */
  trigger(): void;

  /** 立即复位（取消超时、清 confirming，不调用 onConfirm）。 */
  reset(): void;
}

/**
 * 「点两下确认」状态机。用于把破坏性操作（重置进度、标记掌握、当作正确）
 * 包成两步交互：第一次点击 → confirming（UI 给视觉反馈，比如换文字或背景），
 * 第二次点击 → 真正执行。3 秒不动则自动复位。
 *
 * 必须在 svelte 组件 / .svelte.ts 文件里调用 —— 内部用 $state rune。
 */
export function createConfirmAction(
  onConfirm: () => void,
  options: ConfirmActionOptions = {},
): ConfirmAction {
  const timeoutMs = options.timeoutMs ?? CONFIRM_TIMEOUT_MS;

  let confirming = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function reset(): void {
    clearTimer();
    confirming = false;
  }

  function trigger(): void {
    if (confirming) {
      reset();
      onConfirm();
      return;
    }
    confirming = true;
    clearTimer();
    timer = setTimeout(() => {
      confirming = false;
      timer = null;
    }, timeoutMs);
  }

  return {
    get confirming() {
      return confirming;
    },
    trigger,
    reset,
  };
}
