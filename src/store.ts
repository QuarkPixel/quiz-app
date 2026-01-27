/**
 * 状态存储模块
 */

import type {
  StoredState,
  RuntimeState,
  ActivePoolItem,
  Question,
  QuestionType,
  UserSettings,
} from "./types";

import {
  STORAGE_KEY,
  ACTIVE_POOL_SIZE,
  CORRECT_STREAK_TO_MASTER,
  CORRECT_STREAK_AFTER_MISTAKE,
} from "./config";

/** 创建默认的用户设置 */
export function createDefaultSettings(): UserSettings {
  return {
    autoNextOnCorrect: false,
    activePoolSize: ACTIVE_POOL_SIZE,
    correctStreakToMaster: CORRECT_STREAK_TO_MASTER,
    correctStreakAfterMistake: CORRECT_STREAK_AFTER_MISTAKE,
  };
}

/** 创建默认的活动池项 */
export function createActivePoolItem(
  id: string,
  activePoolSize: number,
): ActivePoolItem {
  return {
    id,
    consecutiveCorrect: 0,
    hasEverMistaken: false,
    lastSelectedRound: -activePoolSize * 2, // 确保所有题都是许久未选过
  };
}

/** 创建默认的存储状态 */
function createDefaultStoredState(): StoredState {
  return {
    masteredIds: [],
    activePool: [],
    currentRound: 0,
    filterType: "all",
    settings: createDefaultSettings(),
  };
}

/** 从 localStorage 加载状态 */
export function loadStoredState(): StoredState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as StoredState;
      const defaultState = createDefaultStoredState();
      return {
        ...defaultState,
        ...parsed,
        // 确保 settings 对象存在且包含所有字段
        settings: {
          ...defaultState.settings,
          ...parsed.settings,
        },
      };
    }
  } catch (e) {
    console.error("Failed to load state:", e);
  }
  return createDefaultStoredState();
}

/** 保存状态到 localStorage（只保存需要持久化的部分） */
export function saveState(state: RuntimeState): void {
  const toStore: StoredState = {
    masteredIds: state.masteredIds,
    activePool: state.activePool,
    currentRound: state.currentRound,
    filterType: state.filterType,
    settings: state.settings,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

/** 重置所有进度 */
export function resetStoredState(): StoredState {
  localStorage.removeItem(STORAGE_KEY);
  return createDefaultStoredState();
}

/** 根据筛选条件过滤题目 */
export function filterQuestions(
  questions: Question[],
  filterType: QuestionType | "all",
): Question[] {
  if (filterType === "all") return questions;
  return questions.filter((q) => q.type === filterType);
}

/** 计算待学习题目 ID（所有题目 - 已掌握 - 活动池） */
export function computePendingIds(
  questions: Question[],
  storedState: StoredState,
): string[] {
  const filtered = filterQuestions(questions, storedState.filterType);
  const masteredSet = new Set(storedState.masteredIds);
  const activeSet = new Set(storedState.activePool.map((item) => item.id));

  return filtered
    .filter((q) => !masteredSet.has(q.id) && !activeSet.has(q.id))
    .map((q) => q.id);
}

/** 从存储状态构建运行时状态 */
export function buildRuntimeState(
  questions: Question[],
  storedState: StoredState,
): RuntimeState {
  // 清理活动池中不在当前筛选范围内的题目
  const filtered = filterQuestions(questions, storedState.filterType);
  const filteredIds = new Set(filtered.map((q) => q.id));

  const cleanedActivePool = storedState.activePool.filter((item) =>
    filteredIds.has(item.id),
  );

  // 清理已掌握列表中不在当前筛选范围内的（保留，但不计入统计）
  const cleanedState: StoredState = {
    ...storedState,
    activePool: cleanedActivePool,
  };

  return {
    ...cleanedState,
    pendingIds: computePendingIds(questions, cleanedState),
  };
}

/** 获取活动池中的题目项 */
export function getActivePoolItem(
  state: RuntimeState,
  questionId: string,
): ActivePoolItem | undefined {
  return state.activePool.find((item) => item.id === questionId);
}
