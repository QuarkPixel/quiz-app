import { validateMemoryQuestions } from "@/lib/validateQuestions";
import type {
  BankModeDef,
  BankOverviewModel,
  BankQuestionsValidation,
} from "./types";
import type { MemoryQuestion } from "@/types";

/**
 * 记忆模式。
 *
 * 题目结构：
 *   { "id": "m1", "type": "memory", "question": "……", "answer": "……" }
 *
 * `type` 可以省略，导入时统一补成 `"memory"`（见 `validateMemoryQuestions`）。
 * 校验、判分、答题 UI 都复用刷题模式的题型机制，记忆题型本身在
 * `src/quiz/types/memory/`。
 */
export const memoryModeDef = {
  mode: "memory",
  label: "记忆模式",

  validateQuestions(raw: unknown): BankQuestionsValidation<MemoryQuestion> {
    const result = validateMemoryQuestions(raw);
    if (!result.ok) return result;
    return {
      ok: true,
      questions: result.questions as MemoryQuestion[],
    };
  },

  /**
   * 记忆模式的总览由 `MemoryOverview.svelte` 自己渲染（按四类状态分组 + 搜索 +
   * 热力图），不走这个通用接口，所以和刷题模式一样返回 null。
   */
  buildOverview(): BankOverviewModel | null {
    return null;
  },
} satisfies BankModeDef;
