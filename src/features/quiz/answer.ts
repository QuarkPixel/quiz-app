import type { Question } from "../../types";

interface ShuffledOption {
  originalIndex: number;
}

export function normalizeBlankAnswer(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z]/g, "");
}

export function canSubmitCurrentAnswer(
  question: Question | null,
  selectedAnswers: number[],
  blankAnswerInput: string,
): boolean {
  if (!question) return false;

  if (question.type === "blank") {
    return normalizeBlankAnswer(blankAnswerInput).length > 0;
  }

  return selectedAnswers.length > 0;
}

export function evaluateAnswer(
  question: Question,
  selectedAnswers: number[],
  blankAnswerInput: string,
): boolean {
  if (question.type === "blank") {
    const userNormalized = normalizeBlankAnswer(blankAnswerInput);
    const answerNormalized = normalizeBlankAnswer(question.answer as string);
    return userNormalized.length > 0 && userNormalized === answerNormalized;
  }

  if (question.type === "judgment") {
    return (selectedAnswers[0] === 0) === question.answer;
  }

  const correctAnswers = question.answer as number[];
  return (
    selectedAnswers.length === correctAnswers.length &&
    selectedAnswers.every((answer) => correctAnswers.includes(answer))
  );
}

export function getCorrectChoiceLetters(
  question: Question,
  shuffledOptions: ShuffledOption[],
): string {
  if (question.type === "judgment" || question.type === "blank") {
    return "";
  }

  const correctAnswers = question.answer as number[];
  return correctAnswers
    .map((originalIndex) => {
      const optionPosition = shuffledOptions.findIndex(
        (option) => option.originalIndex === originalIndex,
      );
      return String.fromCharCode(65 + optionPosition);
    })
    .sort()
    .join("");
}
