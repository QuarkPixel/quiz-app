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
 * 字符串，作答方式是把「知道 / 忘记」当作二选一：选了 1（知道）算答对，
 * 选了 0（忘记）算答错。
 *
 * 这样它就能直接复用刷题模式的 Input / Review / 判分 / 总览等全部机制，
 * 记忆模式自己的间隔曲线由 `src/features/memory/MemorySession.svelte.ts` 负责。
 */
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
    // 1 = 知道（算答对），0 = 忘记（算答错）；没作答时为 false
    return selectedAnswers[0] === 1;
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

    // 答案页：空格 / 回车 = 下一题；M / ; = 记错了（把这张改判成答错）
    if (context.showResult) {
      if (event.code === "Space" || event.code === "Enter") {
        return { kind: "next" };
      }
      if (event.key === "m" || event.key === ";") {
        return { kind: "mark-wrong" };
      }
      return null;
    }

    // 题干页：空格 / 回车 = 知道；M / ; = 忘记
    if (event.code === "Space" || event.code === "Enter") {
      return { kind: "set-selected-answers", value: [1], autoSubmit: true };
    }
    if (event.key === "m" || event.key === ";") {
      return { kind: "set-selected-answers", value: [0], autoSubmit: true };
    }

    return null;
  },
};
