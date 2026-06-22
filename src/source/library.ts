import {
  STORAGE_KEY_ACTIVE_BANK,
  STORAGE_KEY_LIBRARY,
  STORAGE_PREFIX_QUESTIONS,
  STORAGE_PREFIX_STATE,
} from "../config";
import { exportProgress, importProgress } from "../features/importExport";
import { hashQuestionsJson } from "../lib/hash";
import { validateQuestions } from "../lib/validateQuestions";
import { loadStoredState } from "../store";
import type { Question } from "../types";
import type {
  ApplyStateResult,
  Bank,
  BankSummary,
  ImportBankResult,
  QuizSource,
} from "./types";

function questionsKey(hash: string): string {
  return STORAGE_PREFIX_QUESTIONS + hash;
}
function stateKey(hash: string): string {
  return STORAGE_PREFIX_STATE + hash;
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    // 兜底：部分老浏览器仅有 code
    (e as { code?: number }).code === 22
  );
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch (e) {
    console.warn(`Failed to parse ${key}:`, e);
    return fallback;
  }
}

export class LibrarySource implements QuizSource {
  readonly mode = "library" as const;

  private index: BankSummary[];
  private activeHash: string | null;
  private listeners = new Set<() => void>();

  /** 已解析的题目缓存，避免每次切换都重新 JSON.parse 大字符串 */
  private questionsCache = new Map<string, Question[]>();

  constructor() {
    this.index = readJson<BankSummary[]>(STORAGE_KEY_LIBRARY, []);
    const savedActive = localStorage.getItem(STORAGE_KEY_ACTIVE_BANK);
    this.activeHash =
      savedActive && this.index.some((b) => b.hash === savedActive)
        ? savedActive
        : this.index[0]?.hash ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  listBanks(): BankSummary[] {
    return [...this.index];
  }

  getActiveBank(): Bank | null {
    if (this.activeHash === null) return null;
    const summary = this.index.find((b) => b.hash === this.activeHash);
    if (!summary) return null;

    let questions = this.questionsCache.get(this.activeHash);
    if (!questions) {
      const raw = localStorage.getItem(questionsKey(this.activeHash));
      if (!raw) return null;
      try {
        questions = JSON.parse(raw) as Question[];
      } catch (e) {
        console.error("Failed to parse cached questions:", e);
        return null;
      }
      this.questionsCache.set(this.activeHash, questions);
    }
    return { hash: summary.hash, name: summary.name, questions };
  }

  setActiveBank(hash: string): void {
    if (!this.index.some((b) => b.hash === hash)) return;
    if (this.activeHash === hash) return;
    this.activeHash = hash;
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE_BANK, hash);
    } catch (e) {
      console.warn("Failed to persist active bank:", e);
    }
    this.emit();
  }

  async importBank(name: string, rawJson: string): Promise<ImportBankResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch (e) {
      return { kind: "invalid", errors: [`JSON 解析失败：${(e as Error).message}`] };
    }

    // 检测两种形式：
    //   1. 数组：纯题目
    //   2. 对象 { state?: string, questions: [...] }：导出文件，带进度备份
    let questionsData: unknown;
    let stateStr: string | null = null;

    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      "questions" in parsed
    ) {
      questionsData = (parsed as { questions: unknown }).questions;
      const stateField = (parsed as { state?: unknown }).state;
      if (typeof stateField === "string") stateStr = stateField;
    } else {
      questionsData = parsed;
    }

    const validation = validateQuestions(questionsData);
    if (!validation.ok) return { kind: "invalid", errors: validation.errors };

    // 统一规范化（minified）：hash / 存储 / 回灌全用这一份字节
    const canonical = JSON.stringify(questionsData);
    const hash = await hashQuestionsJson(canonical);

    if (this.index.some((b) => b.hash === hash)) {
      // 文件里若带进度，把 stateStr 透传给 UI，让用户决定要不要覆盖现有进度
      return stateStr !== null
        ? { kind: "duplicate", hash, stateStr }
        : { kind: "duplicate", hash };
    }

    // 写入顺序：先写大 blob，再写索引；前者失败直接返回 quota，后者失败回滚 blob。
    try {
      localStorage.setItem(questionsKey(hash), canonical);
    } catch (e) {
      if (isQuotaError(e)) return { kind: "quota" };
      throw e;
    }

    const newSummary: BankSummary = {
      hash,
      name: name || "未命名题库",
      count: validation.questions.length,
      addedAt: Date.now(),
    };
    const nextIndex = [...this.index, newSummary];
    try {
      localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(nextIndex));
    } catch (e) {
      // 回滚 questions blob，保持原子性
      try {
        localStorage.removeItem(questionsKey(hash));
      } catch {
        /* ignore */
      }
      if (isQuotaError(e)) return { kind: "quota" };
      throw e;
    }

    this.index = nextIndex;
    this.questionsCache.set(hash, validation.questions);

    // 首次导入：自动设为 active
    if (this.activeHash === null) {
      this.activeHash = hash;
      try {
        localStorage.setItem(STORAGE_KEY_ACTIVE_BANK, hash);
      } catch {
        /* ignore */
      }
    }

    // 还原进度（如有）。题库本身已经入库，state 失败用 stateError 让 UI 显式告知用户。
    let stateError: string | undefined;
    if (stateStr !== null) {
      try {
        const decoded = await importProgress(stateStr, hash, validation.questions);
        try {
          localStorage.setItem(stateKey(hash), JSON.stringify(decoded));
        } catch (e) {
          stateError = e instanceof Error ? e.message : "写入失败";
        }
      } catch (e) {
        stateError = e instanceof Error ? e.message : "解码失败";
      }
    }

    this.emit();
    return stateError !== undefined
      ? { kind: "ok", hash, stateError }
      : { kind: "ok", hash };
  }

  async applyStateToBank(
    hash: string,
    stateStr: string,
  ): Promise<ApplyStateResult> {
    if (!this.index.some((b) => b.hash === hash)) {
      return { ok: false, error: "题库不存在" };
    }
    let questions = this.questionsCache.get(hash);
    if (!questions) {
      const rawQuestions = localStorage.getItem(questionsKey(hash));
      if (!rawQuestions) return { ok: false, error: "题库不存在" };
      try {
        questions = JSON.parse(rawQuestions) as Question[];
      } catch {
        return { ok: false, error: "题库解析失败" };
      }
      this.questionsCache.set(hash, questions);
    }

    let decoded;
    try {
      decoded = await importProgress(stateStr, hash, questions);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "解码失败" };
    }
    try {
      localStorage.setItem(stateKey(hash), JSON.stringify(decoded));
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "写入失败" };
    }
    this.emit();
    return { ok: true };
  }

  async exportBank(
    hash: string,
  ): Promise<{ filename: string; content: string } | null> {
    const summary = this.index.find((b) => b.hash === hash);
    if (!summary) return null;

    const rawQuestions = localStorage.getItem(questionsKey(hash));
    if (!rawQuestions) return null;

    let parsedQuestions: Question[];
    try {
      parsedQuestions = JSON.parse(rawQuestions) as Question[];
    } catch (e) {
      console.error("Failed to parse questions for export:", e);
      return null;
    }

    // 库里存的就是 canonical 形式，bank.hash 就是 canonical hash，直接用即可。
    const storedState = loadStoredState(hash, {
      usePersistedDefaultSettings: true,
    });
    const stateEncoded = await exportProgress(storedState, hash, parsedQuestions);

    const mastered = storedState.masteredIds.length;
    const total = parsedQuestions.length;
    const filename = `${summary.name} (${mastered} of ${total}).json`;

    const fileContent = JSON.stringify(
      { state: stateEncoded, questions: parsedQuestions },
      null,
      2,
    );

    return { filename, content: fileContent };
  }

  renameBank(hash: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const idx = this.index.findIndex((b) => b.hash === hash);
    if (idx === -1) return;
    const nextIndex = this.index.map((b, i) => (i === idx ? { ...b, name: trimmed } : b));
    try {
      localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(nextIndex));
    } catch (e) {
      console.warn("Failed to rename bank:", e);
      return;
    }
    this.index = nextIndex;
    this.emit();
  }

  moveBanksToTop(hashes: string[]): void {
    if (hashes.length === 0) return;

    const seen = new Set<string>();
    const orderedSelection = hashes.filter((hash) => {
      if (seen.has(hash)) return false;
      seen.add(hash);
      return this.index.some((bank) => bank.hash === hash);
    });
    if (orderedSelection.length === 0) return;

    const selected = new Set(orderedSelection);
    const selectedBanks = this.index.filter((bank) => selected.has(bank.hash));
    if (selectedBanks.length === 0) return;

    const remainingBanks = this.index.filter((bank) => !selected.has(bank.hash));
    const nextIndex = [...selectedBanks, ...remainingBanks];
    const isUnchanged = nextIndex.every((bank, index) => bank.hash === this.index[index]?.hash);
    if (isUnchanged) return;

    try {
      localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(nextIndex));
    } catch (e) {
      console.warn("Failed to reorder library index:", e);
      return;
    }

    this.index = nextIndex;
    this.emit();
  }

  removeBank(hash: string): void {
    const idx = this.index.findIndex((b) => b.hash === hash);
    if (idx === -1) return;

    const nextIndex = this.index.filter((b) => b.hash !== hash);
    try {
      localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify(nextIndex));
    } catch (e) {
      console.warn("Failed to update library index:", e);
      return;
    }

    // 索引更新成功后，清掉 questions/state（这些失败不影响逻辑正确性）
    try {
      localStorage.removeItem(questionsKey(hash));
    } catch {
      /* ignore */
    }
    try {
      localStorage.removeItem(stateKey(hash));
    } catch {
      /* ignore */
    }

    this.index = nextIndex;
    this.questionsCache.delete(hash);

    if (this.activeHash === hash) {
      this.activeHash = nextIndex[0]?.hash ?? null;
      try {
        if (this.activeHash !== null) {
          localStorage.setItem(STORAGE_KEY_ACTIVE_BANK, this.activeHash);
        } else {
          localStorage.removeItem(STORAGE_KEY_ACTIVE_BANK);
        }
      } catch {
        /* ignore */
      }
    }
    this.emit();
  }
}
