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
  | {
      kind: "ok";
      hash: string;
      /** 题库导入成功，但文件里附带的进度备份解码/写入失败 */
      stateError?: string;
    }
  | { kind: "invalid"; errors: string[] }
  | {
      kind: "duplicate";
      hash: string;
      /** 文件里附带的进度备份字符串。UI 可据此询问用户是否覆盖现有进度 */
      stateStr?: string;
    }
  | { kind: "quota" };

/** 进度覆盖结果 */
export type ApplyStateResult = { ok: true } | { ok: false; error: string };

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

  /**
   * 把进度备份字符串解码后覆盖到指定 bank 的 state。
   * UI 在 importBank 返回 duplicate + stateStr 后让用户确认时调用。
   */
  applyStateToBank?(hash: string, stateStr: string): Promise<ApplyStateResult>;

  /**
   * 导出一份题库为可下载内容。
   * 返回 null 表示该 hash 找不到。文件内容是 { state, questions } 对象，
   * state 为 exportProgress 紧凑字符串，questions 为题目数组。
   */
  exportBank?(hash: string): Promise<{ filename: string; content: string } | null>;
}
