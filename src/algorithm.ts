/**
 * 学习算法模块
 */

import type { Question, RuntimeState, ActivePoolItem, Stats } from "./types";
import { createActivePoolItem, filterQuestions } from "./store";

/**
 * 获取统计信息
 */
export function getStats(questions: Question[], state: RuntimeState): Stats {
  const filtered = filterQuestions(questions, state.filterType);
  const filteredIds = new Set(filtered.map((q) => q.id));

  // 只统计当前筛选范围内的
  const mastered = state.masteredIds.filter((id) => filteredIds.has(id)).length;
  const learning = state.activePool.filter((item) =>
    filteredIds.has(item.id),
  ).length;
  const pending = state.pendingIds.length;
  const total = filtered.length;

  return { mastered, learning, pending, total };
}

/**
 * 填充活动题目池
 */
export function fillActivePool(state: RuntimeState): RuntimeState {
  const newActivePool = [...state.activePool];
  const newPendingIds = [...state.pendingIds];

  const targetSize = state.settings.activePoolSize;

  // 填充到目标大小
  while (newActivePool.length < targetSize && newPendingIds.length > 0) {
    // 从待学习中随机抽取
    const randomIndex = Math.floor(Math.random() * newPendingIds.length);
    const selectedId = newPendingIds[randomIndex];

    // 从待学习移除，加入活动池
    newPendingIds.splice(randomIndex, 1);
    newActivePool.push(createActivePoolItem(selectedId, targetSize));
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
  const length = state.activePool.length;

  if (length === 0) return null;

  // 计算每个题目的选择权重
  const weights: { id: string; weight: number }[] = [];

  for (const item of state.activePool) {
    if (item.id === currentQuestionId) continue;

    const smoothRamp = (x: number, targetX: number) =>
      1 - Math.exp((-x * 4) / targetX);

    const roundsSinceSelected = Math.min(
      state.currentRound - item.lastSelectedRound,
      length * 2,
    );

    const x = Math.max(roundsSinceSelected - length / 3, 0);
    const weight = smoothRamp(x, length / 2);

    // let weight =
    //   roundsSinceSelected === 0
    //     ? RECENT_SELECTION_PENALTY
    //     : Math.min(roundsSinceSelected, 5);

    weights.push({ id: item.id, weight });
  }
  console.log(weights);

  if (weights.length === 0) {
    // 只有一道题
    const onlyId = state.activePool[0].id;
    return questions.find((q) => q.id === onlyId) || null;
  }

  // 加权随机选择
  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * totalWeight;

  for (const w of weights) {
    random -= w.weight;
    if (random <= 0) {
      return questions.find((q) => q.id === w.id) || null;
    }
  }

  const lastId = weights[weights.length - 1].id;
  return questions.find((q) => q.id === lastId) || null;
}

/**
 * 处理答题结果
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
