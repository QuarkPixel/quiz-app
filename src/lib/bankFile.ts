/**
 * 题库文件（bank file）的统一解析 / 序列化。
 *
 * 统一后的结构（不再支持裸数组）：
 *
 *   {
 *     "mode": "quiz" | "memory",   // 可选，默认 "quiz"
 *     "title": "……",               // 可选，题库标题；省略时用文件名 / 剪贴板名
 *     "state": "……",               // 可选，进度备份编码；LLM 生成的题库省略
 *     "questions": [ ... ]         // 必需
 *   }
 *
 * 解析时按 mode 分发到 `src/quiz/modes/` 里对应的 BankModeDef。
 * 新增模式只需在该注册表里登记，本文件不用加分支。
 */

import { memoryModeDef } from "@/quiz/modes/memory";
import { quizModeDef } from "@/quiz/modes/quiz";
import type { BankMode, Question, MemoryQuestion } from "@/types";

export type ParseBankFileResult =
  | {
      ok: true;
      mode: "quiz";
      questions: Question[];
      title?: string;
      state?: string;
    }
  | {
      ok: true;
      mode: "memory";
      questions: MemoryQuestion[];
      title?: string;
      state?: string;
    }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 解析 JSON 文本形式的题库文件。 */
export function parseBankFileJson(rawJson: string): ParseBankFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (e) {
    return {
      ok: false,
      errors: [`JSON 解析失败：${(e as Error).message}`],
    };
  }
  return parseBankFile(parsed);
}

/** 解析已 JSON.parse 过的题库对象。 */
export function parseBankFile(raw: unknown): ParseBankFileResult {
  if (Array.isArray(raw)) {
    return {
      ok: false,
      errors: [
        "题库必须是对象（{ questions: [...] }），不再支持裸数组。",
      ],
    };
  }
  if (!isRecord(raw)) {
    return { ok: false, errors: ["题库必须是对象。"] };
  }
  if (!("questions" in raw)) {
    return { ok: false, errors: ["缺少 questions 字段。"] };
  }

  const modeResult = readMode(raw.mode);
  if (!modeResult.ok) return { ok: false, errors: [modeResult.error] };

  const titleResult = readTitle(raw.title);
  if (!titleResult.ok) return { ok: false, errors: [titleResult.error] };
  const { title } = titleResult;

  const stateResult = readState(raw.state);
  if (!stateResult.ok) return { ok: false, errors: [stateResult.error] };
  const { state } = stateResult;

  if (modeResult.mode === "quiz") {
    const validation = quizModeDef.validateQuestions(raw.questions);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    return {
      ok: true,
      mode: "quiz",
      questions: validation.questions,
      ...(title === undefined ? {} : { title }),
      ...(state === undefined ? {} : { state }),
    };
  }

  const validation = memoryModeDef.validateQuestions(raw.questions);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return {
    ok: true,
    mode: "memory",
    questions: validation.questions,
    ...(title === undefined ? {} : { title }),
    ...(state === undefined ? {} : { state }),
  };
}

/** 序列化题库文件（导出用）。 */
export function formatBankFile(options: {
  mode: BankMode;
  questions: readonly unknown[];
  title?: string;
  state?: string;
}): string {
  const payload: Record<string, unknown> = { mode: options.mode };
  const title = options.title?.trim();
  if (title) {
    payload.title = title;
  }
  if (options.state !== undefined) {
    payload.state = options.state;
  }
  payload.questions = options.questions;
  return JSON.stringify(payload, null, 2);
}

type ReadModeResult = { ok: true; mode: BankMode } | { ok: false; error: string };

function readMode(value: unknown): ReadModeResult {
  if (value === undefined) return { ok: true, mode: "quiz" };
  if (value === "quiz" || value === "memory") return { ok: true, mode: value };
  return {
    ok: false,
    error: 'mode 只能是 "quiz" 或 "memory"。',
  };
}

type ReadStateResult =
  | { ok: true; state: string | undefined }
  | { ok: false; error: string };

function readState(value: unknown): ReadStateResult {
  if (value === undefined) return { ok: true, state: undefined };
  if (typeof value === "string") return { ok: true, state: value };
  return { ok: false, error: "state 必须是字符串。" };
}

type ReadTitleResult =
  | { ok: true; title: string | undefined }
  | { ok: false; error: string };

/**
 * 读取可选的题库标题。缺失 / null 视为没有；空串按没有处理，
 * 这样导入端可以回退到文件名 / 剪贴板名。
 */
function readTitle(value: unknown): ReadTitleResult {
  if (value === undefined || value === null) return { ok: true, title: undefined };
  if (typeof value !== "string") {
    return { ok: false, error: "title 必须是字符串。" };
  }
  const trimmed = value.trim();
  return { ok: true, title: trimmed === "" ? undefined : trimmed };
}
