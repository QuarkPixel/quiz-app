import type { Question } from "../../../types";
import { finalizeQuestionCopyText } from "../copy";
import type { QuestionTypeLogic } from "../types";
import { submitOrNextAction } from "../_choice";

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

  formatCopyText(question: Question, context, pattern) {
    const lines = ["判断题：", question.question];

    const correctAnswer = question.answer ? "正确" : "错误";
    const selected = context.selectedAnswers[0];
    return finalizeQuestionCopyText(lines, pattern, {
      correctAnswer,
      myAnswer: selected === undefined ? null : selected === 0 ? "正确" : "错误",
    });
  },

  getCorrectChoiceLetters() {
    return "";
  },

  getKeyboardAction(context, event) {
    if (event.scope !== "global") return null;

    const submitAction = submitOrNextAction(context.showResult, event);
    if (submitAction) return submitAction;

    if (context.showResult) return null;

    if (event.key === "a" || event.key === "1") {
      return {
        kind: "set-selected-answers",
        value: [0],
        autoSubmit: context.autoSubmitOnSelection,
      };
    }
    if (event.key === "b" || event.key === "2") {
      return {
        kind: "set-selected-answers",
        value: [1],
        autoSubmit: context.autoSubmitOnSelection,
      };
    }

    return null;
  },
};
