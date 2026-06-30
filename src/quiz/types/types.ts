import type { Component } from "svelte";
import type { Question, QuestionType, Option } from "@/types";

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
 * 答题输入组件的 props。每个题型的 Input.svelte 都接收这套统一 props，
 * 自己挑用得上的字段（如 judgment 不用 shuffledOptions，blank 不用
 * selectedAnswers）。
 *
 * 用 prop + callback 而非 bind: —— Svelte 5 的 bind: 对 class instance
 * field 的 $state（getter/setter-backed）目前不太可靠，prop+callback
 * 等价但稳定。
 */
export interface QuestionInputProps {
  question: Question;
  showResult: boolean;
  isCorrect: boolean;
  readonlyDisplayMode?: "answer" | "preview";
  autoSubmitOnSelection: boolean;
  shuffledOptions: ShuffledOption[];
  selectedAnswers: number[];
  blankAnswerInputs: string[];
  /** 单选 / 多选 / 判断题改 selectedAnswers 时调用 */
  onSelectedAnswersChange?: (value: number[]) => void;
  /** 填空题改 blankAnswerInputs 时调用 */
  onBlankAnswerInputsChange?: (value: string[]) => void;
  /** 单选 / 判断题点击后自动触发提交。多选 / 填空不调用。 */
  onAutoSubmit?: () => void;
}

/** 只读预览组件的 props（用于 ReviewView 答案列表）。 */
export interface QuestionReviewProps {
  question: Question;
}

/** 复制当前题目时需要的答题上下文。 */
export enum QuestionCopyPattern {
  QuestionOnly = "question-only",
  QuestionWithAnswer = "question-with-answer",
  QuestionWithMyAnswerAndAnswer = "question-with-my-answer-and-answer",
}

/** 复制题目时，题型层需要知道的作答上下文。 */
export interface QuestionCopyContext {
  shuffledOptions: ShuffledOption[];
  selectedAnswers: number[];
  blankAnswerInputs: string[];
}

/** 题型层可见的按键信息。故意不直接暴露 DOM KeyboardEvent，保持纯逻辑可测。 */
export interface QuestionKeyboardEvent {
  /** `event.key.toLowerCase()` 的结果，例如 `"a"` / `"enter"` / `" "` */
  key: string;
  /** `event.code`，用于稳定识别 `Space` / `Enter` */
  code: string;
  /**
   * 按键发生的语义区域。
   * - `global`：题目区域的常规全局快捷键
   * - `blank-input`：填空题输入框内
   */
  scope: "global" | "blank-input";
}

/** 题型层识别键盘后返回的结构化动作。 */
export type QuestionKeyboardAction =
  | { kind: "submit" }
  | { kind: "next" }
  | {
      kind: "set-selected-answers";
      value: number[];
      autoSubmit?: boolean;
    };

/** 当前答题状态中，题型级键盘逻辑需要知道的最小上下文。 */
export interface QuestionKeyboardContext {
  question: Question;
  showResult: boolean;
  autoSubmitOnSelection: boolean;
  shuffledOptions: ShuffledOption[];
  selectedAnswers: number[];
  blankAnswerInputs: string[];
}

/**
 * 一个题型的「能力声明」。每个题型在 `src/quiz/types/<type>/` 下实现一份，
 * 注册到 `registry.ts`。所有跨题型的 `switch (type)` 都应该改成 dispatch 到这里。
 *
 * 新增题型的步骤：
 *   1. src/quiz/types/<name>/logic.ts 写纯逻辑（含 QuestionTypeLogic 字段）
 *   2. src/quiz/types/<name>/Input.svelte 答题 UI
 *   3. src/quiz/types/<name>/Review.svelte 只读预览
 *   4. src/quiz/types/<name>/index.ts 合并 logic + icon + Input + Review
 *   5. 在 registry-logic.ts 注册 logic；在 registry.ts import index.ts
 *   6. 在 src/types.ts 的 QuestionType union 添加该 id
 */
export interface QuestionTypeDef extends QuestionTypeLogic {
  /** Tabler icon 组件 */
  icon: IconComponent;

  /** 答题输入组件（Phase 3 起 QuizView 用这个渲染）。 */
  Input: Component<QuestionInputProps>;

  /** 只读预览组件（Phase 3 起 ReviewView 用这个渲染）。 */
  Review: Component<QuestionReviewProps>;
}

/**
 * 题型的纯逻辑部分（不含 icon / Svelte 组件）。Node 侧（vite.config）和
 * 浏览器纯逻辑路径都可以加载，避免触发 Tabler icon 子路径解析。
 */
export interface QuestionTypeLogic {
  /** 类型 id，同 Question.type */
  id: QuestionType;

  /** 中文显示名 */
  name: string;

  /** 简短显示名 */
  shortName: string;

  /**
   * 校验题目的 type-specific 字段（answer、options 等）。
   * 不需要校验 id、type、question 本身——那些在 validateQuestions.ts 通用层做。
   *
   * @param item    原始 JSON 对象
   * @param ctx     错误前缀，形如 `"第 5 题（id=single_5）"`；调用方拼到 `${ctx}：xxx`
   */
  validate(item: Record<string, unknown>, ctx: string): string[];

  /**
   * 判分。沿用 QuizView 的两套用户输入：选择类用 selectedAnswers，
   * 填空类用 blankAnswerInputs。同题型只会取自己关心的那一项。
   */
  evaluateAnswer(
    question: Question,
    selectedAnswers: number[],
    blankAnswerInputs: string[],
  ): boolean;

  /** 答案的简短文字摘要，用于 PoolPanel / ReviewView 等概览。 */
  formatAnswerText(question: Question): string;

  /** 当前题目的剪贴板文本。按钮在 QuestionArea，文案由各题型自己生成。 */
  formatCopyText(
    question: Question,
    context: QuestionCopyContext,
    pattern: QuestionCopyPattern,
  ): string;

  /**
   * 答错反馈用的字母（基于 shuffled 后位置）。
   * 仅 single/multiple 有意义；其他题型返回空串。
   */
  getCorrectChoiceLetters(
    question: Question,
    shuffledOptions: ShuffledOption[],
  ): string;

  /**
   * 题型自己的快捷键识别入口。
   *
   * 这里只负责把“某个键”解释成“某个纯逻辑动作”，不直接碰 session / DOM。
   * 例如：
   * - single: `A` → 选择当前 A 选项并自动提交
   * - multiple: `B` → 切换当前 B 选项
   * - blank: 填空输入框内 `Enter` → 提交或下一题
   */
  getKeyboardAction(
    context: QuestionKeyboardContext,
    event: QuestionKeyboardEvent,
  ): QuestionKeyboardAction | null;
}
