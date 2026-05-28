import type { QuestionType } from "../../types";
import type { QuestionTypeDef } from "./types";
import { judgmentLogic } from "./judgment/logic";
import { singleLogic } from "./single/logic";
import { multipleLogic } from "./multiple/logic";
import { blankLogic } from "./blank/logic";

/**
 * 题型「逻辑层」注册表。
 *
 * 与 `registry.ts` 的差异：
 *   - 不含 `icon` 字段
 *   - 不会触发 @tabler/icons-svelte 的子路径 import（该包 exports 没有 Node
 *     condition，外层 vite.config.ts 在 bundle 自己时会因此失败）
 *
 * 适用场景：所有「不需要 icon」的纯逻辑路径，特别是被 vite.config.ts 间接
 * 引入的 `validateQuestions`。Svelte 组件请走 `./registry.ts`。
 */
export type QuestionTypeLogic = Omit<QuestionTypeDef, "icon">;

export const QUESTION_TYPES_LOGIC: Record<QuestionType, QuestionTypeLogic> = {
  judgment: judgmentLogic,
  single: singleLogic,
  multiple: multipleLogic,
  blank: blankLogic,
};

/** 题型显示顺序（题库筛选器、答案预览分组等都用这个序）。 */
export const QUESTION_TYPE_ORDER: QuestionType[] = [
  "judgment",
  "single",
  "multiple",
  "blank",
];

/** 所有 QuestionTypeLogic，按 ORDER 排列。 */
export function listQuestionTypesLogic(): QuestionTypeLogic[] {
  return QUESTION_TYPE_ORDER.map((id) => QUESTION_TYPES_LOGIC[id]);
}
