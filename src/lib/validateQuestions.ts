import type { Question, QuestionType } from "../types";

export type ValidateResult =
  | { ok: true; questions: Question[] }
  | { ok: false; errors: string[] };

const VALID_TYPES = new Set<QuestionType>([
  "judgment",
  "single",
  "multiple",
  "blank",
]);

/**
 * 校验题库 JSON 结构。
 *
 * 同时被两处复用：
 *   1. vite.config.ts 的 validateQuestionIds plugin（bundled 构建时）
 *   2. LibrarySource.importBank（library 模式运行时）
 *
 * '^' 是进度编码（importExport.ts）的保留前缀，所有 id 不得以其开头。
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
    if (id.startsWith("^")) {
      errors.push(`${label}（id=${id}）：id 不可以以保留字符 '^' 开头。`);
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

    const answer = item.answer;
    switch (type) {
      case "judgment":
        if (typeof answer !== "boolean") {
          errors.push(`${label}（id=${id}）：判断题 answer 必须是布尔值。`);
        }
        break;

      case "single":
      case "multiple": {
        const options = item.options;
        if (!Array.isArray(options) || options.length === 0) {
          errors.push(`${label}（id=${id}）：选择题 options 必须是非空数组。`);
          break;
        }
        for (let j = 0; j < options.length; j++) {
          const opt = options[j] as Record<string, unknown>;
          if (!opt || typeof opt.text !== "string") {
            errors.push(`${label}（id=${id}）：选项 ${j} 缺少 text 字段。`);
          }
        }
        if (!Array.isArray(answer) || !answer.every((n) => Number.isInteger(n))) {
          errors.push(`${label}（id=${id}）：选择题 answer 必须是整数数组。`);
          break;
        }
        if (type === "single" && answer.length !== 1) {
          errors.push(`${label}（id=${id}）：单选题 answer 必须只有一个索引。`);
        }
        for (const n of answer as number[]) {
          if (n < 0 || n >= options.length) {
            errors.push(`${label}（id=${id}）：answer 索引 ${n} 超出 options 范围。`);
          }
        }
        break;
      }

      case "blank":
        if (typeof answer === "string") break;
        if (Array.isArray(answer) && answer.every((s) => typeof s === "string")) break;
        errors.push(`${label}（id=${id}）：填空题 answer 必须是字符串或字符串数组。`);
        break;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, questions: raw as Question[] };
}
