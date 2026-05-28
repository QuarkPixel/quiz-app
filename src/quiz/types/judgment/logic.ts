import type { Question } from "../../../types";
import type { QuestionTypeDef } from "../types";

/**
 * 判断题的纯逻辑（不含 icon）。
 *
 * 分两层是为了让 Node-side（vite.config.ts 的题库校验）能安全 import 而不触发
 * @tabler/icons-svelte 的子路径解析（该包 exports 没有 Node 条件）。
 * Svelte 侧用 `./index.ts` 拿到带 icon 的完整版本。
 */
export const judgmentLogic: Omit<QuestionTypeDef, "icon"> = {
  id: "judgment",
  name: "判断题",
  exportPrefix: "j",

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

  getCorrectChoiceLetters() {
    return "";
  },
};
