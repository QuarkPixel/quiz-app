/**
 * 学习算法模块
 */

import type { Question, RuntimeState, ActivePoolItem, Stats } from "./types";
import { createActivePoolItem, filterQuestions } from "./store";
import { LEARNING_COLOR_HIGH, LEARNING_COLOR_LOW } from "./config";
import { isDebugModeEnabled } from "./debug";

interface WeightedPoolItem {
  id: string;
  weight: number;
  roundsSinceSelected: number;
}

function selectionWeight(
  roundsSinceSelected: number,
  poolSize: number,
): number {
  const cooldownRounds = poolSize * 0.6;
  const cappedRounds = Math.min(roundsSinceSelected, poolSize);
  const t = Math.max(
    0,
    Math.min(1, (cappedRounds - cooldownRounds) / (poolSize - cooldownRounds)),
  );
  return t * t;
}

function buildWeightedPool(
  activePool: ActivePoolItem[],
  currentRound: number,
  currentQuestionId?: string,
): WeightedPoolItem[] {
  const poolSize = activePool.length;

  return activePool
    .filter((item) => item.id !== currentQuestionId)
    .map((item) => {
      const roundsSinceSelected = currentRound - item.lastSelectedRound;
      return {
        id: item.id,
        roundsSinceSelected,
        weight: selectionWeight(roundsSinceSelected, poolSize),
      };
    })
    .sort((a, b) => a.weight - b.weight);
}

function logWeightDistribution(
  weights: WeightedPoolItem[],
  currentRound: number,
): void {
  if (!isDebugModeEnabled()) return;

  console.groupCollapsed(
    "%cWeight Distribution %c(Round: %s)",
    "font-weight: bold;",
    "font-weight: normal; color: gray;",
    currentRound,
  );

  weights.forEach((q) => {
    const val = q.weight;
    const LENGTH = 20;
    const solidCount = Math.round(LENGTH * val);

    console.log(
      "%c%s %c%s%c%s %c| %c%s",
      "font-family: monospace; font-weight: bold; color: gray;",
      val.toFixed(3),
      "font-family: monospace; font-weight: bold;",
      "=".repeat(solidCount),
      "font-family: monospace; color: gray;",
      "·".repeat(LENGTH - solidCount),
      "font-family: monospace; color: gray;",
      "font-family: monospace;",
      q.id,
    );
  });

  console.groupEnd();
}

function selectOldestId(weights: WeightedPoolItem[]): string {
  return weights.reduce((best, item) =>
    item.roundsSinceSelected > best.roundsSinceSelected ? item : best,
  ).id;
}

function selectWeightedId(weights: WeightedPoolItem[]): string | null {
  if (weights.length === 0) return null;

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) return selectOldestId(weights);

  let cursor = Math.random() * totalWeight;
  for (const w of weights) {
    if (cursor < w.weight) return w.id;
    cursor -= w.weight;
  }

  return weights[weights.length - 1].id;
}

function takePendingIdsForPool(
  pendingIds: string[],
  count: number,
  isSequential: boolean,
): string[] {
  if (count <= 0) return [];

  if (isSequential) {
    return pendingIds.splice(0, count);
  }

  const selectedIds: string[] = [];
  while (selectedIds.length < count && pendingIds.length > 0) {
    const pickIndex = Math.floor(Math.random() * pendingIds.length);
    const [selectedId] = pendingIds.splice(pickIndex, 1);
    selectedIds.push(selectedId);
  }

  return selectedIds;
}

/**
 * 获取统计信息
 */
export function getStats(questions: Question[], state: RuntimeState): Stats {
  const filtered = filterQuestions(questions, state.filterType);
  const filteredIds = new Set(filtered.map((q) => q.id));
  const questionIds = new Set(questions.map((q) => q.id));
  const activeItems = state.activePool.filter((item) =>
    questionIds.has(item.id),
  );

  // 只统计当前筛选范围内的
  const mastered = state.masteredIds.filter((id) => filteredIds.has(id)).length;
  const learning = activeItems.length;
  const pending = state.pendingIds.length;
  const carriedLearning = activeItems.filter(
    (item) => !filteredIds.has(item.id),
  ).length;
  const total = filtered.length + carriedLearning;

  return { mastered, learning, pending, total };
}

/**
 * 填充活动题目池
 */
export function fillActivePool(state: RuntimeState): RuntimeState {
  const newActivePool = [...state.activePool];
  const newPendingIds = [...state.pendingIds];

  const targetSize = state.settings.activePoolSize;
  // selectionMode 只决定新题从 pendingIds 进入活动池的顺序。
  // 进入活动池后，selectNextFromPool 始终使用同一套加权抽题逻辑。
  const isSequential = state.settings.selectionMode === "sequential";
  const selectedIds = takePendingIdsForPool(
    newPendingIds,
    targetSize - newActivePool.length,
    isSequential,
  );

  for (const selectedId of selectedIds) {
    newActivePool.push(
      createActivePoolItem(selectedId, state.currentRound),
    );
  }

  return {
    ...state,
    activePool: newActivePool,
    pendingIds: newPendingIds,
  };
}

/**
 * 从活动池中选择下一道题目
 */
export function selectNextFromPool(
  questions: Question[],
  state: RuntimeState,
  currentQuestionId?: string,
): Question | null {
  if (state.activePool.length === 0) return null;

  const questionsById = new Map(questions.map((q) => [q.id, q]));
  const weights = buildWeightedPool(
    state.activePool,
    state.currentRound,
    currentQuestionId,
  );

  logWeightDistribution(weights, state.currentRound);

  const selectedId = selectWeightedId(weights) ?? state.activePool[0].id;
  return questionsById.get(selectedId) ?? null;
}

/**
 * 处理答题结果（不补池）
 *
 * 注意：这是内部步骤。绝大多数调用方应该用 `applyAnswer`，它把
 * processAnswer + fillActivePool 合并成原子的状态变迁，避免「调完
 * processAnswer 忘了调 fillActivePool 导致池少题」的隐性 bug。
 *
 * 仍然 export 是因为单元测试需要单独验证答题逻辑，以及非答题场景下
 * 复用「只更新轮次/streak」的语义（目前没有调用方需要这么做）。
 */
export function processAnswer(
  state: RuntimeState,
  questionId: string,
  isCorrect: boolean,
): RuntimeState {
  const newState: RuntimeState = {
    ...state,
    currentRound: state.currentRound + 1,
    activePool: [...state.activePool],
    masteredIds: [...state.masteredIds],
    pendingIds: [...state.pendingIds],
  };

  const itemIndex = newState.activePool.findIndex(
    (item) => item.id === questionId,
  );
  if (itemIndex === -1) return newState;

  const item = { ...newState.activePool[itemIndex] };
  item.hasBeenShown = true;
  item.lastSelectedRound = newState.currentRound;

  if (isCorrect) {
    item.consecutiveCorrect++;

    const requiredStreak = item.hasEverMistaken
      ? state.settings.correctStreakAfterMistake
      : state.settings.correctStreakToMaster;

    if (item.consecutiveCorrect >= requiredStreak) {
      // 掌握了：从活动池移除，加入已掌握
      newState.activePool.splice(itemIndex, 1);
      newState.masteredIds.push(questionId);
    } else {
      newState.activePool[itemIndex] = item;
    }
  } else {
    // 答错：标记并清零
    item.hasEverMistaken = true;
    item.consecutiveCorrect = 0;
    newState.activePool[itemIndex] = item;
  }

  return newState;
}

/**
 * 答题状态变迁的原子化入口：处理答题结果并补足活动池。
 *
 * 调用方应统一用此函数而非 processAnswer + fillActivePool 两步调用，
 * 后者容易遗漏第二步导致池里少题。
 */
export function applyAnswer(
  state: RuntimeState,
  questionId: string,
  isCorrect: boolean,
): RuntimeState {
  return fillActivePool(processAnswer(state, questionId, isCorrect));
}

/**
 * 获取题目需要达到的正确次数
 */
export function getRequiredStreak(
  item: ActivePoolItem,
  state: RuntimeState,
): number {
  return item.hasEverMistaken
    ? state.settings.correctStreakAfterMistake
    : state.settings.correctStreakToMaster;
}

/** 学习中进度条中的一段：level 是稳定身份，width 可为 0 用于平滑过渡 */
export interface LearningSegment {
  level: number;
  color: string;
  widthPercent: number;
}

function mixOklch(t: number): string {
  const l =
    LEARNING_COLOR_LOW.l + (LEARNING_COLOR_HIGH.l - LEARNING_COLOR_LOW.l) * t;
  const c =
    LEARNING_COLOR_LOW.c + (LEARNING_COLOR_HIGH.c - LEARNING_COLOR_LOW.c) * t;
  const h =
    LEARNING_COLOR_LOW.h + (LEARNING_COLOR_HIGH.h - LEARNING_COLOR_LOW.h) * t;
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${h.toFixed(2)})`;
}

export function getLearningLevelColor(level: number, maxLevel: number): string {
  const normalizedMaxLevel = Math.max(
    1,
    Number.isFinite(maxLevel) ? Math.round(maxLevel) : 1,
  );
  const normalizedLevel = Math.min(
    normalizedMaxLevel,
    Math.max(1, Number.isFinite(level) ? Math.round(level) : 1),
  );
  const t =
    normalizedMaxLevel <= 1
      ? 0.5
      : (normalizedLevel - 1) / (normalizedMaxLevel - 1);
  return mixOklch(t);
}

/**
 * 计算学习中进度条的颜色分段。
 *
 * 每道学习中的题目按"还需答对次数"（level = requiredStreak - consecutiveCorrect）
 * 归类，level 越小越接近掌握。按 level 升序排列，相同 level 合并成一段。
 *
 * 颜色规则：
 *   - maxLevel = 1：所有题目共享两端点中点色
 *   - maxLevel > 1：level 在 [1, maxLevel] 间用 OKLCH 线性插值
 */
export function computeLearningSegments(
  questions: Question[],
  state: RuntimeState,
): LearningSegment[] {
  const questionIds = new Set(questions.map((q) => q.id));
  const items = state.activePool.filter((item) => questionIds.has(item.id));

  if (items.length === 0) return [];

  const maxLevel = Math.max(
    state.settings.correctStreakToMaster,
    state.settings.correctStreakAfterMistake,
  );

  const counts = new Map<number, number>();
  for (const item of items) {
    const level = Math.min(
      maxLevel,
      Math.max(1, getRequiredStreak(item, state) - item.consecutiveCorrect),
    );
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }

  const total = items.length;

  return Array.from({ length: maxLevel }, (_, index) => {
    const level = index + 1;
    const t = maxLevel <= 1 ? 0.5 : (level - 1) / (maxLevel - 1);
    return {
      level,
      color: mixOklch(t),
      widthPercent: ((counts.get(level) ?? 0) / total) * 100,
    };
  });
}

/**
 * 随机打乱数组
 */
export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
