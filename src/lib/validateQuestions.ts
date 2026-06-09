import type { Question, QuestionType } from "../types";
import {
  QUESTION_TYPE_ORDER,
  QUESTION_TYPES_LOGIC,
} from "../quiz/types/registry-logic";

export type ValidateResult =
  | { ok: true; questions: Question[] }
  | { ok: false; errors: string[] };

const VALID_TYPES = new Set<QuestionType>(QUESTION_TYPE_ORDER);

/**
 * 校验题库 JSON 结构。
 *
 * 同时被两处复用：
 *   1. vite.config.ts 的 validateQuestionIds plugin（bundled 构建时）
 *   2. LibrarySource.importBank（library 模式运行时）
 */
export function validateQuestions(raw: unknown): ValidateResult {
  const errors: string[] = [];

  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["题库必须是一个 JSON 数组。"] };
  }
  if (raw.length === 0) {
    return { ok: false, errors: ["题库为空。"] };
  }

  const seenIds = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown>;
    const label = `第 ${i + 1} 题`;

    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label}：不是对象。`);
      continue;
    }

    const id = item.id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push(`${label}：缺少 id 或 id 不是字符串。`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`${label}（id=${id}）：id 重复。`);
    }
    seenIds.add(id);

    const type = item.type;
    if (typeof type !== "string" || !VALID_TYPES.has(type as QuestionType)) {
      errors.push(`${label}（id=${id}）：type 不合法（应为 judgment/single/multiple/blank）。`);
      continue;
    }

    if (typeof item.question !== "string") {
      errors.push(`${label}（id=${id}）：question 不是字符串。`);
    }

    const typeErrors = QUESTION_TYPES_LOGIC[type as QuestionType].validate(
      item,
      `${label}（id=${id}）`,
    );
    errors.push(...typeErrors);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, questions: raw as Question[] };
}
