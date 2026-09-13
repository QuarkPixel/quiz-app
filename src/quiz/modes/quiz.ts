import { validateQuizQuestions } from "@/lib/validateQuestions";
import type { Question } from "@/types";
import type {
  BankModeDef,
  BankOverviewModel,
  BankQuestionsValidation,
} from "./types";

/** 刷题模式：唯一已实现的题库模式。 */
export const quizModeDef = {
  mode: "quiz",
  label: "刷题模式",

  validateQuestions(raw: unknown): BankQuestionsValidation<Question> {
    return validateQuizQuestions(raw);
  },

  buildOverview(): BankOverviewModel | null {
    // 刷题模式的总览沿用 ReviewView 内置的题型分组逻辑。
    return null;
  },
} satisfies BankModeDef;
