/**
 * 状态存储模块
 *
 * 所有函数均按 bank 的 hash 分 key 存储。hash 由调用方提供：
 *   - Bundled 模式：来自编译期注入的 __QUESTIONS_HASH__
 *   - Library 模式：来自当前 active bank
 */

import type {
  StoredState,
  RuntimeState,
  ActivePoolItem,
  Question,
  QuestionType,
  UserSettings,
  UiPreferences,
} from "./types";

import {
  STORAGE_PREFIX_STATE,
  STORAGE_KEY_DEFAULT_SETTINGS,
  ACTIVE_POOL_SIZE,
  CORRECT_STREAK_TO_MASTER,
  CORRECT_STREAK_AFTER_MISTAKE,
} from "./config";

export interface LoadStoredStateOptions {
  /** 使用本地持久化的默认设置作为缺省值（library 模式使用）。 */
  usePersistedDefaultSettings?: boolean;
}

export interface SaveStateOptions {
  /** 保存当前 bank 状态时，同步把 settings 写入默认设置。 */
  updateDefaultSettings?: boolean;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function mergeSettings(
  defaults: UserSettings,
  settings: unknown,
): UserSettings {
  if (!isRecord(settings)) return { ...defaults };
  return {
    ...defaults,
    ...(settings as Partial<UserSettings>),
  };
}

/** 从 localStorage 加载用户默认设置；不存在时回落到代码默认配置。 */
export function loadDefaultSettings(): UserSettings {
  const codeDefaults = createDefaultSettings();

  try {
    const saved = localStorage.getItem(STORAGE_KEY_DEFAULT_SETTINGS);
    if (saved === null) return codeDefaults;
    return mergeSettings(codeDefaults, JSON.parse(saved));
  } catch (e) {
    console.error("Failed to load default settings:", e);
    return codeDefaults;
  }
}

/** 保存用户默认设置。失败仅 warn，不打断当前题库设置保存流程。 */
export function saveDefaultSettings(settings: UserSettings): void {
  try {
    const toStore = mergeSettings(createDefaultSettings(), settings);
    localStorage.setItem(STORAGE_KEY_DEFAULT_SETTINGS, JSON.stringify(toStore));
  } catch (e) {
    console.warn("Failed to save default settings:", e);
  }
}

/** 创建默认的 UI 偏好 */
export function createDefaultUiPreferences(): UiPreferences {
  return {
    progressFocused: false,
    showPool: false,
  };
}

/** 创建默认的活动池项 */
export function createActivePoolItem(
  id: string,
  currentRound = 0,
): ActivePoolItem {
  return {
    id,
    consecutiveCorrect: 0,
    hasEverMistaken: false,
    hasBeenShown: false,
    lastSelectedRound: currentRound,
  };
}

export function isUnansweredNewActivePoolItem(
  item: ActivePoolItem,
): boolean {
  if (item.consecutiveCorrect !== 0 || item.hasEverMistaken) return false;
  return !item.hasBeenShown;
}

/** 创建默认的存储状态 */
function createDefaultStoredState(
  options: LoadStoredStateOptions = {},
): StoredState {
  return {
    masteredIds: [],
    activePool: [],
    currentRound: 0,
    filterType: "all",
    settings: options.usePersistedDefaultSettings
      ? loadDefaultSettings()
      : createDefaultSettings(),
    ui: createDefaultUiPreferences(),
  };
}

function stateKey(hash: string): string {
  return STORAGE_PREFIX_STATE + hash;
}

/** 从 localStorage 加载指定 bank 的状态 */
export function loadStoredState(
  hash: string,
  options: LoadStoredStateOptions = {},
): StoredState {
  const defaultState = createDefaultStoredState(options);

  try {
    const saved = localStorage.getItem(stateKey(hash));
    if (saved) {
      const parsed = JSON.parse(saved);
      const parsedState = isRecord(parsed)
        ? (parsed as Partial<StoredState>)
        : {};
      return {
        ...defaultState,
        ...parsedState,
        settings: mergeSettings(defaultState.settings, parsedState.settings),
        ui: {
          ...defaultState.ui,
          ...(isRecord(parsedState.ui) ? parsedState.ui : {}),
        },
      };
    }
  } catch (e) {
    console.error("Failed to load state:", e);
  }
  return defaultState;
}

/**
 * 保存指定 bank 的状态到 localStorage。
 * 配额异常仅 warn 不抛错——做题流不应因此被打断。
 */
export function saveState(
  hash: string,
  state: RuntimeState,
  options: SaveStateOptions = {},
): void {
  const toStore: StoredState = {
    masteredIds: state.masteredIds,
    activePool: state.activePool,
    currentRound: state.currentRound,
    filterType: state.filterType,
    settings: state.settings,
    ui: state.ui,
  };
  try {
    localStorage.setItem(stateKey(hash), JSON.stringify(toStore));
  } catch (e) {
    console.warn("Failed to save state:", e);
  }

  if (options.updateDefaultSettings) {
    saveDefaultSettings(state.settings);
  }
}

/** 重置指定 bank 的进度（保留 filterType 和 settings 和 ui） */
export function resetStoredState(
  hash: string,
  options: LoadStoredStateOptions = {},
): StoredState {
  const previous = loadStoredState(hash, options);
  const defaultState = createDefaultStoredState(options);

  try {
    localStorage.removeItem(stateKey(hash));
  } catch (e) {
    console.warn("Failed to remove state:", e);
  }

  return {
    ...defaultState,
    filterType: previous.filterType,
    settings: previous.settings,
    ui: previous.ui,
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
