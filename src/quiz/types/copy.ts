import { QuestionCopyPattern } from "./types";

interface QuestionCopyAnswerBlock {
  correctAnswer: string;
  myAnswer?: string | null;
}

export function finalizeQuestionCopyText(
  lines: string[],
  pattern: QuestionCopyPattern,
  answers: QuestionCopyAnswerBlock,
): string {
  switch (pattern) {
    case QuestionCopyPattern.QuestionOnly:
      return lines.join("\n");

    case QuestionCopyPattern.QuestionWithAnswer:
      return [...lines, "", `答案：${answers.correctAnswer}`].join("\n");

    case QuestionCopyPattern.QuestionWithMyAnswerAndAnswer: {
      const myAnswer = answers.myAnswer?.trim();
      if (!myAnswer) {
        return finalizeQuestionCopyText(
          lines,
          QuestionCopyPattern.QuestionWithAnswer,
          answers,
        );
      }
      return [
        ...lines,
        "",
        `我的答案：${myAnswer}`,
        `实际答案：${answers.correctAnswer}`,
      ].join("\n");
    }
  }
}
