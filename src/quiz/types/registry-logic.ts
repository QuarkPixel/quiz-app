import type { QuestionType, QuizQuestionType } from "../../types";
import type { QuestionTypeLogic } from "./types";
import { judgmentLogic } from "./judgment/logic";
import { singleLogic } from "./single/logic";
import { multipleLogic } from "./multiple/logic";
import { blankLogic } from "./blank/logic";
import { memoryLogic } from "./memory/logic";

/**
 * 题型「逻辑层」注册表。
 *
 * 与 `registry.ts` 的差异：
 *   - 不含 `icon` / `Input` / `Review`（这些都是 svelte / browser-only 字段）
 *   - 不会触发 @tabler/icons-svelte 的子路径 import（该包 exports 没有 Node
 *     condition，外层 vite.config.ts 在 bundle 自己时会因此失败）
 *
 * 适用场景：所有「不需要 UI 组件」的纯逻辑路径，特别是被 vite.config.ts 间接
 * 引入的 `validateQuestions`。Svelte 组件请走 `./registry.ts`。
 */
export type { QuestionTypeLogic };

/**
 * 刷题模式的四种题型。
 *
 * 记忆题型（`memory`）是第五种题型，但校验走 `memoryModeDef.validateQuestions`，
 * 也不参与刷题模式的题型筛选 / 总览分组，所以这里不登记它。
 */
export const QUIZ_QUESTION_TYPES_LOGIC: Record<
  QuizQuestionType,
  QuestionTypeLogic
> = {
  judgment: judgmentLogic,
  single: singleLogic,
  multiple: multipleLogic,
  blank: blankLogic,
};

/**
 * 全部题型的逻辑（含记忆题型），按 id 查找。
 *
 * 类型是 `Record<QuestionType, …>` 而不是 `Record<string, …>`：`src/types.ts` 的
 * `QuestionType` union 新增一个 id 时，这里少登记就直接编译不过——不用等到
 * 用户点到那道题、`QUESTION_TYPES_LOGIC[type]` 变成 undefined 才发现。
 */
export const QUESTION_TYPES_LOGIC: Record<QuestionType, QuestionTypeLogic> = {
  ...QUIZ_QUESTION_TYPES_LOGIC,
  memory: memoryLogic,
};

/** 刷题模式的题型显示顺序（题库筛选器、总览分组等都用这个序）。 */
export const QUESTION_TYPE_ORDER: QuizQuestionType[] = [
  "judgment",
  "single",
  "multiple",
  "blank",
];
