import type { BankMode } from "@/types";
import { quizModeDef } from "./quiz";
import { reciteModeDef } from "./recite";
import type { BankModeDef } from "./types";

/** 所有题库模式的能力表，按 mode id 索引。 */
export const BANK_MODES: Record<BankMode, BankModeDef> = {
  quiz: quizModeDef,
  recite: reciteModeDef,
};

export { quizModeDef, reciteModeDef };
export type {
  BankModeDef,
  BankOverviewGroup,
  BankOverviewModel,
  BankQuestionsValidation,
} from "./types";
