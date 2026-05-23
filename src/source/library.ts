import {
  STORAGE_KEY_ACTIVE_BANK,
  STORAGE_KEY_LIBRARY,
  STORAGE_PREFIX_QUESTIONS,
  STORAGE_PREFIX_STATE,
} from "../config";
import { hashQuestionsJson } from "../lib/hash";
import { validateQuestions } from "../lib/validateQuestions";
import type { Question } from "../types";
import type { Bank, BankSummary, ImportBankResult, QuizSource } from "./types";

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

    const validation = validateQuestions(parsed);
    if (!validation.ok) return { kind: "invalid", errors: validation.errors };

    const hash = await hashQuestionsJson(rawJson);
    if (this.index.some((b) => b.hash === hash)) {
      return { kind: "duplicate", hash };
    }

    // 写入顺序：先写大 blob，再写索引；前者失败直接返回 quota，后者失败回滚 blob。
    try {
      localStorage.setItem(questionsKey(hash), rawJson);
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

    this.emit();
    return { kind: "ok", hash };
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
