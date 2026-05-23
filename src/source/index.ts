import { BundledSource } from "./bundled";
import { LibrarySource } from "./library";
import type { QuizSource } from "./types";

// 由 vite.config.ts 在编译期注入；常量分支，未选中的实现会被 tree-shake
declare const __QUIZ_MODE__: "bundled" | "library";

export function createSource(): QuizSource {
  if (__QUIZ_MODE__ === "bundled") {
    return new BundledSource();
  }
  return new LibrarySource();
}

export type { Bank, BankSummary, ImportBankResult, QuizSource } from "./types";
