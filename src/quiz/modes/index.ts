import type { BankMode } from "@/types";
import { memoryModeDef } from "./memory";
import { quizModeDef } from "./quiz";
import type { BankModeDef } from "./types";

/** 所有题库模式的能力表，按 mode id 索引。 */
export const BANK_MODES: Record<BankMode, BankModeDef> = {
  quiz: quizModeDef,
  memory: memoryModeDef,
};

export { quizModeDef, memoryModeDef };
export type {
  BankModeDef,
  BankOverviewGroup,
  BankOverviewModel,
  BankQuestionsValidation,
} from "./types";
