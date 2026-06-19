/**
 * 全局键盘处理器：把 QuizView 内 80 行 handleKeydown 抽出来。
 *
 * 大多数快捷键直接调 session 方法；dialog 类（toggleReview / toggleSettings）
 * 留在 QuizView 局部，通过 uiActions 注入。
 */

import {
  hasSelectedText,
  isEditingTarget,
  isInteractiveTarget,
} from "../../features/quiz";
import { SHORTCUTS } from "../../config";
import type { QuizSession } from "./QuizSession.svelte";

export interface KeyboardUiActions {
  toggleReview: () => void;
  toggleSettings: () => void;
}

export function createKeyboardHandler(
  session: QuizSession,
  uiActions: KeyboardUiActions,
): (event: KeyboardEvent) => void {
  return (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;

    const isMod = event.metaKey || event.ctrlKey;
    const target =
      typeof Element !== "undefined" && event.target instanceof Element
        ? event.target
        : null;
    const inDialog = target?.closest('[role="dialog"]') !== null;
    const inBlankInput = target?.classList.contains("blank-input") === true;

    // Cmd/Ctrl + 单键：全局快捷键。
    if (isMod && !event.altKey && !event.shiftKey) {
      const key = event.key.toLowerCase();
      // Cmd+B (sidebar) 留给 Sidebar context 处理
      if (key === SHORTCUTS.sidebar) return;
      if (inDialog) return;
      if (key === SHORTCUTS.copyQuestion) {
        if (hasSelectedText() || isEditingTarget(event)) return;
        event.preventDefault();
        void session.copyCurrentQuestion({ announce: true });
        return;
      }
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
      if (__QUIZ_MODE__ === "library" && key === SHORTCUTS.toggleSound) {
        event.preventDefault();
        session.toggleSound();
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

    // L2: 设置 / 总览 dialog 内 — Enter 让输入框 blur 触发 onchange
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

    // 其他原生 / ARIA 交互目标：保留默认键盘行为。
    if (isInteractiveTarget(event)) return;

    // L3: 全局
    event.preventDefault();
    if (session.showResult) {
      session.selectNext();
    } else {
      session.submit();
    }
  };
}
