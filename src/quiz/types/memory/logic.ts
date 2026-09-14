import type { Question } from "../../../types";
import type { QuestionTypeLogic } from "../types";
import {
  QuestionCopyPattern,
  type QuestionCopyContext,
} from "../types";

/**
 * 记忆题型的纯逻辑。
 *
 * 记忆题也是标准 `Question`（`type: "memory"`），只是没有选项、`answer` 永远是
 * 字符串，作答方式是三选一的自评：知道 / 模糊 / 忘记（编码见 `MEMORY_ANSWER_CODE`）。
 * 只有「知道」算答对；「模糊」不改动轮内连对次数，只影响复习阶梯（见
 * `src/features/memory/algorithm.ts` 的 `fuzzyReview`）。
 *
 * 这样它就能直接复用刷题模式的 Input / Review / 判分 / 总览等全部机制，
 * 记忆模式自己的间隔曲线由 `src/features/memory/MemorySession.svelte.ts` 负责。
 */

/**
 * 自评结果。`selectedAnswers` 里存的就是 `MEMORY_ANSWER_CODE` 的编码：
 * 0 = 忘记、1 = 知道、2 = 模糊。
 */
export type MemoryAnswerKind = "forget" | "know" | "fuzzy";

export const MEMORY_ANSWER_CODE = {
  forget: 0,
  know: 1,
  fuzzy: 2,
} as const satisfies Record<MemoryAnswerKind, number>;

/** 把 `selectedAnswers` 里的编码还原成自评结果（认不出来的一律当「忘记」）。 */
export function memoryAnswerKind(code: number | undefined): MemoryAnswerKind {
  if (code === MEMORY_ANSWER_CODE.know) return "know";
  if (code === MEMORY_ANSWER_CODE.fuzzy) return "fuzzy";
  return "forget";
}

/**
 * 答案页上还能做的「降级」操作（和刷题模式的「视作正确」方向相反）：
 *   - 知道 → 可以改判成「模糊」，也可以改判成「记错了（忘记）」
 *   - 模糊 → 只能改判成「记错了（忘记）」
 *   - 忘记 → 没有反悔入口
 */
export function memoryAnswerDowngrades(kind: MemoryAnswerKind): {
  /** 还能改判成「模糊」（只有原答案是「知道」时） */
  fuzzy: boolean;
  /** 还能改判成「记错了 / 忘记」 */
  wrong: boolean;
} {
  return { fuzzy: kind === "know", wrong: kind !== "forget" };
}
export const memoryLogic: QuestionTypeLogic = {
  id: "memory",
  name: "记忆卡片",
  shortName: "记忆",

  validate(item, ctx) {
    const errors: string[] = [];
    const rawAnswer = item.answer;

    if (typeof rawAnswer !== "string" || rawAnswer.length === 0) {
      errors.push(`${ctx}：answer 必须是非空字符串（记忆卡片的背面）。`);
    }
    return errors;
  },

  evaluateAnswer(_question: Question, selectedAnswers) {
    // 只有「知道」算答对；「模糊」/「忘记」都不算（没作答时为 false）
    return selectedAnswers[0] === MEMORY_ANSWER_CODE.know;
  },

  formatAnswerText(question: Question) {
    return String(question.answer);
  },

  formatCopyText(
    question: Question,
    _context: QuestionCopyContext,
    pattern: QuestionCopyPattern,
  ) {
    const lines = [`${question.question}`];
    if (pattern !== QuestionCopyPattern.QuestionOnly) {
      lines.push(`答案：${String(question.answer)}`);
    }
    return lines.join("\n");
  },

  getCorrectChoiceLetters() {
    return "";
  },

  getKeyboardAction(context, event) {
    if (event.scope !== "global") return null;

    // 答案页：空格 / 回车 = 下一题；F = 改判成模糊；M / ; = 记错了（改判成答错）
    if (context.showResult) {
      if (event.code === "Space" || event.code === "Enter") {
        return { kind: "next" };
      }
      if (event.key === "f") {
        return { kind: "mark-fuzzy" };
      }
      if (event.key === "m" || event.key === ";") {
        return { kind: "mark-wrong" };
      }
      return null;
    }

    // 题干页：空格 / 回车 = 知道；F = 模糊；M / ; = 忘记
    if (event.code === "Space" || event.code === "Enter") {
      return {
        kind: "set-selected-answers",
        value: [MEMORY_ANSWER_CODE.know],
        autoSubmit: true,
      };
    }
    if (event.key === "f") {
      return {
        kind: "set-selected-answers",
        value: [MEMORY_ANSWER_CODE.fuzzy],
        autoSubmit: true,
      };
    }
    if (event.key === "m" || event.key === ";") {
      return {
        kind: "set-selected-answers",
        value: [MEMORY_ANSWER_CODE.forget],
        autoSubmit: true,
      };
    }

    return null;
  },
};
