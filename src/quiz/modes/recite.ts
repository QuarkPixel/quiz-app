import type { ReciteQuestion } from "@/types";
import type {
  BankModeDef,
  BankOverviewModel,
  BankQuestionsValidation,
} from "./types";

/**
 * 背诵模式（预留，尚未实现）。
 *
 * 预期题目结构（仅 id / question / answer）：
 *   { "id": "r1", "question": "……", "answer": "……" }
 *
 * 待实现时的落点：
 *   - 这里实现 validateQuestions（校验 id 唯一、question/answer 为字符串）
 *   - 在 `src/lib/bankFile.ts` 的 parseBankFile 里已按 mode 分发，无需改动
 *   - 总览：实现 buildOverview 返回按「记得 / 不记得」等口径的分组，
 *     并在 ReviewView 按 bank.mode 分支渲染
 *   - 答题流：新增 recite 的会话 / 组件，不参与间隔重复算法
 *
 * 在实现之前，导入带 `"mode": "recite"` 的题库会得到明确的错误提示。
 */
export const reciteModeDef = {
  mode: "recite",
  label: "背诵模式",

  validateQuestions(_raw: unknown): BankQuestionsValidation<ReciteQuestion> {
    return {
      ok: false,
      errors: ["背诵模式尚未实现（解析接口已预留）。"],
    };
  },

  buildOverview(): BankOverviewModel | null {
    // 背诵模式的总览展示口径与刷题模式不同，接入时在这里返回自己的分组。
    return null;
  },
} satisfies BankModeDef;
