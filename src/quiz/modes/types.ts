import type {
  BankMode,
  BankQuestion,
  RuntimeState,
} from "@/types";

/** 某种模式下 questions 字段的校验结果。 */
export type BankQuestionsValidation<Q> =
  | { ok: true; questions: Q[] }
  | { ok: false; errors: string[] };

/**
 * 总览（ReviewView / MemoryOverview）分组模型。
 *
 * 刷题模式沿用 ReviewView 内置的「按题型分组」逻辑，因此 `buildOverview`
 * 返回 null；记忆模式返回自己的状态分组，由 `MemoryOverview.svelte` 渲染。
 */
export interface BankOverviewGroup {
  key: string;
  label: string;
  questionIds: string[];
}

export interface BankOverviewModel {
  groups: BankOverviewGroup[];
}

/**
 * 一种题库模式的能力声明。
 *
 * 新增模式（例如未来的记忆模式）的步骤：
 *   1. 在 `src/quiz/modes/<mode>.ts` 实现本接口
 *   2. 在 `registry.ts` 注册
 *   3. 在 `src/types.ts` 的 BankMode union 与 BankQuestionMap 里登记
 *   4. 在 `src/lib/bankFile.ts` 的 parseBankFile 里处理（类型收窄）
 *   5. UI（App / QuizView / ReviewView）按 mode 分支渲染
 */
export interface BankModeDef {
  readonly mode: BankMode;

  /** 中文显示名 */
  readonly label: string;

  /**
   * 校验该模式的 questions 字段。
   * 题库文件的统一解析入口（`src/lib/bankFile.ts`）按 mode 分发到这里。
   */
  validateQuestions(raw: unknown): BankQuestionsValidation<BankQuestion>;

  /**
   * 总览构建入口（预留）。返回 null 表示沿用 ReviewView 的默认分组。
   */
  buildOverview(
    questions: BankQuestion[],
    state: RuntimeState,
  ): BankOverviewModel | null;
}
