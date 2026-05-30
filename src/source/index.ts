import { SourceImpl } from "$quiz-source";
import type { QuizSource } from "./types";

export function createSource(): QuizSource {
  return new SourceImpl();
}

export type { Bank, BankSummary, ImportBankResult, QuizSource } from "./types";
