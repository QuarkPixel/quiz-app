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
export type QuestionType =
  "judgment" | "single" | "multiple" | "blank" | "memory";

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
  /**
   * 同步合并用的修订戳（毫秒）。同一道题在两台设备上都被答过时，
   * `consecutiveCorrect` 取戳大的那一侧——`lastSelectedRound` 是本地计数器，
   * 跨设备不可比，不能拿它当并发更新的排序依据。
   * 老数据没有这个字段 ⇒ 按 `0` 处理。
   */
  rev?: number;
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
  /**
   * 这条进度最后一次被改动的时刻（毫秒）。**合并并发更新时唯一的排序依据**
   * （见 `src/lib/rev.ts`：没有它就只能拿 `level` 当替身，而 `level` 既不是时钟
   * 也不单调，会反复制造「复习完又被拽回到期」这一族 bug）。
   *
   * - 由 `MemorySession.writeProgress` 统一盖章（唯一收口）；
   * - 从云端拉回来 / 合并出来的那份**原样保留**，绝不重盖，否则永不收敛；
   * - 老数据没有这个字段 ⇒ 当作 `0`（早于任何带戳的改动）。
   */
  rev?: number;
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
 * 复习答错后这道卡在本轮要重新连对 N 次（见 `MemoryReviewSession.targets`）；
 * 连对次数就是
 * `BankSettings.correctStreakToMaster`，没有单独的设置项。
 */
export interface MemoryBankSettings {
  graduateLevel: number;
  roundTarget: number;
  /**
   * 每轮限定题数：开轮时挑一批卡（数量 = `roundTarget`）就把这一轮的题定死，
   * 学会一道**不再补**新题进来，这一批学完本轮就结束。
   *
   * 关掉（默认）是「每掌握一题就补一题」的老规矩：活动池始终是满的，
   * 于是刷到后面必然会碰见这一轮才第一次见到的新卡。打开之后「这次就刷这几道」
   * 才是确定的——固定下来的那批 id 就是 `MemoryLearningSession.round.cardIds`。
   */
  lockRoundPool: boolean;
}

/**
 * 一个学习日：`YYYYMMDD` 整数（见 `@/features/memory/day`）。
 *
 * 只由本地日历决定，和时区偏移无关；比较大小就是比较日期。
 * 与 `nextDue` 分工：这个回答「哪一天」，`nextDue` 回答「什么时候到期」。
 */
export type DayKey = number;

/**
 * 记忆模式「学习轮」的全部状态 —— **一轮就是这一个对象**。
 *
 * 以前一轮是六份字段拼的（目标 / 已掌握数 / 池子 / 池子暂存位 / 这一批是谁 /
 * 每道卡的轮内连对），彼此不知道对方，于是「结束本轮」要记得把五样一起清零、
 * 「学完一轮」要记得把目标收回……漏一样就是一个说不清的 bug（用户报的
 * 「设 5 题、学到第 3 题就结束」正是目标与池子对不上账）。
 *
 * 现在只留这一份，并保证三条不变式（构造 / 读盘时都成立，见
 * `@/features/memory/round`）：
 *
 *   1. `masteredIds ⊆ cardIds`
 *   2. `1 ≤ goal ≤ cardIds.length` —— 目标不会超过这一批真能学出来的数量
 *   3. 池子 = `cardIds - masteredIds`（`MemorySession.syncPoolToRound` 按它重建）
 *
 * 它现在住在 `MemoryLearningSession.round` 里，跟着整份学习会话一起同步：
 * 换设备时接着同一轮继续，不再「各挑各的批」。
 */
export interface MemoryRoundState {
  /** 本轮目标（开轮时按「设置」与「这一批有几道」取小，中途只降不升） */
  goal: number;
  /** 本轮这一批卡（顺序即挑选顺序；「每掌握一题就补一题」时会往后长） */
  cardIds: string[];
  /** 本轮已掌握的卡（一定是 `cardIds` 的子集） */
  masteredIds: string[];
}

/**
 * 学习会话：一轮学习 + 这一轮的队列 + 屏上那张卡。
 *
 * 一轮可以跨天（学到一半关掉，第二天接着学），所以 `day` 只记录开轮日，
 * **不是**过期依据；只有「学完一轮」或「结束本轮」才删掉这份记录。
 */
export interface MemoryLearningSession {
  /**
   * 这一轮的身份。两台设备同步时用它判断「是不是同一轮」：
   * 同一个 id 才按字段合并，不同 id 只能整轮取新的那一份。
   */
  id: string;
  /** 开轮时的学习日（只用于展示 / 诊断） */
  day: DayKey;
  /** 目标 / 这一批 / 已掌握 */
  round: MemoryRoundState;
  /** 还没出完的卡（队头 = 下一张） */
  queue: string[];
  /** 屏上那张卡（`null` = 还没出题） */
  currentId: string | null;
  /** 屏上那张卡是否已经答过（答案页）；恢复时据此决定要不要先结算 */
  answered: boolean;
  /** 合并用的修订戳 */
  rev: number;
}

/**
 * 当天的复习会话：队列 + 过关 / 碰过 + 连对目标 + 轮内连对。
 *
 * 它回答三件 `memory.progress` 回答不了的事：
 *   - 今天这一轮还剩哪些卡（`queue`）
 *   - 今天已经真正过关几道（`doneIds`，进度条分子）
 *   - 答错后每张卡还要连对几次、已经连对几次（`targets` / `streaks`）
 *
 * `day` 是过期依据：跨过凌晨 5 点后，昨天的**未完成部分**会并进今天的新记录
 * （见 `rolloverReviewSession`），不会整份丢掉。
 */
export interface MemoryReviewSession {
  day: DayKey;
  /** 还没过的卡（队头 = 下一张） */
  queue: string[];
  /** 屏上那张卡 */
  currentId: string | null;
  /** 屏上那张卡是否已经答过 */
  answered: boolean;
  /** 连对达标、真正过关的卡（进度条分子） */
  doneIds: string[];
  /** 今天答过的卡（含忘记 / 模糊；只用于「今天看过几张」这类统计） */
  touchedIds: string[];
  /** 未过关卡的连对目标（答错 / 模糊后提到 N） */
  targets: Record<string, number>;
  /** 本轮降级过的卡（完成时不推进掌握阶梯） */
  failed: string[];
  /** 本轮每张卡已经连对几次（复习轮内计数，不再写进 `progress.streak`） */
  streaks: Record<string, number>;
  /** 合并用的修订戳 */
  rev: number;
}

/** 记忆模式的两份会话记录；没有进行中的会话时整个字段不存在。 */
export interface MemorySessionsState {
  learning?: MemoryLearningSession;
  review?: MemoryReviewSession;
}

/** `StoredState.memory` 的结构。 */
export interface MemoryStoredState {
  progress: MemoryProgressMap;
  settings: MemoryBankSettings;
  /** 进行中的学习 / 复习会话；默认不存在，按需创建。 */
  sessions?: MemorySessionsState;
  /**
   * 最近一次「学完一轮」发生在哪个学习日。
   *
   * 首页据此把学习入口降一档颜色：今天已经学过一轮 → 按钮不再是加重色，
   * 但**仍然可以点**（点了就是加学一轮）。跨过凌晨 5 点自然失效，
   * 不需要额外清理（只做「是不是今天」的比较）。
   */
  learnedDay?: DayKey;
}

/**
 * 刷题模式的「屏上会话」——只回答一件事：**刷新 / 换设备之后屏上该是什么**。
 *
 * 它不是进度：连对、掌握、池子都在 `StoredState` 的顶层字段里。这里存的只是
 * 「停在哪一道、这一道答到哪一步」，所以要跟着同步（换设备接着答），但**不进
 * 进度备份**（`exportProgress` 只装长期进度）。
 *
 * 为什么判分页也要恢复：用户答完一道题、切个设备打开，看到的应该是同一道题的
 * 答案页，而不是被重新抽一道。代价是「视作正确」需要判分前快照，快照不落盘
 * （它是一整份 `RuntimeState`），所以恢复之后那个入口不再可用。
 */
export interface QuizSessionState {
  /** 屏上那道题的 id（一定在题库里；净化时校验） */
  currentId: string;
  /** 屏上是题干页（等作答）还是答案页（已判分） */
  phase: "asking" | "judged";
  /** `phase === "judged"` 时的对错；题干页无意义 */
  correct?: boolean;
  /** 作答草稿：答案页要显示「你选了什么」，所以必须一起存 */
  selectedAnswers: number[];
  blankAnswerInputs: string[];
  /** 选项乱序（每个位置对应的原题下标）；答案页按同一顺序展示才有意义 */
  optionOrder: number[];
  /** 上一道**真正出过**的题：加权选题要避开它（不落盘的话刷新就可能重复出） */
  lastAskedId?: string;
  rev: number;
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
   * 刷题模式的屏上会话（停在哪一道、答到哪一步）。首页 / 记忆模式题库不存在。
   *
   * 与 `memory.sessions` 同一套思路，只是刷题模式没有「轮」的概念，所以只有
   * 一条「屏上这道」的记录。
   */
  quizSession?: QuizSessionState;
  /**
   * 「重置进度」的修订戳。
   *
   * `masteredIds` 只涨不落（highWaterSet），所以一次重置在合并时会被另一台
   * 设备的旧值**复活**——这是以前就存在的取舍。现在重置会盖一个戳，合并时
   * 「戳更大的一侧」整段赢：比它旧的 `masteredIds` / `masteredMistakes` 不再
   * 参与并集，`activePool` 里比它旧的条目也丢掉。
   *
   * 代价（有意接受）：重置后在**另一台**设备上新掌握的题会被这一次覆盖丢掉
   * （`masteredIds` 没有逐条时间戳，分不出「重置前」和「重置后新增」）。
   * 重置是一条「清空一切」的强操作，这个取舍比「旧进度无限复活」好。
   */
  resetRev?: number;
  /**
   * 记忆模式的进度、设置与进行中的会话。刷题模式题库没有这个字段。
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
