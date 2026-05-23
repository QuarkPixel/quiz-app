import type { Question } from "../types";

/** 一份激活的题库（含问题数据 + 元信息） */
export interface Bank {
  hash: string;
  name: string;
  questions: Question[];
}

/** 题库列表项（不含 questions，UI 渲染列表用） */
export interface BankSummary {
  hash: string;
  name: string;
  count: number;
  addedAt: number;
}

/** 导入题库的结果 */
export type ImportBankResult =
  | { kind: "ok"; hash: string }
  | { kind: "invalid"; errors: string[] }
  | { kind: "duplicate"; hash: string }
  | { kind: "quota" };

/**
 * 题库源抽象。Bundled 与 Library 两种实现共用这一接口。
 *
 * onChange：监听 active bank 或 library 列表变更。订阅者会在 import / remove /
 * rename / setActive 后被调用，UI 据此重新读取 getActiveBank / listBanks。
 */
export interface QuizSource {
  readonly mode: "bundled" | "library";

  /** 当前激活的 bank。Bundled 模式永远非 null；Library 模式可能为 null（空库或未选）。 */
  getActiveBank(): Bank | null;

  subscribe(listener: () => void): () => void;

  /* ── 以下方法仅 Library 实现 ─────────────────────────────────────────── */

  listBanks?(): BankSummary[];
  setActiveBank?(hash: string): void;
  importBank?(name: string, rawJson: string): Promise<ImportBankResult>;
  renameBank?(hash: string, name: string): void;
  removeBank?(hash: string): void;
}
