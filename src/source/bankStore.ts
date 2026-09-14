import { STORAGE_PREFIX_QUESTIONS, STORAGE_PREFIX_STATE } from "../config";
import { loadGeneralConfig, updateGeneralConfig } from "../generalConfig";
import { exportProgress, importProgress } from "../features/importExport";
import { formatBankFile, parseBankFileJson } from "../lib/bankFile";
import { hashQuestionsJson } from "../lib/hash";
import { loadStoredState } from "../store";
import type { Question, MemoryQuestion } from "../types";
import type {
  ApplyStateResult,
  Bank,
  BankExportFile,
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

/**
 * 题库仓库：维护 general 配置里的 library 索引与 activeBank，并负责
 * 每个题库内容的读写、导入、导出。
 *
 * 这是应用唯一的 QuizSource 实现。
 */
export class BankStore implements QuizSource {
  private index: BankSummary[];
  private activeHash: string | null;
  private listeners = new Set<() => void>();

  /** 已解析的题目缓存，避免每次切换都重新 JSON.parse 大字符串 */
  private questionsCache = new Map<
    string,
    Question[] | MemoryQuestion[]
  >();

  constructor() {
    // 初次读取 general 配置里的 library 索引与 activeBank。
    const config = loadGeneralConfig();
    this.index = config.library;
    this.activeHash = config.activeBank;
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
        questions = JSON.parse(raw) as Question[] | MemoryQuestion[];
      } catch (e) {
        console.error("Failed to parse cached questions:", e);
        return null;
      }
      this.questionsCache.set(this.activeHash, questions);
    }

    if (summary.mode === "memory") {
      return {
        hash: summary.hash,
        name: summary.name,
        mode: "memory",
        questions: questions as MemoryQuestion[],
      };
    }
    return {
      hash: summary.hash,
      name: summary.name,
      mode: "quiz",
      questions: questions as Question[],
    };
  }

  setActiveBank(hash: string): void {
    if (!this.index.some((b) => b.hash === hash)) return;
    if (this.activeHash === hash) return;
    this.activeHash = hash;
    try {
      updateGeneralConfig({ activeBank: hash });
    } catch (e) {
      console.warn("Failed to persist active bank:", e);
    }
    this.emit();
  }

  async importBank(name: string, rawJson: string): Promise<ImportBankResult> {
    const parsed = parseBankFileJson(rawJson);
    if (!parsed.ok) return { kind: "invalid", errors: parsed.errors };

    // 统一规范化（minified）：hash / 存储 / 回灌全用这一份字节。
    // hash 只覆盖 questions 数组，和旧版保持一致，进度哈希可继承。
    const canonical = JSON.stringify(parsed.questions);
    const hash = await hashQuestionsJson(canonical);

    if (this.index.some((b) => b.hash === hash)) {
      // 文件里若带进度，把 stateStr 透传给 UI，让用户决定要不要覆盖现有进度
      return parsed.state !== undefined
        ? { kind: "duplicate", hash, stateStr: parsed.state }
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
      // 优先用题库文件里的标题；没有才回退到调用方给的名称
      // （文件名 / 剪贴板题库 / 另存为新题库时传入的名称）。
      name: parsed.title ?? (name.trim() || "未命名题库"),
      mode: parsed.mode,
      count: parsed.questions.length,
      addedAt: Date.now(),
    };
    const nextIndex = [...this.index, newSummary];
    try {
      updateGeneralConfig({ library: nextIndex });
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
    this.questionsCache.set(hash, parsed.questions);

    // 首次导入：自动设为 active
    if (this.activeHash === null) {
      this.activeHash = hash;
      try {
        updateGeneralConfig({ activeBank: hash });
      } catch {
        /* ignore */
      }
    }

    // 还原进度（如有）。题库本身已经入库，state 失败用 stateError 让 UI 显式告知用户。
    let stateError: string | undefined;
    if (parsed.state !== undefined) {
      try {
        const decoded = await importProgress(
          parsed.state,
          hash,
          parsed.questions,
        );
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
    const questions = await this.readQuestions(hash);
    if (!questions) return { ok: false, error: "题库不存在" };

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

  async exportBank(hash: string): Promise<BankExportFile | null> {
    const summary = this.index.find((b) => b.hash === hash);
    if (!summary) return null;

    const questions = await this.readQuestions(hash);
    if (!questions) return null;

    // 库里存的就是 canonical 形式，bank.hash 就是 canonical hash，直接用即可。
    const storedState = loadStoredState(hash);
    // 进度编码失败（比如盘上还留着题库里已不存在的题目 id）不该让整份题库导不出去：
    // 丢掉的只是进度备份，题目本身照常导出，并附一句说明。
    let stateEncoded: string | undefined;
    let warning: string | undefined;
    try {
      stateEncoded = await exportProgress(storedState, hash, questions);
    } catch (e) {
      stateEncoded = undefined;
      warning = `进度没有一起导出：${
        e instanceof Error ? e.message : "进度编码失败"
      }题目不受影响，导入后进度会从零开始。`;
    }

    const mastered = storedState.masteredIds.length;
    const total = questions.length;
    const filename = `${summary.name} (${mastered} of ${total}).json`;

    const fileContent = formatBankFile({
      mode: summary.mode,
      title: summary.name,
      questions,
      ...(stateEncoded === undefined ? {} : { state: stateEncoded }),
    });

    return warning === undefined
      ? { filename, content: fileContent }
      : { filename, content: fileContent, warning };
  }

  renameBank(hash: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const idx = this.index.findIndex((b) => b.hash === hash);
    if (idx === -1) return;
    const nextIndex = this.index.map((b, i) =>
      i === idx ? { ...b, name: trimmed } : b,
    );
    if (!this.persistLibrary(nextIndex, "Failed to rename bank:")) return;
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
    const isUnchanged = nextIndex.every(
      (bank, index) => bank.hash === this.index[index]?.hash,
    );
    if (isUnchanged) return;

    if (!this.persistLibrary(nextIndex, "Failed to reorder library index:")) {
      return;
    }
    this.index = nextIndex;
    this.emit();
  }

  removeBank(hash: string): void {
    const idx = this.index.findIndex((b) => b.hash === hash);
    if (idx === -1) return;

    const nextIndex = this.index.filter((b) => b.hash !== hash);
    if (!this.persistLibrary(nextIndex, "Failed to update library index:")) {
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
        updateGeneralConfig({ activeBank: this.activeHash });
      } catch {
        /* ignore */
      }
    }
    this.emit();
  }

  /** 写入 library 索引；失败仅 warn 并返回 false（调用方据此决定是否回滚）。 */
  private persistLibrary(nextIndex: BankSummary[], warning: string): boolean {
    try {
      updateGeneralConfig({ library: nextIndex });
      return true;
    } catch (e) {
      console.warn(warning, e);
      return false;
    }
  }

  /** 读取并缓存某个题库的题目数组。 */
  private async readQuestions(
    hash: string,
  ): Promise<Question[] | MemoryQuestion[] | null> {
    const cached = this.questionsCache.get(hash);
    if (cached) return cached;

    const raw = localStorage.getItem(questionsKey(hash));
    if (!raw) return null;
    try {
      const questions = JSON.parse(raw) as Question[] | MemoryQuestion[];
      this.questionsCache.set(hash, questions);
      return questions;
    } catch (e) {
      console.error("Failed to parse questions:", e);
      return null;
    }
  }
}
