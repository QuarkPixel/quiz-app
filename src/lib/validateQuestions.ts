import type { Question, QuestionType, QuizQuestionType } from "../types";
import {
  QUESTION_TYPE_ORDER,
  QUESTION_TYPES_LOGIC,
} from "../quiz/types/registry-logic";

export type ValidateQuizQuestionsResult =
  | { ok: true; questions: Question[] }
  | { ok: false; errors: string[] };

const VALID_QUIZ_TYPES = new Set<string>(QUESTION_TYPE_ORDER);

interface ValidateOptions {
  /**
   * 只接受这一种题型，并在输出时把 `type` 补上（记忆模式的题目允许省略 type，
   * 导入时统一补成 "memory"）。
   */
  onlyType?: QuestionType;
  /** 报错里列出的合法取值，用于错误文案。 */
  typeHint?: string;
}

/**
 * 校验 questions 数组的通用实现。
 *
 * 刷题模式（`validateQuizQuestions`）与记忆模式（`memoryModeDef.validateQuestions`）
 * 共用：通用层负责 id / question / 重复检查，题型专属字段交给对应的
 * `QuestionTypeLogic.validate`（记忆题型在 `src/quiz/types/memory/logic.ts`）。
 */
function validateQuestionsWithType(
  raw: unknown,
  options: ValidateOptions = {},
): ValidateQuizQuestionsResult {
  const errors: string[] = [];
  const typeHint =
    options.typeHint ?? "judgment/single/multiple/blank";

  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["questions 必须是数组。"] };
  }
  if (raw.length === 0) {
    return { ok: false, errors: ["题库为空。"] };
  }

  const seenIds = new Set<string>();
  const questions: Question[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const label = `第 ${i + 1} 题`;

    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label}：不是对象。`);
      continue;
    }

    const record = item as Record<string, unknown>;
    const id = record.id;
    if (typeof id !== "string" || id.length === 0) {
      errors.push(`${label}：缺少 id 或 id 不是字符串。`);
      continue;
    }
    if (seenIds.has(id)) {
      errors.push(`${label}（id=${id}）：id 重复。`);
    }
    seenIds.add(id);

    let type: QuestionType;
    if (options.onlyType) {
      type = options.onlyType;
    } else {
      const rawType = record.type;
      if (
        typeof rawType !== "string" ||
        !VALID_QUIZ_TYPES.has(rawType as QuizQuestionType)
      ) {
        errors.push(
          `${label}（id=${id}）：type 不合法（应为 ${typeHint}）。`,
        );
        continue;
      }
      type = rawType as QuizQuestionType;
    }

    if (typeof record.question !== "string" || record.question.length === 0) {
      errors.push(`${label}（id=${id}）：question 必须是非空字符串。`);
    }

    const logic = QUESTION_TYPES_LOGIC[type];
    errors.push(...logic.validate(record, `${label}（id=${id}）`));

    questions.push({ ...record, type } as Question);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, questions };
}

/**
 * 校验刷题模式的 questions 数组（四种题型，type 必填且必须在四型之内）。
 *
 * 由 `src/quiz/modes/quiz.ts` 的 BankModeDef 调用；`src/lib/bankFile.ts`
 * 负责先解析出 mode / state 再分发到这里。
 */
export function validateQuizQuestions(
  raw: unknown,
): ValidateQuizQuestionsResult {
  return validateQuestionsWithType(raw);
}

/**
 * 校验记忆模式的 questions 数组。
 *
 * 允许省略 `type`（LLM 生成的卡片通常不写），统一补成 `"memory"`；
 * 写了就必须是 `"memory"`。
 */
export function validateMemoryQuestions(
  raw: unknown,
): ValidateQuizQuestionsResult {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["questions 必须是数组。"] };
  }

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const type = (item as Record<string, unknown>).type;
    if (type !== undefined && type !== "memory") {
      return {
        ok: false,
        errors: [
          `第 ${i + 1} 题（id=${String(
            (item as Record<string, unknown>).id ?? "?",
          )}）：记忆模式的题型只能是 "memory"。`,
        ],
      };
    }
  }

  return validateQuestionsWithType(raw, {
    onlyType: "memory",
    typeHint: "memory",
  });
}
