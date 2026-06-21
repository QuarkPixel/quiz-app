import type { Question } from "../../../types";
import type { QuestionTypeLogic } from "../types";

/**
 * 判断题的纯逻辑（不含 icon / svelte 组件）。
 *
 * 分两层是为了让 Node-side（vite.config.ts 的题库校验）能安全 import 而不触发
 * @tabler/icons-svelte 的子路径解析（该包 exports 没有 Node 条件）。
 * Svelte 侧用 `./index.ts` 拿到带 icon + Input + Review 的完整版本。
 */
export const judgmentLogic: QuestionTypeLogic = {
  id: "judgment",
  name: "判断题",
  shortName: "判断",

  validate(item, ctx) {
    if (typeof item.answer !== "boolean") {
      return [`${ctx}：判断题 answer 必须是布尔值。`];
    }
    return [];
  },

  evaluateAnswer(question: Question, selectedAnswers) {
    if (selectedAnswers.length === 0) return false;
    return (selectedAnswers[0] === 0) === question.answer;
  },

  formatAnswerText(question: Question) {
    return question.answer ? "正确" : "错误";
  },

  formatCopyText(question: Question, context) {
    const lines = ["判断题：", question.question];

    if (!context.showResult) return lines.join("\n");

    const correctAnswer = question.answer ? "正确" : "错误";
    const selected = context.selectedAnswers[0];

    if (context.isCorrect || selected === undefined) {
      lines.push("", `答案：${correctAnswer}`);
    } else {
      lines.push(
        "",
        `我的答案：${selected === 0 ? "正确" : "错误"}`,
        `实际答案：${correctAnswer}`,
      );
    }

    return lines.join("\n");
  },

  getCorrectChoiceLetters() {
    return "";
  },
};
