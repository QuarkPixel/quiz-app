/**
 * 记忆模式的**只读投影**：首页数字、进度条分子分母、今天还能复习几道。
 *
 * 这些查询以前是 `MemorySession` 上的 20 多个 getter，正文混在 2000 行里。
 * 它们有一个共同点：**只读**——输入是 `appState` / `flow` / `round` / 盘上会话，
 * 输出是一个数字或一个列表，不写任何字段。所以可以原样搬到纯函数里，
 * 类那边只剩一行委托。
 *
 * 为什么值得拆：这些数字是 UI 与「开始复习」共用的**同一份判据**。放在一处，
 * 改「到期怎么算」时不会出现「首页说 12 道、点进去说没有」那种各算各的。
 */

import type {
  MemoryQuestion,
  MemoryReviewSession,
  MemoryRoundState,
  MemorySessionsState,
  RuntimeState,
} from "@/types";
import { isDue } from "./algorithm";
import { dayKeyOf } from "./day";
import { memoryRoundDone, memoryRoundRemaining } from "./round";
import { queueOf, reviewOf, type MemoryFlow } from "./flow";
import { createDefaultMemorySettings } from "./settings";

/** 投影需要的全部输入（都是只读的）。 */
export interface MemoryQueryInput {
  appState: RuntimeState;
  flow: MemoryFlow;
  questions: readonly MemoryQuestion[];
  now: number;
  round: MemoryRoundState | null;
  savedSessions: MemorySessionsState | undefined;
}

const EMPTY_IDS: readonly string[] = [];

/** 每道题的复习阶梯。 */
function progressOf(input: MemoryQueryInput) {
  return input.appState.memory?.progress ?? {};
}

/** 记忆模式的按库设置。 */
function settingsOf(input: MemoryQueryInput) {
  return input.appState.memory?.settings ?? createDefaultMemorySettings();
}

/** 今天那一份复习会话；今天还没进过复习时是 null。 */
export function storedReviewTodayOf(
  input: MemoryQueryInput,
): MemoryReviewSession | null {
  const review = input.savedSessions?.review;
  if (!review || review.day !== dayKeyOf(input.now)) return null;
  return review;
}

/**
 * 「今天过了哪几道 / 一共几道」——**两个主人在同一份事实上接力**。
 *
 * - 复习轮跑着时，实时值长在会话流上（`flow.run.review`），跟着流一起走；
 * - 轮收尾后流回到 `idle`，那份就没了，但「今天过了这几道」是事实，
 *   还留在盘上（`sessions.review`），直到下一天开轮时换成新的一份。
 *
 * 分母**不读盘上的 `queue`**：那份队列是「上次开轮时排的计划」，跨天续做时
 * 可能留着已经被推到未来的卡（曾经出现「首页说 3 道、进度条 39 道」）。
 * 分母 = 今天已经过关的 + **今天还能复习的**（与首页 `reviewableCount`、
 * 「复习」入口的队列同一个判据 `reviewQueueTodayOf`）。
 */
export function reviewedTodayOf(input: MemoryQueryInput): {
  reviewed: readonly string[];
  total: number;
} {
  const live = reviewOf(input.flow);
  if (live) {
    return {
      reviewed: live.reviewed,
      total: live.reviewed.length + queueOf(input.flow).length,
    };
  }
  const stored = storedReviewTodayOf(input);
  if (!stored) return { reviewed: EMPTY_IDS, total: 0 };
  return {
    reviewed: stored.doneIds,
    total: stored.doneIds.length + reviewableCountOf(input),
  };
}

/** 今天**答过**的卡（含「忘记 / 模糊」）。 */
export function touchedTodayOf(input: MemoryQueryInput): readonly string[] {
  const live = reviewOf(input.flow);
  if (live) return live.touched;
  return storedReviewTodayOf(input)?.touchedIds ?? EMPTY_IDS;
}

/**
 * 今天仍然有效的「重新连对」要求：题目 id → 还要连对几次。
 *
 * 只认**今天**的会话：昨天答错留下的「还要连对 N 次」跨天就作废（那张卡今天
 * 按常规到期重来，答对一次即过）。时钟偏快读到的「未来」会话同理。
 */
export function retryTargetsTodayOf(
  input: MemoryQueryInput,
): Record<string, number> {
  const session = input.savedSessions?.review;
  if (!session || session.day !== dayKeyOf(input.now)) return {};

  const done = new Set(session.doneIds);
  const targets: Record<string, number> = {};
  for (const [id, target] of Object.entries(session.targets)) {
    if (done.has(id) || target < 1) continue;
    const item = progressOf(input)[id];
    if (item?.state === "reviewing") targets[id] = target;
  }
  return targets;
}

/**
 * 今天这一轮的复习队列：**到期的 + 还没补完连对的**。
 *
 * 刻意**不看** `doneIds`：那份清单只回答「进度条现在是多少」，不回答「这道卡
 * 今天还能不能练」。到期就得能复习——今天的卡今天想再过一遍是正常需求，
 * 分母会跟着长。
 *
 * **这是「今天要复习哪些卡」的唯一判据**：首页数字、复习入口的队列、进度条
 * 分母都从它出。盘上的 `sessions.review.queue` 只是「上次排的顺序 / 停在哪」，
 * 不是计划本身——曾经把它当计划，于是跨天续做时越滚越大，首页说 3 道、
 * 进度条却是 39 道。
 */
export function reviewQueueTodayOf(
  input: MemoryQueryInput,
): MemoryQuestion[] {
  const due = input.questions.filter((q) => {
    const item = progressOf(input)[q.id];
    return item ? isDue(item, input.now) : false;
  });

  // 答错后还没补完连对的卡：它们已经不在「到期」里了（`nextDue` 被推到明天），
  // 但仍留在本轮（今天），否则「答错后必须连对 N 次」一出会话就没了
  const retryTargets = retryTargetsTodayOf(input);
  const dueIds = new Set(due.map((q) => q.id));
  const retryQuestions = input.questions.filter(
    (q) => retryTargets[q.id] !== undefined && !dueIds.has(q.id),
  );

  return [...due, ...retryQuestions];
}

/** 今日到期待复习数量。 */
export function dueCountOf(input: MemoryQueryInput): number {
  return input.questions.filter((q) => {
    const item = progressOf(input)[q.id];
    return item ? isDue(item, input.now) : false;
  }).length;
}

/** 今天还没补完的「答错后重新连对」数量。 */
export function pendingRetryCountOf(input: MemoryQueryInput): number {
  const targets = retryTargetsTodayOf(input);
  if (Object.keys(targets).length === 0) return 0;
  return input.questions.filter((q) => targets[q.id] !== undefined).length;
}

/** 今天可以进入复习的卡片数（到期的 + 还没补完连对的，去掉今天已过关的）。 */
export function reviewableCountOf(input: MemoryQueryInput): number {
  const done = new Set(storedReviewTodayOf(input)?.doneIds ?? []);
  return reviewQueueTodayOf(input).filter((q) => !done.has(q.id)).length;
}

/** 没学过的卡有几道。 */
export function newCountOf(input: MemoryQueryInput): number {
  return input.questions.filter((q) => progressOf(input)[q.id] === undefined)
    .length;
}

/** 复习中的卡有几道。 */
export function reviewingCountOf(input: MemoryQueryInput): number {
  return Object.values(progressOf(input)).filter(
    (item) => item.state === "reviewing",
  ).length;
}

/** 学到一半（连对还没够）的卡有几道。 */
export function learningCountOf(input: MemoryQueryInput): number {
  return Object.values(progressOf(input)).filter(
    (item) => item.state === "learning",
  ).length;
}

/** 已掌握的卡有几道。 */
export function masteredCountOf(input: MemoryQueryInput): number {
  return Object.values(progressOf(input)).filter(
    (item) => item.state === "mastered",
  ).length;
}

/** 「学习新的题目」还能学几道：没学过的 + 学到一半的。 */
export function learnableCountOf(input: MemoryQueryInput): number {
  return newCountOf(input) + learningCountOf(input);
}

/** 这道卡还能学吗（没学过，或者学到一半）。与 `poolCandidates` 同一份判据。 */
export function isLearnableOf(input: MemoryQueryInput, id: string): boolean {
  const item = progressOf(input)[id];
  return item === undefined || item.state === "learning";
}

/**
 * 学到一半（这一轮还有没学完的卡），下次点「学习新的题目」接着继续。
 *
 * 判据是**轮模型里还剩几道能学的**，不是「池子里有没有条目」——池子只是轮的
 * 投影，复习期间它还被借去当到期队列了。
 */
export function hasOngoingRoundOf(input: MemoryQueryInput): boolean {
  const round = input.round;
  if (!round) return false;
  return memoryRoundRemaining(round).some((id) => isLearnableOf(input, id));
}

/** 今天是否已经学完过一轮（`memory.learnedDay` 是不是今天）。 */
export function learnedTodayOf(input: MemoryQueryInput): boolean {
  const learned = input.appState.memory?.learnedDay;
  return learned !== undefined && learned === dayKeyOf(input.now);
}

/**
 * 本轮学习目标（题）：有进行中的一轮就用那一轮的目标（开轮时定下，中途改设置
 * 不影响它）；没有就用设置里的 `roundTarget`。
 */
export function targetPerRoundOf(input: MemoryQueryInput): number {
  if (input.round) return input.round.goal;
  return Math.max(1, settingsOf(input).roundTarget);
}

/** 本轮已经掌握了几道。 */
export function roundMasteredOf(input: MemoryQueryInput): number {
  return input.round ? memoryRoundDone(input.round) : 0;
}

/** 首页「学习新的题目」这次会学几道。 */
export function nextBatchSizeOf(input: MemoryQueryInput): number {
  return Math.min(learnableCountOf(input), targetPerRoundOf(input));
}
