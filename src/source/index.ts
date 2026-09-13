import { BankStore } from "./bankStore";
import type { QuizSource } from "./types";

export function createSource(): QuizSource {
  return new BankStore();
}

export { BankStore };
export type {
  ApplyStateResult,
  Bank,
  BankExportFile,
  BankSummary,
  ImportBankResult,
  QuizBank,
  QuizSource,
  ReciteBank,
} from "./types";
