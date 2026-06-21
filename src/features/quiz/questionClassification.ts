import type { Question, RuntimeState } from "@/types";

/** 题目在学习进度上的归属：已掌握 / 学习中 / 未学习。 */
export type LearningStatus = "mastered" | "learning" | "unlearned";

/** 题目的正误状态。未学习题没有作答记录，记为 "none"。 */
export type Correctness = "correct" | "incorrect" | "none";

/**
 * 归一化的题目分类入口。
 *
 * 之前 ReviewView 的总览、筛选各自内联判断「是否掌握 / 是否错过」，口径零散。
 * 这里提供唯一实现，所有需要判断题目学习状态或正误的地方都走这一份。
 */
export function getLearningStatus(
  question: Question,
  state: RuntimeState,
): LearningStatus {
  if (state.masteredIds.includes(question.id)) return "mastered";
  if (state.activePool.some((item) => item.id === question.id)) {
    return "learning";
  }
  return "unlearned";
}

/**
 * 题目是否曾答错（归一化的「错误」判定）。
 *
 * - 已掌握：看 `masteredMistakes[id]`
 * - 学习中：看活动池 item 的 `hasEverMistaken`
 * - 未学习：无作答记录，固定 false
 */
export function hasEverMistakenQuestion(
  question: Question,
  state: RuntimeState,
): boolean {
  if (state.masteredIds.includes(question.id)) {
    return state.masteredMistakes[question.id] === true;
  }
  const activeItem = state.activePool.find((item) => item.id === question.id);
  return activeItem?.hasEverMistaken ?? false;
}

/**
 * 题目的正误状态。
 *
 * 未学习 → "none"（无作答记录，不参与正误筛选）；
 * 已掌握 / 学习中 → 曾答错为 "incorrect"，否则 "correct"。
 */
export function getCorrectness(
  question: Question,
  state: RuntimeState,
): Correctness {
  if (getLearningStatus(question, state) === "unlearned") return "none";
  return hasEverMistakenQuestion(question, state) ? "incorrect" : "correct";
}
