/**
 * 题库文件（bank file）的统一解析 / 序列化。
 *
 * 统一后的结构（不再支持裸数组）：
 *
 *   {
 *     "mode": "quiz" | "recite",   // 可选，默认 "quiz"
 *     "state": "……",               // 可选，进度备份编码；LLM 生成的题库省略
 *     "questions": [ ... ]         // 必需
 *   }
 *
 * 解析时按 mode 分发到 `src/quiz/modes/` 里对应的 BankModeDef。
 * 新增模式只需在该注册表里登记，本文件不用加分支。
 */

import { reciteModeDef } from "@/quiz/modes/recite";
import { quizModeDef } from "@/quiz/modes/quiz";
import type { BankMode, Question, ReciteQuestion } from "@/types";

export type ParseBankFileResult =
  | { ok: true; mode: "quiz"; questions: Question[]; state?: string }
  | { ok: true; mode: "recite"; questions: ReciteQuestion[]; state?: string }
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
        "题库必须是一个对象（形如 { mode?, state?, questions }），不再支持裸数组。",
      ],
    };
  }
  if (!isRecord(raw)) {
    return { ok: false, errors: ["题库必须是一个 JSON 对象。"] };
  }
  if (!("questions" in raw)) {
    return { ok: false, errors: ["题库缺少 questions 字段。"] };
  }

  const modeResult = readMode(raw.mode);
  if (!modeResult.ok) return { ok: false, errors: [modeResult.error] };

  const stateResult = readState(raw.state);
  if (!stateResult.ok) return { ok: false, errors: [stateResult.error] };
  const { state } = stateResult;

  if (modeResult.mode === "quiz") {
    const validation = quizModeDef.validateQuestions(raw.questions);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    return state === undefined
      ? { ok: true, mode: "quiz", questions: validation.questions }
      : { ok: true, mode: "quiz", questions: validation.questions, state };
  }

  const validation = reciteModeDef.validateQuestions(raw.questions);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  return state === undefined
    ? { ok: true, mode: "recite", questions: validation.questions }
    : { ok: true, mode: "recite", questions: validation.questions, state };
}

/** 序列化题库文件（导出用）。 */
export function formatBankFile(options: {
  mode: BankMode;
  questions: readonly unknown[];
  state?: string;
}): string {
  const payload: Record<string, unknown> = { mode: options.mode };
  if (options.state !== undefined) {
    payload.state = options.state;
  }
  payload.questions = options.questions;
  return JSON.stringify(payload, null, 2);
}

type ReadModeResult = { ok: true; mode: BankMode } | { ok: false; error: string };

function readMode(value: unknown): ReadModeResult {
  if (value === undefined) return { ok: true, mode: "quiz" };
  if (value === "quiz" || value === "recite") return { ok: true, mode: value };
  return {
    ok: false,
    error: 'mode 不合法：应为 "quiz" 或 "recite"，省略时默认 "quiz"。',
  };
}

type ReadStateResult =
  | { ok: true; state: string | undefined }
  | { ok: false; error: string };

function readState(value: unknown): ReadStateResult {
  if (value === undefined) return { ok: true, state: undefined };
  if (typeof value === "string") return { ok: true, state: value };
  return { ok: false, error: "state 必须是字符串（进度备份编码）。" };
}
