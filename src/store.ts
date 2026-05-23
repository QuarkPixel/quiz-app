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

// 由 vite.config.ts 在编译期注入的题库哈希常量
declare const __QUESTIONS_HASH__: string;

/** 创建默认的用户设置 */
export function createDefaultSettings(): UserSettings {
  return {
    autoNextOnCorrect: false,
    activePoolSize: ACTIVE_POOL_SIZE,
    correctStreakToMaster: CORRECT_STREAK_TO_MASTER,
    correctStreakAfterMistake: CORRECT_STREAK_AFTER_MISTAKE,
    selectionMode: "random",
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

/** loadStoredState 的返回结果 */
export type LoadStoredStateResult =
  | { kind: "ok"; state: StoredState }
  | { kind: "hash_mismatch"; state: StoredState; savedHash: string; currentHash: string };

/** 从 localStorage 加载状态，同时校验题库哈希 */
export function loadStoredState(): LoadStoredStateResult {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as StoredState & { questionsHash?: string };
      const defaultState = createDefaultStoredState();
      const state: StoredState = {
        ...defaultState,
        ...parsed,
        // 确保 settings 对象存在且包含所有字段
        settings: {
          ...defaultState.settings,
          ...parsed.settings,
        },
      };

      // 校验题库哈希：有记录且不一致时返回 hash_mismatch
      if (parsed.questionsHash && parsed.questionsHash !== __QUESTIONS_HASH__) {
        return { kind: "hash_mismatch", state, savedHash: parsed.questionsHash, currentHash: __QUESTIONS_HASH__ };
      }

      return { kind: "ok", state };
    }
  } catch (e) {
    console.error("Failed to load state:", e);
  }
  return { kind: "ok", state: createDefaultStoredState() };
}

/** 保存状态到 localStorage（只保存需要持久化的部分，同时写入当前题库哈希） */
export function saveState(state: RuntimeState): void {
  const toStore = {
    masteredIds: state.masteredIds,
    activePool: state.activePool,
    currentRound: state.currentRound,
    filterType: state.filterType,
    settings: state.settings,
    questionsHash: __QUESTIONS_HASH__,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch (e) {
    console.error("Failed to save state:", e);
  }
}

/** 重置所有进度 */
export function resetStoredState(): StoredState {
  const previousState = loadStoredState().state;
  const defaultState = createDefaultStoredState();

  localStorage.removeItem(STORAGE_KEY);

  return {
    ...defaultState,
    // 保留用户配置
    filterType: previousState.filterType,
    settings: previousState.settings,
  };
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
  const filtered = filterQuestions(questions, storedState.filterType);
  const filteredIds = new Set(filtered.map((q) => q.id));

  const cleanedActivePool = storedState.activePool.filter((item) =>
    filteredIds.has(item.id),
  );

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
