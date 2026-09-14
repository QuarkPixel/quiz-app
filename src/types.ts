/**
 * 类型定义
 */

/** 选项 */
export interface Option {
  text: string;
}

/**
 * 题型。
 *
 * - `judgment` / `single` / `multiple` / `blank`：刷题模式的四种题型
 * - `memory`：记忆模式的题型（只有题干和答案，用户自评「知道 / 忘记」）
 *
 * 记忆题型和另外四种走同一套注册表与 UI 机制（`src/quiz/types/`），
 * 所以 `QuestionArea` / `QuestionPreview` / `ReviewView` / 判分逻辑都能直接复用。
 * 只做刷题的地方用 `QuizQuestionType`（排除 `memory`）。
 */
export type QuestionType = "judgment" | "single" | "multiple" | "blank" | "memory";

/** 刷题模式的四种题型（不含记忆题型）。 */
export type QuizQuestionType = Exclude<QuestionType, "memory">;

/**
 * 题库模式。
 *
 * - `quiz`：刷题模式（名称不变，代码 `quiz` 不变）。题目带 type / options / answer，
 *   参与间隔重复算法。
 * - `memory`：记忆模式。题目是 `type: "memory"` 的记忆卡片，用户自评「知道 /
 *   忘记」，按 1/2/4/8… 天的翻倍曲线复习，走完掌握阈值后不再出现。
 *   实现见 `src/features/memory/` 与 AGENTS.md 的「记忆模式（memory）」章节。
 */
export type BankMode = "quiz" | "memory";

/** 新题入池顺序 */
export type QuestionOrder = "random" | "sequential";

/**
 * 题目。刷题模式与记忆模式共用这一个结构：
 * 记忆卡片是「没有 options、answer 恒为字符串」的特例。
 */
export interface Question {
  id: string;
  type: QuestionType;
  question: string;
  options?: Option[];
  answer: boolean | number[] | string | string[];
}

/**
 * 记忆模式的题目。
 *
 * 只比通用 `Question` 多一层类型收窄：`type` 固定 `"memory"`、`answer` 固定字符串。
 * 这样消费记忆题目的代码（总览、会话）不用到处断言，也能直接塞进 QuestionPreview。
 */
export interface MemoryQuestion extends Question {
  type: "memory";
  answer: string;
}

/** 各题库模式对应的题目类型映射。 */
export interface BankQuestionMap {
  quiz: Question;
  memory: MemoryQuestion;
}

/** 取出某种模式下的题目类型。 */
export type BankQuestionOf<M extends BankMode> = BankQuestionMap[M];

/** 任意一种模式的题目。 */
export type BankQuestion = BankQuestionMap[BankMode];

/** 活动池中的题目 */
export interface ActivePoolItem {
  id: string;
  /** 连续答对次数 */
  consecutiveCorrect: number;
  /** 是否曾经答错过 */
  hasEverMistaken: boolean;
  /** 是否已经真正展示给用户 */
  hasBeenShown: boolean;
  /** 上次被选中的轮次 */
  lastSelectedRound: number;
}

/**
 * 全局偏好：跨题库共享，与具体题库无关。
 * 存于 general 配置（`quiz_app_general`）的 `globalSettings`。
 */
export interface GlobalSettings {
  /** 是否启用音效 */
  soundEnabled: boolean;
  /** 单选 / 判断题选择答案后是否自动提交 */
  autoSubmitOnSelection: boolean;
  /** 答题正确时自动下一题 */
  autoNextOnCorrect: boolean;
}

/**
 * 按题库的学习设置。
 * 存于每个题库的 `StoredState.settings`；新题库的初始值来自
 * general 配置里的 `defaultSettings`。
 */
export interface BankSettings {
  /** 活动题目池大小 */
  activePoolSize: number;
  /** 首次掌握所需连续正确次数 */
  correctStreakToMaster: number;
  /** 答错后掌握所需连续正确次数 */
  correctStreakAfterMistake: number;
  /** 新题入池模式：random=随机入池，sequential=按题库顺序入池 */
  selectionMode: QuestionOrder;
  /** 新题进入活动池后，在下一步前插入一次题目预览（适合初次了解题库） */
  notifyNewQuestionInPool: boolean;
}

/** UI 偏好（按 bank 持久化，但和「学习算法」分开） */
export interface UiPreferences {
  /** 进度条是否聚焦学习中部分 */
  progressFocused: boolean;
  /** 活动池面板是否展开 */
  showPool: boolean;
}

// ── 记忆模式（memory） ─────────────────────────────────────────────────────────
//
// 记忆模式的进度和刷题模式共用同一个 `StoredState` 对象（同一个
// `quiz_app_state_<hash>` 键），放在可选的 `memory` 段里；题库是 quiz 时这段为空。
// 存储刻意保持精简：每道题只留 5 个字段，其余状态都由这 5 个字段推导。

/**
 * 一道题在记忆模式里的持久化状态。
 *
 * - 没有这个条目 = 未学习
 * - `state: "learning"` = 学习中（`streak` 是已经连续答对几次）
 * - `state: "reviewing"` = 复习中（`level` 是复习阶梯，`nextDue` 是下次到期日）
 * - `state: "mastered"` = 已掌握，之后不会再出现
 */
export interface MemoryProgress {
  state: "learning" | "reviewing" | "mastered";
  /**
   * 复习阶梯，从 1 开始。第 `level` 次复习安排的间隔 = 2^(level-1) 天
   * （1、2、4、8、16…）。`learning` / `mastered` 时为 0。
   */
  level: number;
  /** 学习中的连续答对次数；进入复习后归 0 */
  streak: number;
  /** 下次复习到期日（本地当天 0 点的毫秒时间戳）；非复习中为 0 */
  nextDue: number;
  /** 累计答错次数（`忘记` / `记错了`），仅用于统计 */
  lapses: number;
}

/** 按题目 id 索引的记忆进度表。 */
export type MemoryProgressMap = Record<string, MemoryProgress>;

/**
 * 记忆模式特有的按题库设置（复习阶梯那一套）。
 *
 * 「连对几次算学会 / 学习顺序」直接复用刷题模式的 `BankSettings`
 *（`correctStreakToMaster` / `selectionMode`）。学习池大小与本轮目标共用
 * `roundTarget`，不再单独使用 `activePoolSize`。
 *
 * - `graduateLevel`：复习到第几级算已掌握；对应天数由 `2^(level-1)` 累加得出
 * - `roundTarget`：一轮学习要掌握几题才算这一轮结束（默认 5）
 *
 * 复习答错后这道卡在本轮要重新连对 N 次（见 `MemoryRetryState`）；连对次数就是
 * `BankSettings.correctStreakToMaster`，没有单独的设置项。
 */
export interface MemoryBankSettings {
  graduateLevel: number;
  roundTarget: number;
}

/**
 * 「答错后本轮必须重新连对 N 次」的待办。
 *
 * 复习答错时这道卡的复习阶梯已经归零（`level = 1`、明天到期），但本轮还得
 * 连对 N 次才算复习完。这件事要跨会话成立——中途按 Esc / 刷新 / 切题库回来时，
 * 只按「今天到期的卡」重建队列的话，这个要求会被静默丢掉。
 *
 * - `day`：这批要求属于哪个学习日（`studyDay` 锚点）。跨过凌晨 5 点就作废，
 *   卡片按「明天重来」的常规路径走，不会把昨天的要求带到今天
 * - `targets`：题目 id → 本轮还要连对几次
 *
 * 轮内连对次数本身不落盘（复习中的卡重新载入时 `streak` 归 0），所以重新进入
 * 复习时是「从 0 开始连对 N 次」。
 */
export interface MemoryRetryState {
  day: number;
  targets: Record<string, number>;
}

/** `StoredState.memory` 的结构。 */
export interface MemoryStoredState {
  progress: MemoryProgressMap;
  settings: MemoryBankSettings;
  /** 本轮还没补完的「重新连对」要求；没有待办时不存在 */
  retry?: MemoryRetryState;
  /**
   * 最近一次「学完一轮」发生在哪个学习日（`studyDay` 锚点）。
   *
   * 首页据此把学习入口降一档颜色：今天已经学过一轮 → 按钮不再是加重色，
   * 但**仍然可以点**（点了就是加学一轮）。跨过凌晨 5 点自然失效，
   * 不需要额外清理（和 `retry.day` 一样只做「是不是今天」的比较）。
   */
  learnedDay?: number;
}

/** 持久化存储的状态 */
export interface StoredState {
  /** 已掌握的题目 ID */
  masteredIds: string[];
  /**
   * 已掌握题目的错误记录。key 为题目 ID，value=true 表示掌握前曾答错。
   *
   * 旧版进度没有这个字段；缺失时按 false 处理。
   */
  masteredMistakes?: Record<string, boolean>;
  /** 活动题目池 */
  activePool: ActivePoolItem[];
  /** 当前轮次 */
  currentRound: number;
  /** 题型筛选 */
  filterType: QuestionType | "all";
  /** 用户设置（学习算法相关，按题库） */
  settings: BankSettings;
  /** UI 偏好（不影响学习算法） */
  ui: UiPreferences;
  /**
   * 记忆模式「本轮学习」已经掌握了几题。
   * 学到一半退出时可以续着这一轮继续（配合 `activePool`）。
   */
  roundMastered?: number;
  /** 本轮的目标题数（开始时定下，中途改设置不影响本轮） */
  roundGoal?: number;
  /**
   * 记忆模式「学习轮」的活动池。
   *
   * 复习轮要拿 `activePool` 当到期队列用，所以进复习之前把学习轮的池子
   * 原样挪到这里（成员和顺序都不动），复习结束后再放回 `activePool`。
   * 只有记忆模式题库、且「学到一半去复习」时才有这个字段。
   */
  learningPool?: ActivePoolItem[];
  /**
   * 记忆模式的进度与设置。刷题模式题库没有这个字段。
   *
   * 放在同一个 StoredState 里是为了少一个存储键：`StoredState` 本身是
   * mode-agnostic 的容器，两种模式互不读对方的段。
   */
  memory?: MemoryStoredState;
}

/** 运行时状态（包含计算出的待学习题目） */
export interface RuntimeState extends StoredState {
  masteredMistakes: Record<string, boolean>;
  /** 待学习的题目（运行时计算，不存储） */
  pendingIds: string[];
}

/** 统计信息 */
export interface Stats {
  /** 已掌握题目数 */
  mastered: number;
  /** 学习中题目数（活动池中） */
  learning: number;
  /** 待学习题目数 */
  pending: number;
  /** 总题目数 */
  total: number;
}
