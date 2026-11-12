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
  MemoryLearningSession,
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
import {
  migrateLegacyMemoryRound,
  memoryRoundRemaining,
  normalizeMemoryRound,
} from "./features/memory/round";
import {
  normalizeMemoryState,
} from "./features/memory/normalize";
import {
  createLearningSession,
  pruneLearningSession,
  pruneReviewSession,
} from "./features/memory/session";
import { sanitizeMemorySettings } from "./features/memory/settings";
import { normalizeQuizSession } from "./quiz/session/quizSession";
import { nextRev } from "./lib/rev";
import { subscribeStorageWrite } from "./lib/storageBus";
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
    rev: 0,
  };
}

export function shouldRequeueActivePoolItem(item: ActivePoolItem): boolean {
  const hasBeenShown = (item as { hasBeenShown?: boolean }).hasBeenShown;
  if (hasBeenShown !== undefined) return !hasBeenShown;

  // 兼容 hasBeenShown 字段出现前保存的状态：已经带进度的题保留，
  // 没有任何作答痕迹的新题可以回到 pending 后按当前设置重新入池。
  return item.consecutiveCorrect === 0 && !item.hasEverMistaken;
}

/**
 * 创建一个「空」的存储状态。
 *
 * 默认值只有这一处：以前 `MemorySession` 里还有一份手抄的（字段一样、默认设置
 * 取值不同），加字段时两边就得记得一起改。现在统一从这里取。
 */
export function createEmptyStoredState(
  settings: BankSettings = loadDefaultSettings(),
): StoredState {
  return {
    masteredIds: [],
    masteredMistakes: {},
    activePool: [],
    currentRound: 0,
    filterType: "all",
    settings,
    ui: createDefaultUiPreferences(),
  };
}

/** 创建默认的存储状态 */
function createDefaultStoredState(): StoredState {
  return createEmptyStoredState();
}

/**
 * 从落盘的旧字段里取 id 列表。
 *
 * 旧版有两种形状：`roundPoolIds` 是 `string[]`，`activePool` / `learningPool` 是
 * `{ id, ... }[]`。两种都认，省得判据里漏掉一种（漏了就等于「这一批是谁」没读到）。
 */
function poolIdsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      return isRecord(item) && typeof item.id === "string" ? item.id : null;
    })
    .filter((id): id is string => id !== null);
}

/**
 * 读盘时把「学习轮」收成一份学习会话。
 *
 * 新数据直接读 `memory.sessions.learning`；旧版本把这一轮拆成
 * `roundMastered` / `roundGoal` / `roundPoolIds`（复习期间还多一个
 * `learningPool`），走 `migrateLegacyMemoryRound` 拼回来（近似：旧数据没记
 * 哪几道已掌握，进度从 0 重新数，但**目标会收敛到这一批的数量**）。
 *
 * **先判断旧数据里到底有没有一轮**：只有记忆模式会写 `roundGoal` /
 * `roundPoolIds` / `learningPool`，而 `activePool` 刷题模式也有——拿它当判据
 * 的话，任何一个刷题题库都会凭空多出一轮。
 */
function normalizeStoredLearningSession(
  parsed: Record<string, unknown>,
): MemoryLearningSession | undefined {
  const round = normalizeMemoryRound(parsed.round);
  if (round) {
    return createLearningSession({
      round,
      queue: memoryRoundRemaining(round),
      day: 0,
      rev: 0,
      id: `legacy:${round.cardIds.join(",")}`,
    });
  }
  if (parsed.round !== undefined) return undefined;

  const legacyGoal =
    typeof parsed.roundGoal === "number" && Number.isFinite(parsed.roundGoal)
      ? parsed.roundGoal
      : 0;
  const legacyPoolIds = poolIdsOf(parsed.roundPoolIds);
  const legacyLearningPoolIds = poolIdsOf(parsed.learningPool);
  // `roundGoal` 为 0 是「上一轮已经收尾」，不算进行中的一轮
  if (
    legacyGoal <= 0 &&
    legacyPoolIds.length === 0 &&
    legacyLearningPoolIds.length === 0
  ) {
    return undefined;
  }

  const migrated = migrateLegacyMemoryRound({
    roundGoal: parsed.roundGoal,
    roundPoolIds: parsed.roundPoolIds,
    // 复习期间池子暂存在 `learningPool` 里（`activePool` 那时是到期队列），
    // 它是旧版里最接近「这一轮这一批」的那一份，优先级最高
    learningPoolIds: legacyLearningPoolIds,
    activePoolIds: poolIdsOf(parsed.activePool),
  });
  if (!migrated) return undefined;
  return createLearningSession({
    round: migrated,
    queue: memoryRoundRemaining(migrated),
    day: 0,
    rev: 0,
    id: `legacy:${migrated.cardIds.join(",")}`,
  });
}

/**
 * 丢掉记忆进度与会话里题库中已不存在的题目。
 *
 * 会话里的队列 / 过关集合 / 待办都跟着题目走：题被删 / id 改了之后，
 * 留在队列里只会让这一轮少几道卡，甚至永远走不完。
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

  const sessions = memory.sessions
    ? {
        learning: pruneLearningSession(memory.sessions.learning, questionIds),
        review: memory.sessions.review
          ? pruneReviewSession(memory.sessions.review, questionIds)
          : undefined,
      }
    : undefined;
  const hasSessions = Boolean(sessions?.learning || sessions?.review);

  // `retry` / `review` 是**旧版字段**（已经迁进 `sessions.review`）。这里必须
  // 显式剔掉：`{ ...memory }` 会把它们原样带下去，于是「题库里删了一道题」
  // 之后那道题的待办仍然挂在盘上，同步一次还可能被旧快照复活。
  //
  // 类型上这两个字段已经不存在，但盘上的老数据仍然带着它们，所以只能按
  // 「任意键」删。
  const rest: Record<string, unknown> = { ...memory };
  delete rest.retry;
  delete rest.review;

  // 用展开而不是逐字段重建：`memory` 段以后再加字段时不会被这里悄悄抹掉
  return {
    ...rest,
    progress,
    sessions: hasSessions ? sessions : undefined,
  } as MemoryStoredState;
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
      const memoryBase = normalizeMemoryState(parsedState.memory);
      // 旧版本的「学习轮」是顶层 `round` / `roundGoal` / `roundPoolIds`：
      // 读盘时一次性搬进 `memory.sessions.learning`，之后只认会话这一份。
      const migratedLearning = normalizeStoredLearningSession(
        parsed as Record<string, unknown>,
      );
      const memory =
        migratedLearning === undefined
          ? memoryBase
          : {
              ...(memoryBase ?? {
                progress: {},
                settings: sanitizeMemorySettings(undefined),
              }),
              sessions: {
                ...(memoryBase?.sessions ?? {}),
                learning: memoryBase?.sessions?.learning ?? migratedLearning,
              },
            };
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
        memory,
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
/**
 * `saveState` 落盘的那一份（**逐字段**，不是整份 `state`）。
 *
 * 为什么不是整个对象丢进去：`StoredState` 里有些字段是**运行期才有的**、
 * 不该进 localStorage（历史上 `pendingIds` 就吃过这个亏）。
 *
 * ⚠️ 加 `StoredState` 字段时**必须同时加到这里**，否则那个字段永远存不进去
 * ——功能看起来好好的，刷新之后才没，而且不会有任何报错。
 * 下面有一条**编译期护栏**（`STORED_STATE_COVERAGE`）替你盯着这件事。
 */
function persistedState(state: StoredState): StoredState {
  return {
    masteredIds: state.masteredIds,
    masteredMistakes: state.masteredMistakes,
    activePool: state.activePool,
    currentRound: state.currentRound,
    filterType: state.filterType,
    settings: state.settings,
    ui: state.ui,
    // 刷题模式的屏上会话：刷新 / 换设备后要回到同一道题
    quizSession: state.quizSession,
    // 重置的墓碑戳：没有它，「重置」在另一台设备上会被旧进度反手盖回来
    resetRev: state.resetRev,
    // 记忆模式题库的状态：`saveState` 是唯一出口，必须原样带出去，
    // 否则刷题流的保存会把记忆进度抹掉（同一个 hash 键）。
    memory: state.memory,
  };
}

/**
 * 编译期护栏：`StoredState` 的每个字段都得被 `persistedState` 写出去。
 * 漏一个 → 这里的类型不成立 → `pnpm check` 直接不过。
 *
 * **必须放在 `src/` 里**：`tsconfig.json` 的 `include` 只有 `src/**`，
 * `tests/` 不参与类型检查（写在测试里等于没有护栏）。
 */
type Covered<T> = [T] extends [never] ? true : never;
type MissingFromPersist = Exclude<keyof StoredState, keyof ReturnType<typeof persistedState>>;
export const STORED_STATE_COVERAGE: Covered<MissingFromPersist> = true;

// ── 「盘上那份被外部改写了」的通知 ──────────────────────────────────────
//
// 两个会话（`MemorySession` / `QuizSession`）都是**内存快照**：构造时读一次盘，
// 之后只靠自己的 `save()` 单向下写。但盘上那份不只由它写——同步的拉取 / 合并
// 结果经 `features/sync/localwrite.ts` 的 `applyRemoteState` 直接落进
// localStorage。
//
// 这条订阅只是把存储键翻译成题库 hash；**广播本身在 `@/lib/storageBus`**，
// 消费方（会话、题库仓库、全局设置）都订阅那条总线。以前同步落盘后会整页
// `location.reload()`——那会把正在答题的会话直接打断，这里是它的替代。

/** 订阅「某个题库的 `StoredState` 被外部改写」；返回取消订阅的函数。 */
export function subscribeStoredStateWrite(
  listener: (hash: string) => void,
): () => void {
  return subscribeStorageWrite((key) => {
    if (!key.startsWith(STORAGE_PREFIX_STATE)) return;
    const hash = key.slice(STORAGE_PREFIX_STATE.length);
    if (hash.length > 0) listener(hash);
  });
}

export function saveState(
  hash: string,
  state: StoredState,
  options: SaveStateOptions = {},
): void {
  const toStore: StoredState = persistedState(state);
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
    // 重置是一条**会传播的删除**：盖一个戳，合并时让另一台设备的旧进度整段作废
    // （`masteredIds` 只涨不落，没有这个戳它会被旧值原样复活）
    resetRev: nextRev(previous.resetRev ?? 0),
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

/**
 * 一道题现在处于哪个阶段 —— **唯一判据**。
 *
 * 以前这个判断散在各处的 `masteredIds.includes()` / `activePool.some()` /
 * `pendingIds.includes()` 里，三份集合各写一遍；加一个新阶段、或者改一份集合的
 * 语义，就得把所有调用点找齐。现在只有这一处知道三份集合的关系。
 *
 * 三份集合本身不变：`masteredIds` / `activePool` 落盘，`pendingIds` 是
 * `computePendingIds` 按当前筛选算出来的**投影**（不入存，也不是第二份真相）。
 *
 * `"absent"` 的意思是「这道题不在任何一份里」：题库里没有它、或者被当前筛选
 * 排除了、或者它是一条脏数据。调用方按「看不见这道题」处理。
 */
export type QuestionStage = "mastered" | "active" | "pending" | "absent";

export function stageOf(
  state: Pick<RuntimeState, "masteredIds" | "activePool" | "pendingIds">,
  id: string,
): QuestionStage {
  if (state.masteredIds.includes(id)) return "mastered";
  if (state.activePool.some((item) => item.id === id)) return "active";
  if (state.pendingIds.includes(id)) return "pending";
  return "absent";
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
    // 屏上会话跟着题库走：题目被删 / id 改了之后，那条「停在这道题上」的记录
    // 就没意义了——留着会让 `initialize()` 找不到题、白白空转一次
    quizSession: normalizeQuizSession(storedState.quizSession, questionIds),
    // 记忆进度 / 会话同理：改了题库（题目被删 / id 变了）之后，旧条目既不该
    // 计入统计，也不该让导出直接报错——统一按「题库里没有这道卡」丢掉。
    // 会话里的队列、过关集合、待办都由 `cleanMemoryState` 一起收敛。
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
