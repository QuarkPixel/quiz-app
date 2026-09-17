/**
 * 会话层（`QuizSession` / `MemorySession`）之间共享的类型。
 *
 * 单独放一个文件，是为了让记忆模式、总览、复制按钮这些使用方不必再从
 * `QuizSession.svelte.ts` 里「借」类型：两个模式共用同一套会话骨架，
 * 类型却只能挂在刷题模式那个类上，是层级错位（记忆模式并不依赖刷题会话）。
 */

import type { Question } from "@/types";
import type { QuestionCopyPattern } from "@/quiz/types/types";

/** 复制按钮的三态：空闲 / 刚复制成功 / 复制失败，都是短暂展示。 */
export type CopyQuestionStatus = "idle" | "copied" | "error";

/** 一次复制的结果。`unavailable` = 当前没有可复制的题（不是失败）。 */
export type CopyQuestionResult = "copied" | "error" | "unavailable";

export interface CopyQuestionOptions {
  /** 快捷键触发时用 toast 提供反馈；按钮触发时用按钮状态反馈。 */
  announce?: boolean;
}

/**
 * 复制任意一道题所需的最小会话形状：刷题与记忆两个 session 都满足，
 * 所以 `QuestionCopyStatusStore` 不必绑定到某一个具体类上。
 */
export interface CopyQuestionSession {
  copyQuestion(
    question: Question,
    options?: CopyQuestionOptions,
    pattern?: QuestionCopyPattern,
  ): Promise<CopyQuestionResult>;
}

/**
 * 容器注入给键盘层的纯 UI 动作。
 *
 * 属于「视图」而不是「会话」：dialog 开关、退出本轮都只活在组件里，
 * 但快捷键要能按到它们，所以由容器实现、键盘层调用。
 */
export interface KeyboardUiActions {
  toggleReview: () => void;
  toggleSettings: () => void;
}
