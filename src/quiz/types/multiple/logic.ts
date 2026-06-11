import type { Question } from "../../../types";
import type { QuestionTypeLogic } from "../types";
import {
  choiceLetters,
  formatChoiceAnswerText,
  formatChoiceCopyText,
  validateChoiceQuestion,
} from "../_choice";

/**
 * 多选题的纯逻辑（不含 icon / svelte 组件）。详见 judgment/logic.ts 头注释。
 */
export const multipleLogic: QuestionTypeLogic = {
  id: "multiple",
  name: "多选题",

  validate(item, ctx) {
    return validateChoiceQuestion(item, ctx, /* isSingle */ false);
  },

  evaluateAnswer(question: Question, selectedAnswers) {
    const correctAnswers = question.answer as number[];
    if (selectedAnswers.length === 0) return false;
    return (
      selectedAnswers.length === correctAnswers.length &&
      selectedAnswers.every((a) => correctAnswers.includes(a))
    );
  },

  formatAnswerText(question: Question) {
    return formatChoiceAnswerText(question);
  },

  formatCopyText(question, context) {
    return formatChoiceCopyText(question, context, "多选题");
  },

  getCorrectChoiceLetters(question: Question, shuffledOptions) {
    return choiceLetters(question, shuffledOptions);
  },
};
