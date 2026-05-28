import type { Question, QuestionType, Option } from "../../types";

/** shuffled 后保留原索引的选项，用于 single/multiple 的字母反馈 */
export interface ShuffledOption extends Option {
  originalIndex: number;
}

/**
 * Tabler icon 组件类型。Tabler v3 用 Svelte 4 的 `SvelteComponentTyped`
 * 类，不是 Svelte 5 的 `Component` 函数式接口，所以这里用 `any` 兜底
 * 避免类型链炸开。模板里实际使用时 props（size/stroke/class）由 svelte
 * 编译器按运行时校验。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IconComponent = any;

/**
 * 一个题型的「能力声明」。每个题型在 `src/quiz/types/<type>/` 下实现一份，
 * 注册到 `registry.ts`。所有跨题型的 `switch (type)` 都应该改成 dispatch 到这里。
 *
 * 见 `src/quiz/types/types.ts` 注释，新增题型只需：
 *   1. 新建文件夹 + index.ts 实现该接口
 *   2. 在 registry.ts 注册
 *   3. importExport.ts 不用改（自动用 exportPrefix）
 *   4. validateQuestions.ts 不用改（自动 dispatch）
 *   5. Phase 3 后还需要 Input.svelte 和 Review.svelte
 */
export interface QuestionTypeDef {
  /** 类型 id，同 Question.type */
  id: QuestionType;

  /** 中文显示名 */
  name: string;

  /** Tabler icon 组件 */
  icon: IconComponent;

  /** 用于进度 import/export 的紧凑前缀，单字母（s/m/j/b）。
   *  改动该值会破坏现有进度字符串的向后兼容，谨慎对待。 */
  exportPrefix: string;

  /**
   * 校验题目的 type-specific 字段（answer、options 等）。
   * 不需要校验 id、type、question 本身——那些在 validateQuestions.ts 通用层做。
   *
   * @param item    原始 JSON 对象
   * @param ctx     错误前缀，形如 `"第 5 题（id=single_5）"`；调用方拼到 `${ctx}：xxx`
   */
  validate(item: Record<string, unknown>, ctx: string): string[];

  /**
   * 判分。
   * 当前签名沿用 QuizView 的两套用户输入（选择类用 selectedAnswers，填空类用
   * blankAnswerInputs）。Phase 3 会改造为统一的 UserAnswer 判别联合。
   */
  evaluateAnswer(
    question: Question,
    selectedAnswers: number[],
    blankAnswerInputs: string[],
  ): boolean;

  /** 答案的简短文字摘要，用于 PoolPanel / ReviewView 等概览。 */
  formatAnswerText(question: Question): string;

  /**
   * 答错反馈用的字母（基于 shuffled 后位置）。
   * 仅 single/multiple 有意义；其他题型返回空串。
   */
  getCorrectChoiceLetters(
    question: Question,
    shuffledOptions: ShuffledOption[],
  ): string;
}
