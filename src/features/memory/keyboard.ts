/**
 * 记忆模式窗口级快捷键的「该不该拦这次按键」判定。
 *
 * 题目级动作（知道 / 忘记 / 下一题 / 记错了）统一从题型注册表
 * （`src/quiz/types/memory/logic.ts` 的 `getKeyboardAction`）分发，判定逻辑却
 * 必须和刷题模式（`src/quiz/session/keyboardHandler.ts`）一样保守：
 *
 *   - 输入框 / 对话框 / 输入法组词时完全不该介入
 *   - `Space` / `Enter` 落在按钮等原生交互目标上时保留浏览器默认行为，
 *     否则同一次按键会「原生点击 + 全局处理器」各触发一次：答案页会连跳两题，
 *     刚显示的那道卡被静默排到队尾
 *
 * 抽成独立文件是为了能单测——组件里的处理器拿不到真实 session，判定本身
 * 只跟事件有关。
 */

import {
  hasSelectedText,
  isEditingTarget,
  isInteractiveTarget,
} from "@/features/quiz";
import type { QuestionKeyboardAction } from "@/quiz/types/types";

/** 这些情况下记忆模式的处理器完全不介入。 */
export function isMemoryShortcutIgnored(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  if (isEditingTarget(event)) return true;
  return isInsideDialog(event);
}

/** 焦点是否在打开的对话框里（此时只允许对话框自己的 Esc / Enter 生效）。 */
export function isInsideDialog(event: KeyboardEvent): boolean {
  const target = event.target;
  if (typeof Element === "undefined" || !(target instanceof Element)) {
    return false;
  }
  return target.closest('[role="dialog"]') !== null;
}

/**
 * 题目级动作是否该让给原生交互目标。
 *
 * 只有「选择答案」在记忆模式里没有原生对应物（知道 / 忘记只能靠快捷键），
 * 其余动作（下一题 / 记错了）都有对应按钮，交给按钮自己的 click 即可。
 */
export function shouldDeferMemoryAction(
  event: KeyboardEvent,
  action: QuestionKeyboardAction,
): boolean {
  if (action.kind === "set-selected-answers") return false;
  return isInteractiveTarget(event);
}

/** ⌘/Ctrl+C：用户选中了文本时不要抢剪贴板（与刷题模式一致）。 */
export function hasSelectedTextToCopy(): boolean {
  return hasSelectedText();
}
