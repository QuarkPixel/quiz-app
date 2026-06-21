import { readText } from "clipboard-polyfill";
import type { ImportBankResult, QuizSource } from "../source/types";

const CLIPBOARD_DISPLAY_NAME = "剪贴板内容";
const CLIPBOARD_BANK_NAME = "剪贴板题库";

export interface LibraryFileMessage {
  title: string;
  text: string;
}

export interface LibraryImportFailure {
  readonly fileName: string;
  getReason(): string;
}

abstract class BaseImportFailure implements LibraryImportFailure {
  constructor(readonly fileName: string) {}

  abstract getReason(): string;
}

class UnsupportedImportFailure extends BaseImportFailure {
  getReason(): string {
    return "当前模式不支持导入题库。";
  }
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
    const rest = this.errors.length > 3 ? `；还有 ${this.errors.length - 3} 条问题` : "";
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

export type LibraryImportOutcome =
  | { kind: "success"; fileName: string }
  | { kind: "failure"; failure: LibraryImportFailure };

export interface OverwriteImportRequest {
  fileName: string;
  hash: string;
  stateStr: string;
  bankName: string;
}

type FileImportStep =
  | { kind: "done"; outcome: LibraryImportOutcome }
  | { kind: "needs-overwrite"; request: OverwriteImportRequest };

export type LibraryImportPrompt =
  | { kind: "overwrite"; request: OverwriteImportRequest }
  | { kind: "summary"; message: LibraryFileMessage };

export type LibraryExportResult =
  | { ok: true }
  | { ok: false; message: LibraryFileMessage };

function success(fileName: string): LibraryImportOutcome {
  return { kind: "success", fileName };
}

function failure(failure: LibraryImportFailure): LibraryImportOutcome {
  return { kind: "failure", failure };
}

function formatUnknownError(e: unknown): string {
  return e instanceof Error ? e.message : "未知错误";
}

function getBankName(source: QuizSource, hash: string): string {
  return source.listBanks?.().find((b) => b.hash === hash)?.name ?? "该题库";
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
        outcome: failure(new InvalidQuestionBankFailure(fileName, result.errors)),
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

async function importLibraryText(
  source: QuizSource,
  fileName: string,
  bankName: string,
  rawJson: string,
): Promise<FileImportStep> {
  if (!source.importBank) {
    return {
      kind: "done",
      outcome: failure(new UnsupportedImportFailure(fileName)),
    };
  }

  const result = await source.importBank(bankName, rawJson);
  return mapImportResult(source, fileName, result);
}

async function importLibraryFile(
  source: QuizSource,
  file: File,
): Promise<FileImportStep> {
  if (!source.importBank) {
    return {
      kind: "done",
      outcome: failure(new UnsupportedImportFailure(file.name)),
    };
  }

  try {
    const text = await file.text();
    const baseName = file.name.replace(/\.json$/i, "");
    return await importLibraryText(source, file.name, baseName, text);
  } catch (e) {
    return {
      kind: "done",
      outcome: failure(
        new UnexpectedImportFailure(file.name, `读取或导入失败：${formatUnknownError(e)}`),
      ),
    };
  }
}

async function importLibraryClipboard(
  source: QuizSource,
  readText_?: () => Promise<string>,
): Promise<FileImportStep> {
  if (!source.importBank) {
    return {
      kind: "done",
      outcome: failure(new UnsupportedImportFailure(CLIPBOARD_DISPLAY_NAME)),
    };
  }

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
          "剪贴板为空，请先复制题库 JSON。",
        ),
      ),
    };
  }

  try {
    return await importLibraryText(
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
): Promise<LibraryImportOutcome> {
  if (!overwrite) {
    return failure(new OverwriteDeclinedFailure(request.fileName));
  }
  if (!source.applyStateToBank) {
    return failure(new UnsupportedImportFailure(request.fileName));
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
  outcomes: LibraryImportOutcome[],
  total: number,
): LibraryFileMessage {
  const failures = outcomes.flatMap((outcome) =>
    outcome.kind === "failure" ? [outcome.failure] : [],
  );
  const successCount = outcomes.length - failures.length;

  if (total === 1) {
    if (failures.length === 0) {
      const fileName = outcomes[0]?.kind === "success" ? outcomes[0].fileName : "题库";
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

export class LibraryImportSession {
  private readonly outcomes: LibraryImportOutcome[] = [];
  private readonly overwriteRequests: OverwriteImportRequest[] = [];
  private overwriteIndex = 0;

  private constructor(
    private readonly source: QuizSource,
    private readonly total: number,
  ) {}

  private collectStep(step: FileImportStep): void {
    if (step.kind === "done") {
      this.outcomes.push(step.outcome);
    } else {
      this.overwriteRequests.push(step.request);
    }
  }

  static async create(
    source: QuizSource,
    files: File[],
  ): Promise<LibraryImportSession> {
    const session = new LibraryImportSession(source, files.length);

    for (const file of files) {
      session.collectStep(await importLibraryFile(source, file));
    }

    return session;
  }

  static async createFromClipboard(
    source: QuizSource,
    readText_?: () => Promise<string>,
  ): Promise<LibraryImportSession> {
    const session = new LibraryImportSession(source, 1);
    session.collectStep(await importLibraryClipboard(source, readText_));
    return session;
  }

  currentPrompt(): LibraryImportPrompt {
    const request = this.overwriteRequests[this.overwriteIndex];
    if (request !== undefined) {
      return { kind: "overwrite", request };
    }
    return {
      kind: "summary",
      message: createImportSummary(this.outcomes, this.total),
    };
  }

  async resolveOverwrite(overwrite: boolean): Promise<LibraryImportPrompt> {
    const request = this.overwriteRequests[this.overwriteIndex];
    if (request === undefined) return this.currentPrompt();

    this.outcomes.push(
      await resolveOverwriteImport(this.source, request, overwrite),
    );
    this.overwriteIndex += 1;
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

export async function exportLibraryBank(
  source: QuizSource,
  hash: string,
): Promise<LibraryExportResult> {
  if (!source.exportBank) {
    return {
      ok: false,
      message: {
        title: "导出失败",
        text: "当前模式不支持导出题库。",
      },
    };
  }

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
    return { ok: true };
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
