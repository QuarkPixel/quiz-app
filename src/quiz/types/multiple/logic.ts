import type { Question } from "../../../types";
import type { QuestionTypeDef } from "../types";
import { choiceLetters, formatChoiceAnswerText, validateChoiceQuestion } from "../_choice";

/**
 * 多选题的纯逻辑（不含 icon）。详见 judgment/logic.ts 头注释。
 */
export const multipleLogic: Omit<QuestionTypeDef, "icon"> = {
  id: "multiple",
  name: "多选题",
  exportPrefix: "m",

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

  getCorrectChoiceLetters(question: Question, shuffledOptions) {
    return choiceLetters(question, shuffledOptions);
  },
};
