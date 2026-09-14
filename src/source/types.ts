import type { BankMode, Question, MemoryQuestion } from "../types";

/** 刷题模式的激活题库 */
export interface QuizBank {
  hash: string;
  name: string;
  mode: "quiz";
  questions: Question[];
}

/** 记忆模式的激活题库（正在实现） */
export interface MemoryBank {
  hash: string;
  name: string;
  mode: "memory";
  questions: MemoryQuestion[];
}

/** 一份激活的题库（含题目数据 + 元信息），按 mode 区分题目结构。 */
export type Bank = QuizBank | MemoryBank;

/** 题库列表项（不含 questions，UI 渲染列表用） */
export interface BankSummary {
  hash: string;
  name: string;
  /** 题库模式；旧数据缺失时按 "quiz" 处理 */
  mode: BankMode;
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

/** 导出题库的结果：文件名 + 文件内容（`{ mode, title?, state?, questions }` 对象） */
export interface BankExportFile {
  filename: string;
  content: string;
  /**
   * 导出成功但有需要告知用户的问题（目前只有一种：进度编码失败，
   * 于是只导出了题库内容）。没有问题时不存在。
   */
  warning?: string;
}

/**
 * 题库源抽象。应用只有一个实现（`BankStore`），接口保留是为了在测试里
 * 注入轻量 mock。
 *
 * onChange：订阅者会在 import / remove / rename / setActive 后被调用，
 * UI 据此重新读取 getActiveBank / listBanks。
 */
export interface QuizSource {
  /** 当前激活的 bank。可能为 null（空库或未选）。 */
  getActiveBank(): Bank | null;

  subscribe(listener: () => void): () => void;

  listBanks(): BankSummary[];
  setActiveBank(hash: string): void;
  importBank(name: string, rawJson: string): Promise<ImportBankResult>;
  renameBank(hash: string, name: string): void;
  removeBank(hash: string): void;
  moveBanksToTop(hashes: string[]): void;

  /**
   * 把进度备份字符串解码后覆盖到指定 bank 的 state。
   * UI 在 importBank 返回 duplicate + stateStr 后让用户确认时调用。
   */
  applyStateToBank(hash: string, stateStr: string): Promise<ApplyStateResult>;

  /**
   * 导出一份题库为可下载内容。
   * 返回 null 表示该 hash 找不到。文件内容是 `{ mode, title?, state?, questions }`，
   * state 为 exportProgress 紧凑字符串，questions 为该模式的题目数组。
   */
  exportBank(hash: string): Promise<BankExportFile | null>;
}
