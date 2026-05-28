/**
 * 全局键盘处理器：把 QuizView 内 80 行 handleKeydown 抽出来。
 *
 * 大多数快捷键直接调 session 方法；dialog 类（toggleReview / toggleSettings）
 * 留在 QuizView 局部，通过 uiActions 注入。
 */

import { isEditingTarget } from "../../features/quiz";
import { SHORTCUTS } from "../../config";
import type { QuizSession } from "./QuizSession.svelte";

export interface KeyboardUiActions {
  toggleReview(): void;
  toggleSettings(): void;
}

export function createKeyboardHandler(
  session: QuizSession,
  uiActions: KeyboardUiActions,
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    const isMod = event.metaKey || event.ctrlKey;

    // Cmd/Ctrl + 单键：全局快捷键。在输入框内不抢，让 Cmd+A 等浏览器默认生效。
    if (isMod && !event.altKey && !event.shiftKey && !isEditingTarget(event)) {
      const key = event.key.toLowerCase();
      // Cmd+B (sidebar) 留给 Sidebar context 处理
      if (key === SHORTCUTS.sidebar) return;
      if (key === SHORTCUTS.togglePool) {
        event.preventDefault();
        session.togglePool();
        return;
      }
      if (key === SHORTCUTS.toggleReview) {
        event.preventDefault();
        uiActions.toggleReview();
        return;
      }
      if (key === SHORTCUTS.toggleSettings) {
        event.preventDefault();
        uiActions.toggleSettings();
        return;
      }
      if (key === SHORTCUTS.toggleAutoNext) {
        event.preventDefault();
        session.toggleAutoNext();
        return;
      }
      if (key === SHORTCUTS.importProgress) {
        event.preventDefault();
        void session.startImport();
        return;
      }
      if (key === SHORTCUTS.exportProgress) {
        event.preventDefault();
        void session.exportProgress();
        return;
      }
      return;
    }

    if (event.code !== "Space" && event.code !== "Enter") return;

    const target = event.target as HTMLElement | null;
    const inDialog = !!target?.closest('[role="dialog"]');
    const inBlankInput = !!target?.classList?.contains("blank-input");

    // L2: 设置 / 答案预览 dialog 内 — Enter 让输入框 blur 触发 onchange
    if (inDialog) {
      if (event.code === "Enter" && isEditingTarget(event)) {
        (target as HTMLInputElement).blur();
      }
      return;
    }

    // L1: 填空题输入框 — Enter 提交 / 下一题（Space 不抢，让浏览器打空格）
    if (inBlankInput) {
      if (event.code !== "Enter") return;
      event.preventDefault();
      if (session.showResult) session.selectNext();
      else session.submit();
      return;
    }

    // 其他编辑目标（兜底）：保留默认
    if (isEditingTarget(event)) return;

    // L3: 全局
    event.preventDefault();
    if (session.showResult) {
      session.selectNext();
    } else {
      session.submit();
    }
  };
}
