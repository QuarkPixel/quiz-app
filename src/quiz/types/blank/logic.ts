import type { Question } from "../../../types";
import { matchAnswer } from "../../../features/quiz/answerMatcher";
import type { QuestionTypeLogic } from "../types";

/**
 * 填空题的纯逻辑（不含 icon / svelte 组件）。详见 judgment/logic.ts 头注释。
 */
export const blankLogic: QuestionTypeLogic = {
  id: "blank",
  name: "填空题",
  shortName: "填空",

  validate(item, ctx) {
    const answer = item.answer;
    if (typeof answer === "string") return [];
    if (Array.isArray(answer) && answer.every((s) => typeof s === "string")) {
      return [];
    }
    return [`${ctx}：填空题 answer 必须是字符串或字符串数组。`];
  },

  evaluateAnswer(question: Question, _selectedAnswers, blankAnswerInputs) {
    const answers = Array.isArray(question.answer)
      ? (question.answer as string[])
      : [question.answer as string];
    if (blankAnswerInputs.some((s) => s.trim().length === 0)) return false;
    return answers.every((ans, i) => matchAnswer(ans, blankAnswerInputs[i] ?? ""));
  },

  formatAnswerText(question: Question) {
    if (Array.isArray(question.answer)) {
      return (question.answer as string[]).join(" | ");
    }
    return question.answer as string;
  },

  formatCopyText(question: Question, context) {
    const lines = ["填空题：", question.question];

    if (!context.showResult) return lines.join("\n");

    const correctAnswer = Array.isArray(question.answer)
      ? (question.answer as string[]).join(" | ")
      : (question.answer as string);
    const myAnswer = context.blankAnswerInputs
      .map((value) => value.trim())
      .filter(Boolean)
      .join(" | ");

    if (context.isCorrect || !myAnswer) {
      lines.push("", `答案：${correctAnswer}`);
    } else {
      lines.push("", `我的答案：${myAnswer}`, `实际答案：${correctAnswer}`);
    }

    return lines.join("\n");
  },

  getCorrectChoiceLetters() {
    return "";
  },
};
