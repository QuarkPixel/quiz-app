import { readText } from "clipboard-polyfill";
import type { ImportBankResult, QuizSource } from "../source/types";

const CLIPBOARD_DISPLAY_NAME = "剪贴板内容";
const CLIPBOARD_BANK_NAME = "剪贴板题库";

export interface BankFileMessage {
  title: string;
  text: string;
}

export interface BankImportFailure {
  readonly fileName: string;
  getReason(): string;
}

abstract class BaseImportFailure implements BankImportFailure {
  constructor(readonly fileName: string) {}

  abstract getReason(): string;
}

class UnexpectedImportFailure extends BaseImportFailure {
  constructor(
    fileName: string,
    private readonly detail: string,
  ) {
    super(fileName);
  }

  getReason(): string {
    return this.detail;
  }
}

class ClipboardImportFailure extends BaseImportFailure {
  constructor(
    fileName: string,
    private readonly detail: string,
  ) {
    super(fileName);
  }

  getReason(): string {
    return this.detail;
  }
}

class InvalidQuestionBankFailure extends BaseImportFailure {
  constructor(
    fileName: string,
    private readonly errors: string[],
  ) {
    super(fileName);
  }

  getReason(): string {
    const head = this.errors.slice(0, 3).join("；");
    const rest =
      this.errors.length > 3 ? `；还有 ${this.errors.length - 3} 条问题` : "";
    return head + rest;
  }
}

class DuplicateQuestionBankFailure extends BaseImportFailure {
  getReason(): string {
    return "题库已存在。";
  }
}

class QuotaImportFailure extends BaseImportFailure {
  getReason(): string {
    return "浏览器存储空间不足，无法导入。";
  }
}

class StateRestoreFailure extends BaseImportFailure {
  constructor(
    fileName: string,
    private readonly detail: string,
  ) {
    super(fileName);
  }

  getReason(): string {
    return `题库已导入，但进度备份还原失败：${this.detail}`;
  }
}

class OverwriteDeclinedFailure extends BaseImportFailure {
  getReason(): string {
    return "题库已存在，已保留当前进度。";
  }
}

class OverwriteApplyFailure extends BaseImportFailure {
  constructor(
    fileName: string,
    private readonly detail: string,
  ) {
    super(fileName);
  }

  getReason(): string {
    return `进度替换失败：${this.detail}`;
  }
}

export type BankImportOutcome =
  | { kind: "success"; fileName: string }
  | { kind: "failure"; failure: BankImportFailure };

export interface OverwriteImportRequest {
  fileName: string;
  hash: string;
  stateStr: string;
  bankName: string;
}

/**
 * 「读一个文件」这一步的产出：要么已经有结果了，要么卡在「要不要覆盖」上。
 *
 * 它是 `openImport()` 的输入——把一串 step 摊成导入会话的初始状态。
 */
export type FileImportStep =
  | { kind: "done"; outcome: BankImportOutcome }
  | { kind: "needs-overwrite"; request: OverwriteImportRequest };

export type BankImportPrompt =
  | { kind: "overwrite"; request: OverwriteImportRequest }
  | { kind: "summary"; message: BankFileMessage };

// ── 导入会话的状态机 ────────────────────────────────────────────────────────
//
// 一次导入的进程是**两个阶段轮流**：文件一个个读，读到「题库已存在、备份里
// 还带着进度」的那种就先停下来问用户要不要覆盖，问完接着读下一个。
//
// 以前这件事由三个平行字段拼出来（`outcomes` / `overwriteRequests` /
// `overwriteIndex`）：待问清单和已出结果分在两个数组里，靠一个整数游标指
// 「问到第几个」。于是「游标指到数组外面」「清单空了游标还没归零」这类组合
// 在类型上完全合法，只能靠调用方守规矩才不出事；`currentPrompt()` 也得写
// 成「取不到就是问完了」这种靠 undefined 兜底的写法。
//
// 现在收敛成两支：要么**还有一张要问**（`pending` 是非空元组，「现在问什么」
// 就是它的头一个，不可能取不到），要么**问完了**（只剩结果可以汇总）。
// 待问清单一旦为空，类型上就只剩 `done` 这一支，游标这个概念直接消失。

export type ImportSessionPhase =
  | {
      kind: "asking";
      pending: readonly [OverwriteImportRequest, ...OverwriteImportRequest[]];
      settled: readonly BankImportOutcome[];
    }
  | { kind: "done"; settled: readonly BankImportOutcome[] };

function donePhase(settled: readonly BankImportOutcome[]): ImportSessionPhase {
  return { kind: "done", settled };
}

/** 由「头一张待问」和剩余待问拼出 `asking`；没有待问就是 `done`。 */
function askingPhase(
  settled: readonly BankImportOutcome[],
  [head, ...rest]: readonly OverwriteImportRequest[],
): ImportSessionPhase {
  if (head === undefined) return donePhase(settled);
  return { kind: "asking", pending: [head, ...rest], settled };
}

/**
 * 读完全部文件之后开一轮会话：把每一步摊成「已经出结果的」和「还要问的」。
 *
 * 顺序即用户看到的顺序：结果按文件顺序累积，覆盖询问也按文件顺序排队。
 */
export function openImport(
  steps: readonly FileImportStep[],
): ImportSessionPhase {
  const settled: BankImportOutcome[] = [];
  const pending: OverwriteImportRequest[] = [];
  for (const step of steps) {
    if (step.kind === "done") settled.push(step.outcome);
    else pending.push(step.request);
  }
  return askingPhase(settled, pending);
}

/** 此刻该问用户的那个覆盖请求；问完了就是 `null`。 */
export function pendingOverwriteOf(
  phase: ImportSessionPhase,
): OverwriteImportRequest | null {
  return phase.kind === "asking" ? phase.pending[0] : null;
}

/**
 * 把「这张覆盖询问的结果」记下来，并前进到下一张（没有了就转 `done`）。
 *
 * `done` 上再结算一次是**空操作**：多调一次不会凭空多出一条结果，
 * 也不会把已经出好的汇总弄乱。
 */
export function settleOverwrite(
  phase: ImportSessionPhase,
  outcome: BankImportOutcome,
): ImportSessionPhase {
  if (phase.kind === "done") return phase;
  const [, ...rest] = phase.pending;
  return askingPhase([...phase.settled, outcome], rest);
}

/** 当前该给用户看的提示：还有要问的就问，问完了给汇总。 */
export function promptOf(
  phase: ImportSessionPhase,
  total: number,
): BankImportPrompt {
  if (phase.kind === "asking") {
    return { kind: "overwrite", request: phase.pending[0] };
  }
  return {
    kind: "summary",
    message: createImportSummary([...phase.settled], total),
  };
}

export type BankExportResult =
  | { ok: true; warning?: string }
  | { ok: false; message: BankFileMessage };

function success(fileName: string): BankImportOutcome {
  return { kind: "success", fileName };
}

function failure(failure: BankImportFailure): BankImportOutcome {
  return { kind: "failure", failure };
}

function formatUnknownError(e: unknown): string {
  return e instanceof Error ? e.message : "未知错误";
}

function getBankName(source: QuizSource, hash: string): string {
  return source.listBanks().find((b) => b.hash === hash)?.name ?? "该题库";
}

function mapImportResult(
  source: QuizSource,
  fileName: string,
  result: ImportBankResult,
): FileImportStep {
  switch (result.kind) {
    case "ok":
      return {
        kind: "done",
        outcome:
          result.stateError === undefined
            ? success(fileName)
            : failure(new StateRestoreFailure(fileName, result.stateError)),
      };
    case "invalid":
      return {
        kind: "done",
        outcome: failure(
          new InvalidQuestionBankFailure(fileName, result.errors),
        ),
      };
    case "duplicate":
      return result.stateStr === undefined
        ? {
            kind: "done",
            outcome: failure(new DuplicateQuestionBankFailure(fileName)),
          }
        : {
            kind: "needs-overwrite",
            request: {
              fileName,
              hash: result.hash,
              stateStr: result.stateStr,
              bankName: getBankName(source, result.hash),
            },
          };
    case "quota":
      return {
        kind: "done",
        outcome: failure(new QuotaImportFailure(fileName)),
      };
  }
}

async function importBankText(
  source: QuizSource,
  fileName: string,
  bankName: string,
  rawJson: string,
): Promise<FileImportStep> {
  const result = await source.importBank(bankName, rawJson);
  return mapImportResult(source, fileName, result);
}

async function importBankFile(
  source: QuizSource,
  file: File,
): Promise<FileImportStep> {
  try {
    const text = await file.text();
    const baseName = file.name.replace(/\.json$/i, "");
    return await importBankText(source, file.name, baseName, text);
  } catch (e) {
    return {
      kind: "done",
      outcome: failure(
        new UnexpectedImportFailure(
          file.name,
          `读取或导入失败：${formatUnknownError(e)}`,
        ),
      ),
    };
  }
}

async function importBankClipboard(
  source: QuizSource,
  readText_?: () => Promise<string>,
): Promise<FileImportStep> {
  const reader = readText_ ?? readText;

  let text: string;
  try {
    text = await reader();
  } catch (e) {
    return {
      kind: "done",
      outcome: failure(
        new ClipboardImportFailure(
          CLIPBOARD_DISPLAY_NAME,
          `读取剪贴板失败：${formatUnknownError(e)}`,
        ),
      ),
    };
  }

  if (text.trim() === "") {
    return {
      kind: "done",
      outcome: failure(
        new ClipboardImportFailure(
          CLIPBOARD_DISPLAY_NAME,
          "剪贴板为空。",
        ),
      ),
    };
  }

  try {
    return await importBankText(
      source,
      CLIPBOARD_DISPLAY_NAME,
      CLIPBOARD_BANK_NAME,
      text,
    );
  } catch (e) {
    return {
      kind: "done",
      outcome: failure(
        new UnexpectedImportFailure(
          CLIPBOARD_DISPLAY_NAME,
          `导入失败：${formatUnknownError(e)}`,
        ),
      ),
    };
  }
}

async function resolveOverwriteImport(
  source: QuizSource,
  request: OverwriteImportRequest,
  overwrite: boolean,
): Promise<BankImportOutcome> {
  if (!overwrite) {
    return failure(new OverwriteDeclinedFailure(request.fileName));
  }

  try {
    const result = await source.applyStateToBank(request.hash, request.stateStr);
    return result.ok
      ? success(request.fileName)
      : failure(new OverwriteApplyFailure(request.fileName, result.error));
  } catch (e) {
    return failure(
      new UnexpectedImportFailure(
        request.fileName,
        `进度替换失败：${formatUnknownError(e)}`,
      ),
    );
  }
}

function createImportSummary(
  outcomes: BankImportOutcome[],
  total: number,
): BankFileMessage {
  const failures = outcomes.flatMap((outcome) =>
    outcome.kind === "failure" ? [outcome.failure] : [],
  );
  const successCount = outcomes.length - failures.length;

  if (total === 1) {
    if (failures.length === 0) {
      const fileName =
        outcomes[0]?.kind === "success" ? outcomes[0].fileName : "题库";
      return {
        title: "导入成功",
        text: `已导入「${fileName}」。`,
      };
    }

    const failure = failures[0];
    return {
      title: "导入失败",
      text: `${failure.fileName}\n\n原因：${failure.getReason()}`,
    };
  }

  if (failures.length === 0) {
    return {
      title: "导入成功",
      text: `共导入 ${successCount} 个题库，全部成功。`,
    };
  }

  const title = successCount === 0 ? "导入失败" : "批量导入完成";
  const headline =
    successCount === 0
      ? "全部失败。"
      : `${successCount} 个成功，${failures.length} 个失败。`;
  const details = failures
    .map((failure) => `- ${failure.fileName}：${failure.getReason()}`)
    .join("\n");

  return {
    title,
    text: `${headline}\n\n失败详情：\n${details}`,
  };
}

/** 一次（可能包含多文件 / 剪贴板）导入会话，逐步产出 UI 需要的提示。 */
export class BankImportSession {
  private phase: ImportSessionPhase = donePhase([]);

  private constructor(
    private readonly source: QuizSource,
    private readonly total: number,
  ) {}

  static async create(
    source: QuizSource,
    files: File[],
  ): Promise<BankImportSession> {
    const session = new BankImportSession(source, files.length);
    const steps: FileImportStep[] = [];
    for (const file of files) {
      steps.push(await importBankFile(source, file));
    }
    session.phase = openImport(steps);
    return session;
  }

  static async createFromClipboard(
    source: QuizSource,
    readText_?: () => Promise<string>,
  ): Promise<BankImportSession> {
    const session = new BankImportSession(source, 1);
    session.phase = openImport([
      await importBankClipboard(source, readText_),
    ]);
    return session;
  }

  currentPrompt(): BankImportPrompt {
    return promptOf(this.phase, this.total);
  }

  async resolveOverwrite(overwrite: boolean): Promise<BankImportPrompt> {
    const request = pendingOverwriteOf(this.phase);
    if (request === null) return this.currentPrompt();

    const outcome = await resolveOverwriteImport(
      this.source,
      request,
      overwrite,
    );
    this.phase = settleOverwrite(this.phase, outcome);
    return this.currentPrompt();
  }
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportBank(
  source: QuizSource,
  hash: string,
): Promise<BankExportResult> {
  try {
    const result = await source.exportBank(hash);
    if (result === null) {
      return {
        ok: false,
        message: {
          title: "导出失败",
          text: "找不到这份题库。",
        },
      };
    }

    downloadTextFile(result.filename, result.content);
    return result.warning === undefined
      ? { ok: true }
      : { ok: true, warning: result.warning };
  } catch (e) {
    return {
      ok: false,
      message: {
        title: "导出失败",
        text: formatUnknownError(e),
      },
    };
  }
}
