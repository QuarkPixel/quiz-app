import type { Question, QuestionType } from "../types";
import {
  QUESTION_TYPE_ORDER,
  QUESTION_TYPES_LOGIC,
} from "../quiz/types/registry-logic";

export type ValidateQuizQuestionsResult =
  | { ok: true; questions: Question[] }
  | { ok: false; errors: string[] };

const VALID_TYPES = new Set<QuestionType>(QUESTION_TYPE_ORDER);

/**
 * 校验刷题模式的 questions 数组。
 *
 * 由 `src/quiz/modes/quiz.ts` 的 BankModeDef 调用；`src/lib/bankFile.ts`
 * 负责先解析出 mode / state 再分发到这里。
 */
export function validateQuizQuestions(
  raw: unknown,
): ValidateQuizQuestionsResult {
  const errors: string[] = [];

  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["questions 必须是一个 JSON 数组。"] };
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
      errors.push(
        `${label}（id=${id}）：type 不合法（应为 judgment/single/multiple/blank）。`,
      );
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
