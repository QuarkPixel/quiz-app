/**
 * 刷题模式的「答题流」——一个显式状态机。
 *
 * 以前这一屏的状态是五个互不相干的字段拼出来的：
 *
 *   `currentQuestion` / `showResult` / `isCorrect` / `isPreviewingNewQuestion`
 *   （外加只在提交后才有意义的 `preSubmitState` 与 `newQuestionQueue`）
 *
 * 五个字段能拼出 32 种组合，而真实存在的画面只有四种：
 *
 * ```
 *   empty    题库为空 / 当前筛选下全部掌握 —— 没有题可出
 *   asking   一道题摊在屏上，等作答
 *   judged   同一道题 + 对错反馈，等「下一题」
 *   preview  屏上换成刚入池的新题（答案摊开），等「我知道了」
 * ```
 *
 * 拼不出来的那些组合此前全靠各处的 `&&` 兜着——`QuestionActions` 里的
 * `showFeedback = !previewing && showResult` 就是其中一条，`advanceQuestionFlow`
 * 的三层 if 是另一条。这里把它们收进一个判别联合：**非法状态在类型上就不存在**，
 * 于是「预览时还留着上一题的判分结果」这类问题不必再靠调用方自觉。
 *
 * 三条约定：
 *   1. 转移函数全是纯函数，`QuizSession` 只负责把结果写回 `$state`；
 *   2. 「下一题是什么」不归这里管——`advance()` 答不上来时返回 `null`，
 *      由会话去题库里挑（见 `QuizSession.selectNext`）；
 *   3. 作答草稿（`selectedAnswers` / `blankAnswerInputs` / `shuffledOptions`）
 *      **不属于**这台机器：它们是用户正在填的表单，换题时由会话清空。
 *
 * **跨刷新的那一份不在这里**：这台机器活在内存里，刷新即回到 `empty`。
 * 「停在哪一道、答到哪一步」由 `StoredState.quizSession` 落盘 / 同步，
 * 恢复逻辑见 `QuizSession.restoreQuizSession`（模型在 `./quizSession.ts`）。
 */

import type { Question, RuntimeState } from "@/types";

/**
 * 屏上的状态。
 *
 * `queued` 是「答题过程中新进活动池、待提示的题」（FIFO）。它只在
 * `notifyNewQuestionInPool` 打开时才会长出来，一次答题最多入池一题。
 */
export type QuizFlow =
  /** 没有可出的题（空题库 / 全部掌握）。 */
  | { kind: "empty" }
  /** 出题中：等用户作答。 */
  | { kind: "asking"; question: Question; queued: readonly Question[] }
  /**
   * 已判分：等「下一题」。
   *
   * `rewind` 是提交前的 `RuntimeState` 快照，「视作正确」以它为起点重算——
   * 只有这一态才有它，所以「换题之后还能反悔」这种状态压根表示不出来。
   * 用过一次就置 `null`（反悔只能一次，避免反复叠加）。
   */
  | {
      kind: "judged";
      question: Question;
      correct: boolean;
      rewind: RuntimeState | null;
      queued: readonly Question[];
    }
  /**
   * 新题预告：屏上是刚入池的那道题，答案直接摊开。
   *
   * 队列用非空元组表示——「预告态但队列是空的」在类型上不成立。
   */
  | { kind: "preview"; queued: readonly [Question, ...Question[]] };

/** 初始状态：没有题。 */
export const EMPTY_QUIZ_FLOW: QuizFlow = { kind: "empty" };

// ── 读 ────────────────────────────────────────────────────────────────────

/** 屏上那道题（预告态是预告的那道）。 */
export function questionOf(flow: QuizFlow): Question | null {
  switch (flow.kind) {
    case "asking":
    case "judged":
      return flow.question;
    case "preview":
      return flow.queued[0];
    case "empty":
      return null;
  }
}

/** 待提示的新题队列（预告态也返回整条队列，队首就是屏上那道）。 */
export function queuedOf(flow: QuizFlow): readonly Question[] {
  switch (flow.kind) {
    case "asking":
    case "judged":
      return flow.queued;
    case "preview":
      return flow.queued;
    case "empty":
      return [];
  }
}

/** 队首的新题（`currentNewQuestion`）。 */
export function nextQueuedOf(flow: QuizFlow): Question | null {
  return queuedOf(flow)[0] ?? null;
}

/** 是否处在「已经亮出答案」的画面（判分后 / 新题预告）。 */
export function showsAnswer(flow: QuizFlow): boolean {
  return flow.kind === "judged" || flow.kind === "preview";
}

/**
 * 画面上算不算「答对」。
 *
 * 预告态恒为 `true`：它展示的就是「这道新题连同答案」，配色与图标都按
 * 「已掌握」那一档走（见 `QuestionActions`）。
 */
export function answerIsCorrect(flow: QuizFlow): boolean {
  if (flow.kind === "judged") return flow.correct;
  return flow.kind === "preview";
}

/** 「视作正确」可用的那份快照（不可用时为 `null`）。 */
export function rewindOf(flow: QuizFlow): RuntimeState | null {
  return flow.kind === "judged" ? flow.rewind : null;
}

// ── 转移 ──────────────────────────────────────────────────────────────────

/** 出下一题（保留待提示队列）。 */
export function ask(question: Question, queued: readonly Question[] = []): QuizFlow {
  return { kind: "asking", question, queued };
}

/** 判分：只有出题中才转得动（重复提交、预告态提交都是空操作）。 */
export function judge(
  flow: QuizFlow,
  correct: boolean,
  rewind: RuntimeState,
): QuizFlow {
  if (flow.kind !== "asking") return flow;
  return {
    kind: "judged",
    question: flow.question,
    correct,
    rewind,
    queued: flow.queued,
  };
}

/** 「视作正确」：判分后改判，快照用掉就丢（反悔只有一次）。 */
export function markCorrect(flow: QuizFlow): QuizFlow {
  if (flow.kind !== "judged") return flow;
  return { ...flow, correct: true, rewind: null };
}

/** 有新题入池：排进待提示队列（预告态接在队尾）。 */
export function enqueue(flow: QuizFlow, questions: readonly Question[]): QuizFlow {
  if (questions.length === 0) return flow;
  switch (flow.kind) {
    case "asking":
    case "judged":
      return { ...flow, queued: [...flow.queued, ...questions] };
    case "preview":
      return { kind: "preview", queued: [...flow.queued, ...questions] };
    case "empty":
      return flow;
  }
}

/**
 * 「下一题」：能就地转就转，转不了返回 `null`（由会话去题库里挑新题）。
 *
 *   - 预告态：队列还有下一张 → 继续预告；没有 → `null`
 *   - 判分 / 出题中：队列非空 → 进预告；队列空 → `null`
 *   - 空：`null`
 */
export function advance(flow: QuizFlow): QuizFlow | null {
  switch (flow.kind) {
    case "preview": {
      const [, ...rest] = flow.queued;
      if (rest.length === 0) return null;
      return { kind: "preview", queued: rest as [Question, ...Question[]] };
    }
    case "asking":
    case "judged": {
      const [head, ...rest] = flow.queued;
      if (head === undefined) return null;
      return { kind: "preview", queued: [head, ...rest] };
    }
    case "empty":
      return null;
  }
}

/**
 * 把预告的那道题拿掉（在总览 / 顶栏里把它标成已掌握之后）。
 *
 * 与 `advance` 的区别只是「先出队」：剩下的队列非空就继续预告，
 * 空了就交给会话出下一题。
 */
export function dropPreview(flow: QuizFlow): QuizFlow | null {
  if (flow.kind !== "preview") return advance(flow);
  const [, ...rest] = flow.queued;
  if (rest.length === 0) return null;
  return { kind: "preview", queued: rest as [Question, ...Question[]] };
}

/** 清空（换筛选 / 重置 / 导入进度之后重新出题前用）。 */
export function resetFlow(): QuizFlow {
  return EMPTY_QUIZ_FLOW;
}
