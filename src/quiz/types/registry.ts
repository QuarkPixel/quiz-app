import type { QuestionType } from "@/types";
import type { QuestionTypeDef } from "./types";
import { judgmentType } from "./judgment";
import { singleType } from "./single";
import { multipleType } from "./multiple";
import { blankType } from "./blank";
import { QUESTION_TYPE_ORDER } from "./registry-logic";

/**
 * 题型注册表（完整版，含 icon）。Svelte 组件使用这一份。
 *
 * 不要在被 vite.config.ts 间接 import 的代码里走这个 registry——它会触发
 * @tabler/icons-svelte 的子路径解析，而该包 exports 没有 Node condition，
 * 配置文件 bundle 时会失败。那些路径请用 `./registry-logic.ts`。
 *
 * 新增题型的步骤：
 *   1. src/quiz/types/<name>/logic.ts 写纯逻辑
 *   2. src/quiz/types/<name>/index.ts 合并 logic + icon
 *   3. 在 registry-logic.ts 注册 logic；在这里 import index.ts
 *   4. 在 src/types.ts 的 QuestionType union 添加该 id
 */
export const QUESTION_TYPES: Record<QuestionType, QuestionTypeDef> = {
  judgment: judgmentType,
  single: singleType,
  multiple: multipleType,
  blank: blankType,
};

export { QUESTION_TYPE_ORDER };

/** 安全访问 registry，不存在时返回 undefined（题型 union 已经穷尽，理论上不可达）。 */
export function getQuestionType(id: QuestionType): QuestionTypeDef {
  return QUESTION_TYPES[id];
}

/** 所有 QuestionTypeDef，按 ORDER 排列。 */
export function listQuestionTypes(): QuestionTypeDef[] {
  return QUESTION_TYPE_ORDER.map((id) => QUESTION_TYPES[id]);
}
