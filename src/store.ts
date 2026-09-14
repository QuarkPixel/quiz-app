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
  MemoryProgressMap,
  MemoryStoredState,
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
import { normalizeMemoryState } from "./features/memory/normalize";
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

/** 净化「本轮已掌握几题」：非负整数，缺失/非法时返回 undefined。 */
function normalizeRoundMastered(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

function toNonNegativeInt(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue) || numberValue < 0) return 0;
  return Math.floor(numberValue);
}

/**
 * 净化记忆模式暂存的学习池。缺失 / 结构非法时返回 undefined，
 * 免得给刷题模式题库凭空加一个字段。
 */
function normalizeLearningPool(value: unknown): ActivePoolItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: ActivePoolItem[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    items.push({
      id: raw.id,
      consecutiveCorrect: toNonNegativeInt(raw.consecutiveCorrect),
      hasEverMistaken: raw.hasEverMistaken === true,
      hasBeenShown: raw.hasBeenShown === true,
      lastSelectedRound: toNonNegativeInt(raw.lastSelectedRound),
    });
  }
  return items;
}

/**
 * 丢掉记忆进度里题库中已不存在的题目（`activePool` / `learningPool` 是同一套约定），
 * 顺带清掉这些题的「本轮重新连对」待办。
 */
function cleanMemoryState(
  memory: MemoryStoredState | undefined,
  questionIds: ReadonlySet<string>,
): MemoryStoredState | undefined {
  if (!memory) return undefined;

  const progress: MemoryProgressMap = {};
  for (const [id, item] of Object.entries(memory.progress)) {
    if (questionIds.has(id)) progress[id] = item;
  }

  // 待办跟着进度走：题库里没有这道卡，就谈不上「本轮还要重新连对几次」
  const retry = memory.retry
    ? {
        ...memory.retry,
        targets: Object.fromEntries(
          Object.entries(memory.retry.targets).filter(([id]) =>
            questionIds.has(id),
          ),
        ),
      }
    : undefined;

  // 用展开而不是逐字段重建：`memory` 段以后再加字段时不会被这里悄悄抹掉
  return { ...memory, progress, retry };
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
        // 记忆模式的段只有在文件里真的存在时才保留；否则保持 undefined，
        // 免得刷题模式题库的状态里凭空多出一个空段。
        memory: normalizeMemoryState(parsedState.memory),
        // 记忆模式「本轮已掌握几题」：学到一半退出时要能续上
        roundMastered: normalizeRoundMastered(parsedState.roundMastered),
        roundGoal: normalizeRoundMastered(parsedState.roundGoal),
        // 记忆模式复习期间暂存的学习轮活动池
        learningPool: normalizeLearningPool(parsedState.learningPool),
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
  state: StoredState,
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
    // 记忆模式题库的状态：`saveState` 是唯一出口，必须原样带出去，
    // 否则刷题流的保存会把记忆进度抹掉（同一个 hash 键）。
    memory: state.memory,
    roundMastered: state.roundMastered,
    roundGoal: state.roundGoal,
    // 复习期间暂存的学习轮活动池（成员与顺序都要保住）
    learningPool: state.learningPool,
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
    memory: previous.memory,
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
    // 暂存的学习池同样要丢掉已经不在题库里的题
    learningPool: storedState.learningPool?.filter((item) =>
      questionIds.has(item.id),
    ),
    // 记忆进度同理：改了题库（题目被删 / id 变了）之后，旧进度条目既不该
    // 计入统计，也不该让导出直接报错——统一按「题库里没有这道卡」丢掉
    memory: cleanMemoryState(storedState.memory, questionIds),
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
