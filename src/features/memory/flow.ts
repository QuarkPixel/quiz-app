/**
 * 记忆模式的「会话流」——一个显式状态机。
 *
 * 以前这一屏的状态散在十个字段里：
 *
 *   `run` / `queue` / `completed` / `reviewTarget` / `reviewedIds` / `reviewTotal` /
 *   `failedThisRound` / `currentQuestion` / `showResult` / `answerKind` / `isCorrect`
 *   （外加只在判分后才有的 `preSubmitState`）
 *
 * 它们能拼出几百种组合，而真实存在的画面只有这些：
 *
 * ```
 *   首页        run = idle          屏上没有卡
 *   学习 · 题干  run = learning      屏上一张卡，等「知道 / 模糊 / 忘记」
 *   学习 · 答案  run = learning      同一张卡 + 答案页（可以改判）
 *   复习 · 题干  run = reviewing     同上，但记账的是复习那一套
 *   复习 · 答案  run = reviewing
 * ```
 *
 * 于是拆成三个正交的维度，每个维度都是判别联合：
 *
 *   - **run**：跑的是哪一档（首页 / 学习 / 复习），各自带自己的队列与计数。
 *     复习那一档额外带一份 `MemoryReviewRun`（进度条分子分母、本轮连对目标、
 *     本轮降级过的卡）——这些只在复习时才有意义，所以**长在复习这一支上**，
 *     不再是一堆「平时恒为空、复习时才用」的平行字段。
 *   - **card**：屏上那张卡与它的作答阶段（题干 / 答案）。`null` = 屏上没有卡。
 *   - **round**：**不在这里**。学习轮是题库级的持久状态（`StoredState.round`），
 *     复习时也照样留着（回到学习要接着学），所以它不属于「这一次会话」。
 *
 * 两条不变式（由构造保证，不靠调用方自觉）：
 *   1. `run.kind === "idle"` ⇔ `card === null`；
 *   2. `card.kind === "answered"` 才带 `rating` / `rewind`——「没判分却有对错」
 *      在类型上不成立。
 */

import type { RuntimeState } from "@/types";
import type { MemoryAnswerKind } from "@/quiz/types/memory/logic";

/** 复习轮的记账：进度条的两个数 + 本轮连对目标 + 本轮降级过的卡。 */
export interface MemoryReviewRun {
  /** 这道卡本轮还要连对几次（默认 1；答错 / 模糊后提到 N）。 */
  target: Record<string, number>;
  /** 今天已经复习完的卡（进度条分子）。 */
  reviewed: string[];
  /** 今天这一轮总共要过几道（进度条分母，开轮时定下）。 */
  total: number;
  /**
   * 本轮被降级过的卡（「忘记」→ 阶梯归零；「模糊」→ 阶梯退一级）。
   *
   * 它们本轮连对达标时**不允许**再推进阶梯：阶梯已经被调低，
   * 再推进就等于「答错那道和一次答对那道拿到同样的间隔」。
   */
  failed: string[];
}

/** 正在跑哪一档。 */
export type MemoryRun =
  | { kind: "idle" }
  | { kind: "learning"; queue: string[]; completed: number }
  | { kind: "reviewing"; queue: string[]; completed: number; review: MemoryReviewRun };

/** 屏上的那张卡。 */
export type MemoryCard =
  | { kind: "asking"; id: string }
  | {
      kind: "answered";
      id: string;
      rating: MemoryAnswerKind;
      correct: boolean;
      /**
       * 判分前的 `RuntimeState` 快照：答案页的「记错了 / 模糊」以它为起点重算，
       * 所以反复改判不会叠加。
       */
      rewind: RuntimeState;
    };

export interface MemoryFlow {
  run: MemoryRun;
  card: MemoryCard | null;
}

/** 首页：没在跑，屏上也没有卡。 */
export const IDLE_FLOW: MemoryFlow = { run: { kind: "idle" }, card: null };

// ── 读 ────────────────────────────────────────────────────────────────────

export function runKindOf(flow: MemoryFlow): MemoryRun["kind"] {
  return flow.run.kind;
}

/** 队列（首页恒为空）。 */
export function queueOf(flow: MemoryFlow): readonly string[] {
  return flow.run.kind === "idle" ? [] : flow.run.queue;
}

/** 本轮完成数（学习 / 复习各自数自己的）。 */
export function completedOf(flow: MemoryFlow): number {
  return flow.run.kind === "idle" ? 0 : flow.run.completed;
}

/** 复习记账（不在复习时为 `null`）。 */
export function reviewOf(flow: MemoryFlow): MemoryReviewRun | null {
  return flow.run.kind === "reviewing" ? flow.run.review : null;
}

/** 屏上那张卡的 id（没有卡时为 `null`）。 */
export function cardIdOf(flow: MemoryFlow): string | null {
  return flow.card?.id ?? null;
}

/** 屏上是不是「还在题干页」（等自评）。 */
export function isAsking(flow: MemoryFlow): boolean {
  return flow.card?.kind === "asking";
}

/** 屏上是不是「已经亮出答案」。 */
export function isAnswered(flow: MemoryFlow): boolean {
  return flow.card?.kind === "answered";
}

/** 答案页的自评结果（不在答案页时为 `null`）。 */
export function ratingOf(flow: MemoryFlow): MemoryAnswerKind | null {
  return flow.card?.kind === "answered" ? flow.card.rating : null;
}

/** 答案页的对错（不在答案页时为 `false`）。 */
export function correctnessOf(flow: MemoryFlow): boolean {
  return flow.card?.kind === "answered" ? flow.card.correct : false;
}

/** 答案页的判分前快照（不在答案页时为 `null`）。 */
export function rewindOf(flow: MemoryFlow): RuntimeState | null {
  return flow.card?.kind === "answered" ? flow.card.rewind : null;
}

// ── 转移：会话进出 ────────────────────────────────────────────────────────

/** 开一轮学习（队列已排好序）。 */
export function startLearning(queue: readonly string[]): MemoryFlow {
  return {
    run: { kind: "learning", queue: [...queue], completed: 0 },
    card: null,
  };
}

/** 开一轮复习。 */
export function startReview(
  queue: readonly string[],
  review: MemoryReviewRun,
): MemoryFlow {
  return {
    run: {
      kind: "reviewing",
      queue: [...queue],
      completed: 0,
      review: cloneReview(review),
    },
    card: null,
  };
}

/** 回到首页：这一轮结束 / 退出（学习轮本身由调用方决定留不留）。 */
export function finishRun(): MemoryFlow {
  return IDLE_FLOW;
}

// ── 转移：屏上的卡 ────────────────────────────────────────────────────────

/** 出下一张卡（回到题干页）。首页调不动。 */
export function showCard(flow: MemoryFlow, id: string): MemoryFlow {
  if (flow.run.kind === "idle") return flow;
  return { run: flow.run, card: { kind: "asking", id } };
}

/** 自评：题干页 → 答案页。重复提交 / 首页都是空操作。 */
export function answerCard(
  flow: MemoryFlow,
  rating: MemoryAnswerKind,
  correct: boolean,
  rewind: RuntimeState,
): MemoryFlow {
  if (flow.card?.kind !== "asking") return flow;
  return {
    run: flow.run,
    card: { kind: "answered", id: flow.card.id, rating, correct, rewind },
  };
}

/** 收起屏上的卡（队列空了 / 会话收尾）。 */
export function hideCard(flow: MemoryFlow): MemoryFlow {
  if (flow.card === null) return flow;
  return { run: flow.run, card: null };
}

/**
 * 答案页改判（「记错了」/「模糊」）：答案页 → 答案页，换一档自评。
 *
 * 以调用方给的判分前快照重算，所以反复改判不会叠加。题干页调不动
 * （没判分就没有「改判」这回事）。
 */
export function reAnswer(
  flow: MemoryFlow,
  rating: MemoryAnswerKind,
  correct: boolean,
  rewind: RuntimeState,
): MemoryFlow {
  if (flow.card?.kind !== "answered") return flow;
  return {
    run: flow.run,
    card: { kind: "answered", id: flow.card.id, rating, correct, rewind },
  };
}

// ── 转移：队列 ────────────────────────────────────────────────────────────

/** 整条队列换掉（开轮时按池子重建）。 */
export function replaceQueue(flow: MemoryFlow, ids: readonly string[]): MemoryFlow {
  if (flow.run.kind === "idle") return flow;
  return { run: { ...flow.run, queue: [...ids] }, card: flow.card };
}

/** 队首挪到队尾（学习没连对够 / 复习没补完连对时用）。 */
export function rotateQueue(flow: MemoryFlow): MemoryFlow {
  if (flow.run.kind === "idle") return flow;
  const [head, ...rest] = flow.run.queue;
  if (head === undefined) return flow;
  return { run: { ...flow.run, queue: [...rest, head] }, card: flow.card };
}

/** 出队（队首）。 */
export function dropQueueHead(flow: MemoryFlow): MemoryFlow {
  if (flow.run.kind === "idle") return flow;
  return { run: { ...flow.run, queue: flow.run.queue.slice(1) }, card: flow.card };
}

/** 从队列里剔掉某张卡（在总览里被标熟 / 已不在池子里）。 */
export function dropFromQueue(flow: MemoryFlow, id: string): MemoryFlow {
  if (flow.run.kind === "idle") return flow;
  const queue = flow.run.queue.filter((other) => other !== id);
  if (queue.length === flow.run.queue.length) return flow;
  return { run: { ...flow.run, queue }, card: flow.card };
}

/** 只留下池子里还有的卡（池子是轮的投影，队列跟着它收敛）。 */
export function retainInQueue(
  flow: MemoryFlow,
  keep: ReadonlySet<string>,
): MemoryFlow {
  if (flow.run.kind === "idle") return flow;
  const queue = flow.run.queue.filter((id) => keep.has(id));
  if (queue.length === flow.run.queue.length) return flow;
  return { run: { ...flow.run, queue }, card: flow.card };
}

/** 往队尾追加（补卡 / 本轮重新排）。 */
export function appendQueue(
  flow: MemoryFlow,
  ids: readonly string[],
): MemoryFlow {
  if (flow.run.kind === "idle" || ids.length === 0) return flow;
  return { run: { ...flow.run, queue: [...flow.run.queue, ...ids] }, card: flow.card };
}

/** 本轮完成数 +1。 */
export function countCompletion(flow: MemoryFlow): MemoryFlow {
  if (flow.run.kind === "idle") return flow;
  return {
    run: { ...flow.run, completed: flow.run.completed + 1 },
    card: flow.card,
  };
}

// ── 转移：复习记账 ────────────────────────────────────────────────────────
//
// 这些只在 `run.kind === "reviewing"` 时生效；不在复习时调用它们是空操作
// （以前那批平行字段在任何时候都「存在」，于是写错地方也不报错）。

/** 改复习记账的某几项（`reviewed` / `failed` 会复制一份，避免共享引用）。 */
export function patchReview(
  flow: MemoryFlow,
  patch: Partial<MemoryReviewRun>,
): MemoryFlow {
  if (flow.run.kind !== "reviewing") return flow;
  return {
    run: { ...flow.run, review: { ...flow.run.review, ...patch } },
    card: flow.card,
  };
}

/** 这道卡本轮要连对几次。 */
export function setReviewTarget(
  flow: MemoryFlow,
  id: string,
  target: number,
): MemoryFlow {
  const review = reviewOf(flow);
  if (!review) return flow;
  return patchReview(flow, { target: { ...review.target, [id]: target } });
}

/** 这道卡的本轮要求已经补完了。 */
export function clearReviewTarget(flow: MemoryFlow, id: string): MemoryFlow {
  const review = reviewOf(flow);
  if (!review || review.target[id] === undefined) return flow;
  const target = { ...review.target };
  delete target[id];
  return patchReview(flow, { target });
}

/** 记一道「今天复习过了」（幂等）。 */
export function addReviewed(flow: MemoryFlow, id: string): MemoryFlow {
  const review = reviewOf(flow);
  if (!review || review.reviewed.includes(id)) return flow;
  return patchReview(flow, { reviewed: [...review.reviewed, id] });
}

/** 记一道「本轮降级过」（幂等）。 */
export function addFailed(flow: MemoryFlow, id: string): MemoryFlow {
  const review = reviewOf(flow);
  if (!review || review.failed.includes(id)) return flow;
  return patchReview(flow, { failed: [...review.failed, id] });
}

/** 某道卡不再是「本轮降级过」（在总览里被标熟）。 */
export function removeFailed(flow: MemoryFlow, id: string): MemoryFlow {
  const review = reviewOf(flow);
  if (!review || !review.failed.includes(id)) return flow;
  return patchReview(flow, {
    failed: review.failed.filter((other) => other !== id),
  });
}

function cloneReview(review: MemoryReviewRun): MemoryReviewRun {
  return {
    target: { ...review.target },
    reviewed: [...review.reviewed],
    total: review.total,
    failed: [...review.failed],
  };
}
