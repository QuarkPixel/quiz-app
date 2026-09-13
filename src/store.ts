/**
 * 每个题库的状态存储模块
 *
 * 所有函数均按 bank 的 hash 分 key 存储。hash 由调用方提供（来自当前 active bank）。
 * 按库设置的默认模板来自 general 配置的 `defaultSettings`。
 */

import type {
  StoredState,
  RuntimeState,
  ActivePoolItem,
  Question,
  QuestionType,
  BankSettings,
  UiPreferences,
} from "./types";

import { STORAGE_PREFIX_STATE } from "./config";
import {
  createDefaultBankSettings,
  sanitizeBankSettings,
} from "./bankSettings";
import { loadGeneralConfig, updateGeneralConfig } from "./generalConfig";

export interface SaveStateOptions {
  /** 保存当前 bank 状态时，同步把 settings 写入 general 配置的默认模板。 */
  updateDefaultSettings?: boolean;
}

/** 创建按库设置的默认值（代码内置）。 */
export function createDefaultSettings(): BankSettings {
  return createDefaultBankSettings();
}

/** 从 general 配置读取「新题库默认设置」；缺失时回落到代码默认值。 */
export function loadDefaultSettings(): BankSettings {
  const config = loadGeneralConfig();
  return sanitizeBankSettings(config.defaultSettings);
}

/** 把设置写入 general 配置的默认模板。失败仅 warn，不打断当前题库设置保存流程。 */
export function saveDefaultSettings(settings: BankSettings): void {
  try {
    updateGeneralConfig({ defaultSettings: sanitizeBankSettings(settings) });
  } catch (e) {
    console.warn("Failed to save default settings:", e);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalizeMasteredMistakes(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};

  const result: Record<string, boolean> = {};
  for (const [id, hasEverMistaken] of Object.entries(value)) {
    if (typeof hasEverMistaken === "boolean") {
      result[id] = hasEverMistaken;
    }
  }
  return result;
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

export function shouldRequeueActivePoolItem(item: ActivePoolItem): boolean {
  const hasBeenShown = (item as { hasBeenShown?: boolean }).hasBeenShown;
  if (hasBeenShown !== undefined) return !hasBeenShown;

  // 兼容 hasBeenShown 字段出现前保存的状态：已经带进度的题保留，
  // 没有任何作答痕迹的新题可以回到 pending 后按当前设置重新入池。
  return item.consecutiveCorrect === 0 && !item.hasEverMistaken;
}

/** 创建默认的存储状态 */
function createDefaultStoredState(): StoredState {
  return {
    masteredIds: [],
    masteredMistakes: {},
    activePool: [],
    currentRound: 0,
    filterType: "all",
    settings: loadDefaultSettings(),
    ui: createDefaultUiPreferences(),
  };
}

function stateKey(hash: string): string {
  return STORAGE_PREFIX_STATE + hash;
}

/** 从 localStorage 加载指定 bank 的状态 */
export function loadStoredState(hash: string): StoredState {
  const defaultState = createDefaultStoredState();

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
        masteredMistakes: normalizeMasteredMistakes(
          parsedState.masteredMistakes,
        ),
        settings: sanitizeBankSettings(parsedState.settings, defaultState.settings),
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
    masteredMistakes: state.masteredMistakes,
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

/** 重置指定 bank 的进度（保留 filterType / settings / ui） */
export function resetStoredState(hash: string): StoredState {
  const previous = loadStoredState(hash);
  const defaultState = createDefaultStoredState();

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
  const questionIds = new Set(questions.map((q) => q.id));

  const cleanedActivePool = storedState.activePool.filter((item) =>
    questionIds.has(item.id),
  );
  const sourceMasteredMistakes = normalizeMasteredMistakes(
    storedState.masteredMistakes,
  );
  const cleanedMasteredMistakes: Record<string, boolean> = {};
  for (const id of storedState.masteredIds) {
    cleanedMasteredMistakes[id] = sourceMasteredMistakes[id] === true;
  }

  const cleanedState: StoredState = {
    ...storedState,
    masteredMistakes: cleanedMasteredMistakes,
    activePool: cleanedActivePool,
  };

  return {
    ...cleanedState,
    masteredMistakes: cleanedMasteredMistakes,
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
