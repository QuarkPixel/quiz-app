/**
 * MemorySession：记忆模式的会话层。
 *
 * 与刷题模式的 `QuizSession` 是同一套骨架：
 *   - 题目是标准 `Question`（`type: "memory"`，见 `src/quiz/types/memory/`）
 *   - 进度存在共享的 `RuntimeState` 里：`activePool` = 当前这批 / 到期队列，
 *     `masteredIds` = 已掌握（毕业），`memory.progress` = 每道题的复习阶梯
 *   - 按库设置复用 `BankSettings`（`correctStreakToMaster` = 连对次数、
 *     `selectionMode` = 顺序 / 随机）；学习池大小与本轮目标共用
 *     `MemoryBankSettings.roundTarget`，不再单独配置活动池大小，
 *     记忆模式自己的复习阶梯设置放在 `state.memory.settings`（MemoryBankSettings）
 *
 * 这样一来 `ProgressBar` / `QuestionArea` / `StreakIndicator` / `ReviewView`
 * 这些刷题模式的 UI 都能直接套用，只有「对错」的含义不同：
 *   - 学习流：知道 = 对，忘记 = 错（连对到门槛就毕业进入复习）
 *   - 复习流：知道 = 对，忘记 = 错（对 → 阶梯 +1，错 → 阶梯归零）
 *
 * ── 三份状态，各有各的主人 ──────────────────────────────────────────────────
 *
 * 这个类里有三种生命周期完全不同的状态，以前它们都是平行的字段，谁也说不清
 * 哪个该跟谁一起清：
 *
 *   1. **题库级（落盘）**：`appState`（进度 / 设置 / 活动池）+ `round`
 *      （学习轮：目标、这一批、已掌握）。退出会话、去复习、刷新页面都留着。
 *   2. **会话级（`this.flow`）**：正在跑哪一档、队列、屏上那张卡与它的作答阶段。
 *      见 `@/features/memory/flow`——**所有转移都走那里的纯函数**，
 *      对外只留只读 getter（`run` / `currentQuestion` / `showResult` / …）。
 *   3. **表单级**：`selectedAnswers`（用户刚点的自评）。换卡时清空。
 *
 * 复习轮的记账（进度条两个数、本轮连对目标、本轮降级过谁）长在 `flow` 的
 * 「复习」这一支上——它们只在复习时有意义，不再是一堆平时恒为空、
 * 复习时才有人读的平行字段。
 *
 * ── 「一轮」只有一份真相 ────────────────────────────────────────────────────
 *
 * 学习轮的全部状态装在 `this.round`（`MemoryRoundState`）里：目标、这一批、
 * 已掌握。**池子不再是第二份真相**——`activePool` 由 `syncPoolToRound()` 从
 * `round.cardIds - round.masteredIds` 重建（复习轮借用 `activePool` 当到期队列，
 * 回到学习时重建一次就恢复，不再需要 `learningPool` 那个暂存位）。
 *
 * 于是「结束本轮」「学完一轮」「开新一轮」「题库被改」都只做一件事：
 * **动这个对象**（或者把它清成 `null`）。没有第二、第三份计数需要同步清零，
 * 也就没有「漏清一个字段 → 下一轮学到一半突然结束」这种 bug 的土壤。
 * 模型的规矩（目标 ≤ 这一批的数量等）见 `@/features/memory/round`。
 */

import type {
  DayKey,
  MemoryBankSettings,
  MemoryLearningSession,
  MemoryProgress,
  MemoryProgressMap,
  MemoryQuestion,
  MemoryReviewSession,
  MemoryRoundState,
  MemorySessionsState,
  MemoryStoredState,
  Question,
  RuntimeState,
  StoredState,
} from "@/types";
import type { MemoryBank } from "@/source/types";
import {
  advanceReview,
  createLearningProgress,
  createReviewProgress,
  fuzzyReview,
  memoryIntervalDays,
  resetReview,
} from "@/features/memory/algorithm";
import { dayKeyOf } from "@/features/memory/day";
import {
  addMemoryRoundCards,
  createMemoryRound,
  isMemoryRoundComplete,
  markMemoryRoundMastered,
  memoryRoundRemaining,
  pruneMemoryRound,
} from "@/features/memory/round";
import {
  IDLE_FLOW,
  addFailed,
  addReviewed,
  addTouched,
  answerCard,
  appendQueue,
  cardIdOf,
  clearReviewStreak,
  clearReviewTarget,
  dropFromQueue,
  dropQueueHead,
  finishRun,
  isAnswered,
  queueOf,
  patchReview,
  ratingOf,
  reAnswer,
  removeFailed,
  replaceQueue,
  retainInQueue,
  reviewOf,
  rotateQueue,
  runKindOf,
  setReviewStreak,
  setReviewTarget,
  showCard,
  startLearning as beginLearningRun,
  startReview as beginReviewRun,
  correctnessOf,
  type MemoryFlow,
  type MemoryRun,
} from "@/features/memory/flow";
import {
  buildLearningSessionOf,
  buildReviewSessionOf,
  buildSessions,
  loadMemoryState,
  memorySectionOf,
  withProgress,
  withSyncedMasteredIds,
} from "@/features/memory/sessionStore";
import {
  dueCountOf,
  hasOngoingRoundOf,
  isLearnableOf,
  learnableCountOf,
  learnedTodayOf,
  learningCountOf,
  masteredCountOf,
  newCountOf,
  nextBatchSizeOf,
  pendingRetryCountOf,
  reviewQueueTodayOf,
  reviewableCountOf,
  reviewedTodayOf,
  reviewingCountOf,
  roundMasteredOf,
  targetPerRoundOf,
  touchedTodayOf,
  type MemoryQueryInput,
} from "@/features/memory/sessionQueries";
import { nextRev } from "@/lib/rev";
import { debugLog, sessionSummary } from "@/lib/debug";
import {
  createReviewSession,
  createSessionId,
  mergeSessions,
} from "@/features/memory/session";
import {
  devAddDay,
  devDayOffset,
  devNow,
  devResetDays,
} from "@/features/memory/devClock";
import {
  createDefaultMemorySettings,
  sanitizeMemorySettings,
} from "@/features/memory/settings";
import {
  GlobalSettingsStore,
  globalSettingsStore,
} from "@/features/globalSettings.svelte";
import type {
  CopyQuestionOptions,
  CopyQuestionResult,
} from "@/quiz/session/types";
import {
  ProgressSessionBase,
  type SessionDeps,
} from "@/quiz/session/ProgressSessionBase.svelte";
import {
  buildRuntimeState,
  createEmptyStoredState,
  loadStoredState,
  saveState,
} from "@/store";
import {
  createDefaultBankSettings,
  sanitizeBankSettings,
} from "@/bankSettings";
import { STORAGE_PREFIX_QUESTIONS } from "@/config";
import { QUESTION_TYPES } from "@/quiz/types/registry";
import {
  memoryAnswerKind,
  MEMORY_ANSWER_CODE,
  type MemoryAnswerKind,
} from "@/quiz/types/memory/logic";
import {
  QuestionCopyPattern,
  type QuestionCopyContext,
} from "@/quiz/types/types";
import { appSound } from "@/sound";
import { shuffle } from "@/features/quiz";

export type MemoryRunKind = MemoryRun["kind"];

/** 两个模式共用的 deps 形状，保留旧名字方便调用方按模式引用。 */
export type MemorySessionDeps = SessionDeps;

export class MemorySession extends ProgressSessionBase {
  readonly bank: MemoryBank;
  readonly questions: MemoryQuestion[];

  /**
   * 会话流（首页 / 学习 / 复习 + 屏上那张卡）。
   *
   * 唯一的写入口是 `@/features/memory/flow` 里那几个纯函数；这里对外只暴露
   * 只读投影（`run` / `currentQuestion` / `showResult` / `answerKind` / …）。
   */
  private flow: MemoryFlow = $state(IDLE_FLOW);
  /**
   * 出题序号：每次 `selectNext()` 都 +1。
   *
   * 题干字号的过渡要按「一次出题」而不是「一道卡」来分界：同一道卡被排回队尾
   * 再次出现时（答错后重来、池子里只有一两道卡）它仍然是新的一次展示，不该
   * 从答案页的小字号动画回大字号。UI 用它做 `{#key}`。
   */
  presentationSeq = $state(0);
  /**
   * 当前的学习轮（`null` = 没有进行中的一轮）。
   *
   * **本轮的唯一真相**：目标、这一批、已掌握都在这里，池子是它的投影。
   * 它跟着 `memory.sessions.learning` 一起落盘 / 同步，学到一半退出、
   * 刷新、换设备都能续上；「结束本轮」= 置 `null` 并删掉会话。
   *
   * 它**不在 `flow` 里**：学习轮是题库级状态，去复习时也留着（回到学习要接着学）。
   */
  round: MemoryRoundState | null = $state(null);
  /** 用户刚点的自评（表单草稿；换卡时清空）。 */
  selectedAnswers: number[] = $state([]);
  /** 临时调试：当前快进的天数（响应式，供 UI 与 now() 使用） */
  debugOffset = $state(0);

  /** 会话时钟：每分钟 +1，让 `now` 的 getter 建立响应式依赖（跨 5 点自动刷新）。 */
  private clockTick = $state(0);

  /**
   * 正在从盘上重读（`reloadFromStorage`）。
   *
   * 重读过程中会调 `selectNext()` 之类「本来要落盘」的动作，但那一刻内存还没有
   * 稳定下来——此时 `save()` 会把半成品写回盘上，甚至盖掉刚同步下来的合并结果。
   * 所以重读期间**一律不写**：盘上那份就是刚刚写进来的，不需要再写一遍。
   */
  private isReloading = false;

  /**
   * 已经落盘的两份会话。
   *
   * **必须响应式**：进度条的分子分母（`reviewedIds` / `reviewTotal`）直接读它，
   * 而「盘上那份被同步改写」这条路径不会碰 `appState` 里的其它字段——不响应式的话
   * 数字变了界面也不重算（这正是「手机上 1 / 10、电脑上还是 0 / 9」的一半原因）。
   */
  private savedSessions = $state<MemorySessionsState | undefined>(undefined);

  /** 学习会话的身份 / 开轮日 / 修订戳（跨 save 保留，不能每次重新生成）。 */
  private learningSessionId = "";
  private learningSessionDay: DayKey = 0;
  private learningSessionRev = 0;

  /** 今天这份复习会话属于哪个学习日（null = 还没有）。 */
  private reviewSessionDay: DayKey | null = null;
  private reviewSessionRev = 0;

  appState: RuntimeState = $state(buildRuntimeState([], createEmptyState()));

  private readonly hash: string;
  /**
   * 固定时间源（只有测试会传）。
   *
   * 生产环境不设置它：`now` getter 每次都现算 `Date.now() + debugOffset`，
   * 这样调试里「加一天」能立刻对已挂载的会话生效。之前把偏移捕获进闭包，
   * 导致加天数对当前会话无效（总览里的「N 天后复习」永远不变）。
   */
  private readonly fixedNow: (() => number) | null = null;

  constructor(
    bank: MemoryBank,
    deps: MemorySessionDeps,
    globalSettingsRef: GlobalSettingsStore = globalSettingsStore,
    options: { now?: () => number } = {},
  ) {
    super(deps, globalSettingsRef);
    this.bank = bank;
    this.hash = bank.hash;
    this.questions = bank.questions;
    this.debugOffset = devDayOffset();
    this.fixedNow = options.now ?? null;
    const stored = loadStoredState(bank.hash);
    this.appState = this.loadState(stored);
    this.savedSessions = this.appState.memory?.sessions;
    // 进行中的一轮（如果有）：目标 / 这一批 / 已掌握整份读回来
    this.round = this.savedSessions?.learning?.round ?? null;
    this.learningSessionId = this.savedSessions?.learning?.id ?? "";
    this.learningSessionDay = this.savedSessions?.learning?.day ?? 0;
    this.learningSessionRev = this.savedSessions?.learning?.rev ?? 0;
    this.reviewSessionDay = this.savedSessions?.review?.day ?? null;
    this.reviewSessionRev = this.savedSessions?.review?.rev ?? 0;
    this.normalizeQuestionTypes();
  }

  /**
   * 会话时钟心跳。UI 每分钟调一次（`MemoryView` 里的 interval），
   * 让 `now` 这个 getter 重新求值——页面一直开着跨过凌晨 5 点时，
   * 首页的「今日待复习 / 今天学过」不能停在昨天。
   */
  refreshClock(): void {
    this.clockTick += 1;
  }

  /**
   * 盘上那份被**外部**改写了（同步拉取 / 合并）→ 重新读回来。
   *
   * 会话是内存快照：构造之后只由自己的 `save()` 单向下写。可盘上那份还有第二个
   * 写入方——同步的 `applyRemoteState`。它写完不重读，就会出现「手机上已经
   * 1 / 10，电脑上还是 0 / 9」；更糟的是再接一次 `save()` 会把旧会话盖回去，
   * 于是下一次同步把 0 / 9 传到云端，两台设备一起错。
   *
   * 规则：
   *   - `run === "idle"` → 完全以盘上为准（没有进行中的一轮，内存里没有额外信息）；
   *   - 正在跑一轮 → 盘上那份与内存**合并**（`mergeSessions`），队列保留本机顺序，
   *     远端新过关的卡剔掉、新到期的补到队尾，屏上那道不跳。
   */
  reloadFromStorage(): void {
    if (this.isReloading) return;
    this.isReloading = true;
    try {
      const stored = loadStoredState(this.hash);
      const next = this.loadState(stored);
      const disk = next.memory?.sessions;
      const sessions =
        this.run === "idle" ? disk : mergeSessions(this.savedSessions, disk);
      // 记忆模式的 `activePool` 是**运行态**：盘上那份永远是空池子，
      // 同步写回的那份（合并结果）也恒为 `[]`。直接整份替换会把正在用的池子
      // 抹掉——学习轮因此丢掉轮内连对，复习轮因此把整条队列判成"不在池子里"。
      const runtimePool = this.appState.activePool;

      this.appState = next;
      this.savedSessions = sessions;
      this.round = sessions?.learning?.round ?? null;
      this.learningSessionId = sessions?.learning?.id ?? "";
      this.learningSessionDay = sessions?.learning?.day ?? 0;
      this.learningSessionRev = sessions?.learning?.rev ?? 0;
      this.reviewSessionDay = sessions?.review?.day ?? null;
      this.reviewSessionRev = sessions?.review?.rev ?? 0;

      if (this.run === "learning") {
        // 池子由**本轮**重建：成员跟着新的 `round` 走，连对计数沿用内存里那份。
        // 这一步同时把「合并后本轮已经学掉的卡」摘出去。
        this.appState = { ...this.appState, activePool: runtimePool };
        this.syncPoolToRound();
      }

      if (this.run === "reviewing") this.adoptReviewSession(sessions?.review);

      debugLog(
        "session:reload",
        `run=${this.run} disk:${sessionSummary({ memory: { sessions: disk } })}` +
          ` merged:${sessionSummary({ memory: { sessions } })}` +
          ` queue:${queueOf(this.flow).length}`,
      );
    } finally {
      this.isReloading = false;
    }
  }

  /**
   * 把合并后的复习会话并回正在跑的这一轮。
   *
   * 队列保留本机顺序（用户正在答的那一串不该因为一次同步跳位），远端新过关的卡
   * 从队列里剔掉、新到期的补到队尾；`doneIds` / `targets` / `streaks` 一律以合并
   * 结果为准——进度条的分子分母就是从这里读的。
   *
   * **远端那份队列只当顺序提示**：它可能来自旧版本 / 旧的一天，里面会留着已经
   * 推到未来的卡。只接受「今天这一批」里还有的 id，否则一次同步就能把队列撑大。
   */
  private adoptReviewSession(session: MemoryReviewSession | undefined): void {
    if (!session) return;

    const done = new Set(session.doneIds);
    const today = new Set(this.reviewQueueToday().map((q) => q.id));
    const queue = queueOf(this.flow).filter((id) => !done.has(id));
    for (const id of session.queue) {
      if (done.has(id) || !today.has(id) || queue.includes(id)) continue;
      queue.push(id);
    }

    // **只换记账，不动屏上那张卡**：用户正在答的那道题、已经选好的自评都不该
    // 因为一次同步跳一下。远端新过关的卡从队列里剔掉，新到期的补到队尾。
    this.flow = patchReview(this.flow, {
      target: { ...session.targets },
      reviewed: [...session.doneIds],
      touched: [...session.touchedIds],
      failed: [...session.failed],
      streaks: { ...session.streaks },
    });
    this.flow = replaceQueue(this.flow, queue);
  }

  // ── ProgressSessionBase 的四个挂钩 ──────────────────────────────────

  protected get sessionHash(): string {
    return this.hash;
  }

  protected get sessionQuestions(): readonly Question[] {
    return this.questions;
  }

  protected get sessionState(): RuntimeState {
    return this.appState;
  }

  // ── 会话流（只读投影） ──────────────────────────────────────────────

  /**
   * 只读查询的输入。
   *
   * 每次读都会碰到 `appState` / `flow` / `round` / `savedSessions`，所以函数内部
   * 怎么算都仍然在 Svelte 的依赖图里——投影搬到 `sessionQueries.ts` 之后，
   * 「盘上那份被同步改写 → 数字跟着变」这条链没有断。
   */
  private get query(): MemoryQueryInput {
    return {
      appState: this.appState,
      flow: this.flow,
      questions: this.questions,
      now: this.now,
      round: this.round,
      savedSessions: this.savedSessions,
    };
  }

  /** 当前会话：首页 / 学习 / 复习 */
  get run(): MemoryRunKind {
    return runKindOf(this.flow);
  }

  /** 本轮是否正在进行（首页为 false）。键盘层用它决定 Esc 是否生效。 */
  get isSessionActive(): boolean {
    return runKindOf(this.flow) !== "idle";
  }

  /**
   * 屏上有没有**用户已经投入过**的东西（同步要覆盖本地前的唯一判据）。
   *
   * 记忆模式的一轮本身就是"投入"：队列、当前卡、连对都在这份会话里，
   * 覆盖会把它换掉。首页（`idle`）则没有任何东西可丢，云端更新直接落地。
   */
  get hasWorkInProgress(): boolean {
    return this.run !== "idle";
  }

  /**
   * 屏上那张卡（首页 / 队列空时为 `null`）。
   *
   * **必须排在 `currentTypeDef` 前面**：`$derived` 字段按书写顺序初始化，
   * 反过来的话后者读前者会命中「used before its initialization」。
   */
  currentQuestion: Question | null = $derived(
    this.lookupQuestion(cardIdOf(this.flow)),
  );

  /** 当前这道卡的题型定义（题干区靠它选渲染分支）。 */
  currentTypeDef = $derived(
    this.currentQuestion ? QUESTION_TYPES[this.currentQuestion.type] : null,
  );

  /** 是否已经亮出答案。 */
  get showResult(): boolean {
    return isAnswered(this.flow);
  }

  /** 当前这道卡这一轮的自评结果（知道 / 模糊 / 忘记）；题干页恒为「知道」。 */
  get answerKind(): MemoryAnswerKind {
    return ratingOf(this.flow) ?? "know";
  }

  /** 最终判定（「知道 / 模糊」算没答错；「记错了」会把 isCorrect 翻回 false） */
  get isCorrect(): boolean {
    return correctnessOf(this.flow);
  }

  /**
   * 本轮「复习完成」还需要连对几次（key = 题 id）。
   * 默认 1（答对一次就完成本轮）；答错后提到 `correctStreakToMaster`（默认 3）。
   *
   * 只在复习时才有值——它长在会话流的「复习」那一支上，首页 / 学习时读它得到
   * 空对象，不会出现「上一轮复习的待办漏到这一轮」。
   */
  get reviewTarget(): Readonly<Record<string, number>> {
    return reviewOf(this.flow)?.target ?? EMPTY_REVIEW_TARGET;
  }

  /**
   * 复习：今天这一轮的总题数（进度条分母）。
   *
   * 分母 = **今天已过关的 + 今天还能复习的**（后者与首页 `reviewableCount`、
   * 「复习」入口的队列同一份判据）。答错补回来的卡本来就在这一批里，不会把它撑大；
   * 只有题库被改（卡没了）时才收敛。
   *
   * 跑着时读会话流（一轮之内分母稳定，中途退出 / 刷新 / 换设备都接着数）；
   * 回到首页后读盘上今天那份 + 今天到期的——**不读盘上 `queue` 的长度**，
   * 那份队列只是顺序提示，跨天时会留着已经推到未来的卡。
   */
  get reviewTotal(): number {
    return reviewedTodayOf(this.query).total;
  }

  /**
   * 复习：今天已经**过关**的题（连对达标；进度条靠它变绿）。
   *
   * 注意不是「答过」：答「忘记 / 模糊」的卡还在队列里，不算过关。
   * 答过的清单另有一份 `touchedIds`，只用于统计。
   */
  get reviewedIds(): readonly string[] {
    return reviewedTodayOf(this.query).reviewed;
  }

  /**
   * 「今天过了哪几道 / 一共几道」的实现在 `sessionQueries.reviewedTodayOf`：
   * 复习轮跑着时读会话流，退回首页后读盘上今天那份。
   */

  /**
   * 本轮复习里被降级过的题（「忘记」→ 阶梯归零；「模糊」→ 阶梯退一级）。
   *
   * 「这一轮完成」≠「掌握了」：降级说明没记住，阶梯已经被调低。
   * 所以本轮连对达标时，只要这道在本轮降级过，就**不允许**再推进阶梯，
   * 否则答错那道会和一次答对那道拿到同样的间隔（之前的 bug），
   * 「模糊」退掉的那一级也会立刻被加回来。
   */
  get failedThisRound(): readonly string[] {
    return reviewOf(this.flow)?.failed ?? EMPTY_IDS;
  }

  // ── 记忆模式自己的进度与设置 ────────────────────────────────────────

  /** 每道题的复习阶梯（来自 `appState.memory`） */
  progress = $derived<MemoryProgressMap>(
    this.appState.memory?.progress ?? {},
  );

  /** 记忆模式的按库设置（复习阶梯阈值等） */
  memorySettings = $derived<MemoryBankSettings>(
    this.appState.memory?.settings ?? createDefaultMemorySettings(),
  );

  /** 当前题的连对次数（UI 文案用；复习轮读会话里的 `streaks`） */
  get currentStreak(): number {
    if (this.run === "reviewing") return this.reviewStreak;
    return this.currentPoolItem?.consecutiveCorrect ?? 0;
  }

  /** 复习轮内当前题已经连对几次 */
  get reviewStreak(): number {
    const id = this.currentQuestion?.id;
    return id ? (reviewOf(this.flow)?.streaks[id] ?? 0) : 0;
  }

  /** 本轮每张卡已经连对几次（复习轮专用） */
  private get reviewStreaks(): Readonly<Record<string, number>> {
    return reviewOf(this.flow)?.streaks ?? EMPTY_REVIEW_TARGET;
  }

  /** 当前题在本轮的连对次数 */
  currentPoolItem = $derived(
    this.appState.activePool.find(
      (item) => item.id === this.currentQuestion?.id,
    ),
  );

  /**
   * 「连续正确次数」N。学习模式用它做学会门槛；
   * 复习模式只在答错之后用它作为「本轮复习完成」所需次数。
   */
  get streakToLearn(): number {
    return Math.max(1, this.appState.settings.correctStreakToMaster);
  }

  /** 当前卡片在 UI 上显示的连对需求（学习 = N；复习 = 本轮目标） */
  requiredStreak = $derived.by(() => {
    if (this.run !== "reviewing") return this.streakToLearn;
    const id = this.currentQuestion?.id;
    return id ? (this.reviewTarget[id] ?? 1) : 1;
  });

  // 这几个计数写成 getter：它们要读 constructor 里赋值的 this.questions，
  // 用 $derived 字段会被 TS 判成「used before initialization」。
  get newCount(): number {
    return newCountOf(this.query);
  }
  get reviewingCount(): number {
    return reviewingCountOf(this.query);
  }
  get learningCount(): number {
    return learningCountOf(this.query);
  }
  get masteredCount(): number {
    return masteredCountOf(this.query);
  }
  /** 今日到期待复习数量 */
  get dueCount(): number {
    return dueCountOf(this.query);
  }

  /**
   * 今天还没补完的「答错后重新连对」数量。
   *
   * 这些卡已经在答错时被推到明天（`nextDue` = 明天），所以不在 `dueCount` 里，
   * 但本轮还没完成——今天重新进复习时必须继续出现。
   */
  get pendingRetryCount(): number {
    return pendingRetryCountOf(this.query);
  }

  /**
   * 今天可以进入复习的卡片数：到期的 + 还没补完连对的。
   *
   * **直接数 `reviewQueueToday()` 的长度**，不再自己拼一遍「到期 + 待补」——
   * 首页这个数字与「复习」入口的队列必须是同一个判据，否则会出现
   * 「首页说还有 12 道，点进去却说今天没有需要复习的题目」（真踩过）。
   * 这里多算一次队列很便宜（题量级的一次 filter），换来的是两边不会各说各话。
   */
  get reviewableCount(): number {
    return reviewableCountOf(this.query);
  }

  /**
   * 当前时间（带调试用的天数偏移）。
   * UI 想算「还有几天到期」时必须用这个，不要直接 `Date.now()`——
   * 否则调试里「加一天」之后，界面上的天数不会跟着变。
   */
  get now(): number {
    // 订阅会话时钟：每跳一次，所有依赖「今天」的 derived 都会重算。
    // 不读这个字段的话，`Date.now()` 的变化不会进 Svelte 的依赖图。
    void this.clockTick;
    return this.fixedNow ? this.fixedNow() : devNow(this.debugOffset);
  }

  /**
   * 本轮学习目标（题）。
   *
   * 有进行中的一轮就用**那一轮的目标**（开轮时定下，中途改设置不影响它）；
   * 没有就用设置里的 `roundTarget`（首页「每轮 N 道」的文案）。
   */
  get targetPerRound(): number {
    return targetPerRoundOf(this.query);
  }

  /** 本轮已经掌握了几道（UI / 测试都用它，读的是轮模型） */
  get roundMastered(): number {
    return roundMasteredOf(this.query);
  }

  /** 本轮目标；没有进行中的一轮时是 0（`MemoryHome` 据此判断「是不是在续轮」） */
  get roundGoal(): number {
    return this.round?.goal ?? 0;
  }

  /** 本轮学习已完成多少 / 共多少（进度条用） */
  get roundCompletedCount(): number {
    return Math.min(this.roundMastered, this.targetPerRound);
  }

  /** 复习进度：今天已经复习了几道 */
  get reviewDoneCount(): number {
    return this.reviewedIds.length;
  }

  /**
   * 复习：今天**答过**几道（含「忘记 / 模糊」）。
   *
   * 与 `reviewDoneCount` 的区别是「碰过」和「过关」：进度条只认后者。
   * 这个数字只用于统计口径（「今天看过 12 张、过了 9 张」）。
   */
  get touchedCount(): number {
    return touchedTodayOf(this.query).length;
  }

  /** 首页「学习新的题目」这次会学几道 */
  get nextBatchSize(): number {
    return nextBatchSizeOf(this.query);
  }

  /**
   * 学到一半（这一轮还有没学完的卡），下次点「学习新的题目」接着这一轮继续。
   *
   * 判据是**轮模型里还剩几道能学的**，不是「池子里有没有条目」——池子只是轮的
   * 投影，复习期间它还被借去当到期队列了（以前用池子判断，于是「学完一轮后去
   * 复习」会让首页以为还有半轮）。
   */
  get hasOngoingRound(): boolean {
    return hasOngoingRoundOf(this.query);
  }

  /** 这道卡还能学吗（没学过，或者学到一半）。与 `poolCandidates` 同一份判据。 */
  private isLearnable(id: string): boolean {
    return isLearnableOf(this.query, id);
  }

  /**
   * 今天是否已经学完过一轮（`memory.learnedDay` 是不是今天）。
   *
   * 首页据此把「学习」按钮降一档颜色：今天学过一轮之后按钮不再是加重色，
   * 但仍然可以点（点了就是再学一轮）。跨过凌晨 5 点自然失效。
   * `learnedDay` 是 DayKey（YYYYMMDD），比较的是日期而不是绝对时刻。
   */
  get learnedToday(): boolean {
    return learnedTodayOf(this.query);
  }

  /** 「学习新的题目」还能学几道：没学过的 + 学到一半的 */
  get learnableCount(): number {
    return learnableCountOf(this.query);
  }

  private lookupQuestion(id: string | null): Question | null {
    if (id === null) return null;
    return this.questions.find((q) => q.id === id) ?? null;
  }

  /**
   * 给题库里的题目补上 `type: "memory"`。
   *
   * 记忆模式的题目本来就没有 type 字段，是解析时统一补成 "memory" 的；
   * 但重构之前存进 localStorage 的题库没有这一步，读出来 type 是 undefined，
   * `QUESTION_TYPES[undefined]` 会直接崩。这里兜一次底并把修正后的题库写回。
   */
  private normalizeQuestionTypes(): void {
    const missing = this.questions.some((q) => q.type !== "memory");
    if (!missing) return;
    const normalized = this.questions.map((q) => ({
      ...q,
      type: "memory" as const,
    }));
    // 原地改，保持 this.questions 的引用不变（它是 readonly）
    this.questions.splice(0, this.questions.length, ...normalized);
    this.appState = buildRuntimeState(this.questions, this.appState);
    try {
      localStorage.setItem(
        STORAGE_PREFIX_QUESTIONS + this.hash,
        JSON.stringify(normalized),
      );
    } catch {
      /* 写不进去就算了，内存里已经修好 */
    }
  }

  // ── 会话入口 ────────────────────────────────────────────────────────

  /**
   * 开始「学习新的题目」。
   *
   * 先看盘上有没有**这一轮**的学习会话：
   *   - 有（同一轮、还没学完）→ 接着打开：队列 / 当前题 / 已掌握原样恢复
   *   - 没有 → 开新的一轮：挑一批卡，目标取「设置」与「这一批有几道」的小值
   *
   * 会话默认不存在，只有开过一轮才会写；学完 / 结束本轮时删掉。
   */
  startLearning(): void {
    // 同 `startReview`：进入前以盘上为准，别拿构造时那份快照决定「有没有一轮可续」
    this.reloadFromStorage();
    const stored = this.savedSessions?.learning;
    const resumable =
      stored !== undefined &&
      this.round !== null &&
      stored.round.cardIds.join("\u0000") === this.round.cardIds.join("\u0000") &&
      this.hasOngoingRound;

    if (!resumable) {
      if (!this.hasOngoingRound) {
        // 旧的一轮（如果还有残留）作废：新的一轮就是新的一批、新的目标
        this.round = this.pickRound();
        if (!this.round) {
          this.deps.toast("没有新的题目了", "去「复习」里继续吧。");
          return;
        }
      }
      this.learningSessionId = createSessionId();
      this.learningSessionDay = dayKeyOf(this.now);
      this.learningSessionRev = nextRev(
        this.savedSessions?.learning?.rev ?? 0,
      );
    } else if (stored) {
      this.learningSessionId = stored.id;
      this.learningSessionDay = stored.day;
      this.learningSessionRev = stored.rev;
    }

    // 池子 = 轮里还没学完的卡（顺序与 `cardIds` 一致）。
    // 复习轮借 `activePool` 当到期队列，所以**每次进学习都要重建一次**。
    this.syncPoolToRound();
    if (this.appState.activePool.length === 0) {
      this.deps.toast("没有新的题目了", "去「复习」里继续吧。");
      this.round = null;
      this.clearLearningSession();
      this.save();
      return;
    }

    const remaining = new Set(this.appState.activePool.map((item) => item.id));
    let queue: string[];
    if (resumable && stored) {
      queue = stored.queue.filter((id) => remaining.has(id));
      // 补上这一轮还没学、但队列里没有的卡（老数据 / 被剪枝过）
      for (const id of memoryRoundRemaining(this.round!)) {
        if (remaining.has(id) && !queue.includes(id)) queue.push(id);
      }
    } else {
      queue = shuffle(this.appState.activePool.map((item) => item.id));
    }

    // 上次停在答案页：把那张卡放回队头，先结算它，再继续下一张。
    if (resumable && stored?.currentId) {
      queue = promoteToHead(queue, stored.currentId);
    }

    if (queue.length === 0) {
      this.deps.toast("没有新的题目了", "去「复习」里继续吧。");
      this.round = null;
      this.clearLearningSession();
      this.save();
      return;
    }

    this.flow = beginLearningRun(queue);
    this.selectedAnswers = [];
    // 开轮这一步也要落盘：这一批是谁、目标几道、队列顺序，都是刚定下的
    this.save();
    this.selectNext();
    appSound.play("session-start");

    // 上次停在答案页：答案已经写进 `progress`，恢复时先走一次结算
    // （学习轮可能因此在 `advanceQuestionFlow` 里毕业 / 补题 / 收尾）。
    if (resumable && stored?.answered && stored.currentId === cardIdOf(this.flow)) {
      this.advanceQuestionFlow();
    }
  }

  /**
   * 挑一批卡开一轮：数量取「设置里的每轮题数」，但**不超过题库里真能学出来的数量**。
   *
   * 候选由 `poolCandidates` 给出（没学过的 + 学到一半的，已按顺序 / 随机排好），
   * 所以「这一批」与首页那句「还有 N 道 · 每轮 M 道」是同一个来源。
   */
  private pickRound(): MemoryRoundState | null {
    const target = Math.max(1, this.memorySettings.roundTarget);
    const candidates = this.poolCandidates(new Set()).slice(0, target);
    return createMemoryRound(
      candidates.map((q) => q.id),
      target,
    );
  }

  /**
   * 今天这一轮的复习队列：**到期的 + 还没补完连对的**，与首页 `dueCount` /
   * `reviewableCount` 同一份判据。
   *
   * 这里刻意**不看** `doneIds`：那份清单只回答「进度条现在是多少」，
   * 不回答「这道卡今天还能不能练」。到期就得能复习：今天的卡今天想再过一遍
   * 是完全正常的需求，分母会跟着长。
   */
  private reviewQueueToday(): MemoryQuestion[] {
    return reviewQueueTodayOf(this.query);
  }

  /**
   * 开始「复习」。
   *
   * - 盘上有**今天**的会话 → 接着打开：队列顺序、当前题、过关清单、连对次数都留着
   *   （这就是「复习到 3 / 5，换设备打开还是 3 / 5」）
   * - 盘上是**昨天**的 → 今天重新排一轮，计数归零（`doneIds` / `targets` / `failed` /
   *   `streaks` 全部清空）。昨天没做完的卡如果今天仍然到期，本来就在今天的队列里；
   *   已经被推到未来的那些不属于今天，不带进来
   * - 盘上没有 → 新建今天这一份
   *
   * **队列一律由今天这一批重新算**（`reviewQueueToday`），盘上那份 `queue` 只贡献
   * 顺序与「停在哪张」：它是一份计划，不是事实——跨天续做时它会留着已经被推到
   * 未来的卡，于是出现「首页说 3 道、点进去 39 道」。
   *
   * 出题顺序：同一天续做保留原顺序；新的一天 / 新开一轮打散。
   */
  startReview(): void {
    // 进入前先以盘上为准：同步可能刚把另一台设备的进度写下来，而这里的
    // `savedSessions` 还是构造时那份（订阅通知能覆盖绝大多数情况，但「同步在
    // 视图挂载之前就完成了」这类时序只能靠入口这一次重读兜住）。
    this.reloadFromStorage();
    const today = dayKeyOf(this.now);
    const todayIds = this.reviewQueueToday().map((q) => q.id);
    if (todayIds.length === 0) {
      this.deps.toast("今天没有需要复习的题目");
      return;
    }

    const stored = this.savedSessions?.review;
    const sameDay = stored !== undefined && stored.day === today;

    // 盘上的顺序（同一天才有意义）→ 补上今天新到期的（新的一天打散）→ 当前题回队头
    const allowed = new Set(todayIds);
    const queue = (stored?.queue ?? []).filter((id) => allowed.has(id));
    const fresh = todayIds.filter((id) => !queue.includes(id));
    queue.push(...(sameDay ? fresh : shuffle(fresh)));
    const orderedQueue = promoteToHead(queue, stored?.currentId ?? null);

    const session = createReviewSession({
      day: today,
      queue: orderedQueue,
      currentId: stored?.currentId ?? null,
      // 跨天：计数归零，卡片按常规到期重来（昨天差一次没补完不是今天的包袱）
      answered: sameDay ? stored?.answered : false,
      doneIds: sameDay ? stored?.doneIds : [],
      touchedIds: sameDay ? stored?.touchedIds : [],
      targets: sameDay ? stored?.targets : {},
      failed: sameDay ? stored?.failed : [],
      streaks: sameDay ? stored?.streaks : {},
      rev: sameDay ? (stored?.rev ?? 0) : nextRev(stored?.rev ?? 0),
    });

    // 今天到期的都过完了（`doneIds` 会从队列里剔掉），就不要再开一轮空会话：
    // 首页这时显示「今日已复习完」，两边说的是同一件事。
    if (session.queue.length === 0) {
      this.deps.toast("今天没有需要复习的题目");
      return;
    }

    this.reviewSessionDay = session.day;
    this.reviewSessionRev = session.rev;
    this.flow = beginReviewRun(session.queue, {
      target: { ...session.targets },
      reviewed: [...session.doneIds],
      touched: [...session.touchedIds],
      failed: [...session.failed],
      streaks: { ...session.streaks },
    });
    this.selectedAnswers = [];
    this.appState = {
      ...this.appState,
      // 复习轮借 `activePool` 当到期队列用。它只是运行时的投影，不落盘
      // （记忆模式的 `save()` 永远写空池子，见 `save`）。
      activePool: session.queue.map((id) => ({
        id,
        consecutiveCorrect: session.streaks[id] ?? 0,
        hasEverMistaken: false,
        hasBeenShown: false,
        lastSelectedRound: 0,
      })),
    };
    this.save();
    this.selectNext();
    appSound.play("session-start");

    // 上次停在答案页：答案已经写进 `progress`，恢复时先走一次结算。
    if (
      sameDay &&
      stored?.answered &&
      stored.currentId === cardIdOf(this.flow)
    ) {
      this.advanceQuestionFlow();
    }
  }

  /** 回到首页。 */
  exitSession(): void {
    const wasActive = this.run !== "idle";
    // 先带着**当前 flow** 存一次快照：这一轮 / 今天这一轮的队列与当前题
    // 必须留下，否则「退出再进来」只能从 round 重建队列，位置就丢了。
    this.save();
    this.flow = finishRun();
    this.selectedAnswers = [];
    // 这一轮整个留着（`round` 不动）：下次「学习新的题目」接着这一轮继续。
    // 池子不落盘——`save()` 对记忆模式永远写空池子，`startLearning` 会按
    // `round` 重建；复习队列则从会话记录恢复。
    this.save();

    if (wasActive) appSound.play("session-end");
  }

  // ── 整轮的动作（总览里的「标熟」 / 答题区的「结束本轮」） ────────────

  /**
   * 把一张卡直接标为已掌握（总览里点两下「标熟」）。
   *
   * 终态与走完复习阶梯得到的「已掌握」完全一致：`state = "mastered"`，
   * level / streak / nextDue 一起清零（与 `advanceReview` 的最后一步同形），
   * `lapses` 原样保留——它是累计答错次数，不属于复习阶梯。
   *
   * 这张卡可能正待在本轮里（甚至就是当前这一题）：如果它在**本轮这一批**里，
   * 就同时记成「本轮已掌握」——否则 `syncPoolToRound` 会把它当成「还没学完」
   * 又塞回池子。本轮之外的卡只改进度，不影响这一轮的计数。
   */
  masterQuestion(id: string): void {
    if (!this.questions.some((q) => q.id === id)) return;
    const current = this.progress[id];
    if (current?.state === "mastered") return;

    const wasCurrent = this.currentQuestion?.id === id;
    const inRound = this.appState.activePool.some((item) => item.id === id);

    if (this.round) {
      this.round = markMemoryRoundMastered(this.round, id);
    }
    this.appState = withSyncedMasteredIds({
      ...this.appState,
      activePool: this.appState.activePool.filter((item) => item.id !== id),
      memory: this.writeProgress(this.appState, id, {
        state: "mastered",
        level: 0,
        streak: 0,
        nextDue: 0,
        lapses: current?.lapses ?? 0,
      }),
    });

    // 本轮里关于这张卡的三处记账一起清掉（队列 / 连对要求 / 降级记录 / 连对次数）
    this.flow = dropFromQueue(this.flow, id);
    this.flow = removeFailed(this.flow, id);
    this.flow = clearReviewTarget(this.flow, id);
    this.flow = clearReviewStreak(this.flow, id);
    // 复习轮没跑着时（首页总览里点「标熟」）flow 是 `idle`，上面那几句全是空操作，
    // 落盘那份会话里的待办会留着把这张卡拉回来。这里单独剔一次。
    this.dropFromSavedReview(id);
    if (this.run === "reviewing" && inRound) {
      // 标熟 = 这轮不用再练它了：算作今天过关，进度条跟着走
      this.flow = addReviewed(this.flow, id);
      this.flow = addTouched(this.flow, id);
    }

    // 学习轮少了一张就补一张进来：池子始终是满的（与 `graduateInLearning` 同一条规矩）
    if (this.run === "learning") {
      this.refillRound();
      this.syncPoolToRound();
    }
    this.save();

    // 标熟也可能正好把这一轮凑满（在总览里连点几下）：照常收尾。
    // 凑满时只响「完成」，不再叠一声 checkpoint——那是同一件事的两个阶段，
    // 不是两次操作。
    const completesRound =
      this.run === "learning" &&
      this.round !== null &&
      isMemoryRoundComplete(this.round);
    if (!completesRound) appSound.play("question-mastered");

    if (completesRound) {
      this.finishLearningRound();
      return;
    }

    // 标熟的正好是当前这一题：别把它留在屏幕上，照常走「下一题」
    if (wasCurrent) this.selectNext();
  }

  /**
   * 「结束本轮」：这一轮作废，然后**退出到首页**（和 `exitSession` 一样离开答题区）。
   *
   * 与「退出本轮」的区别只在轮次留不留：
   *   - 退出（`exitSession`）：回首页，这一轮留着，下次点「学习新的题目」接着学；
   *   - 结束（这里）：回首页，这一轮整个丢掉（`round = null`），
   *     下次点「学习新的题目」是**新的一轮**（tooltip 那句「下次开启新一轮」）。
   *
   * 「丢掉一整轮」只有一句 `this.round = null`：目标 / 这一批 / 已掌握装在同
   * 一个对象里，不存在「漏清某个字段」的可能。池子是轮的投影，跟着一起空。
   *
   * 只认学习轮：复习轮没有「结束」这个概念（复习队列就是「今天还欠什么」，
   * 按钮也不在那边显示），所以这里不是学习轮就什么都不做。
   */
  endRound(): void {
    if (this.run !== "learning") return;

    this.flow = finishRun();
    this.selectedAnswers = [];
    this.round = null;
    this.clearLearningSession();
    this.appState = {
      ...this.appState,
      activePool: [],
      memory: this.clearLearningStreaks(),
    };
    // 这里**不写** `learnedDay`：没学完的一轮不算「今天学过一轮」，
    // 首页的学习入口该保持高亮（和 `exitSession` 同一口径）
    this.save();
    appSound.play("session-end");
  }

  /**
   * 把「学习中」卡片的轮内连对清零（只给 `endRound` 用）。
   *
   * `progress.streak` 是**轮内**的计数（见「两个必须分开的概念」）：这一轮既然
   * 作废，它就该跟着归零，否则新的一轮会从「2 / 3」接着数——那不叫重新开始。
   */
  private clearLearningStreaks(
    base: RuntimeState = this.appState,
  ): MemoryStoredState {
    const progress: MemoryProgressMap = { ...(base.memory?.progress ?? {}) };
    let changed = false;
    for (const [id, item] of Object.entries(progress)) {
      if (item.state !== "learning" || item.streak === 0) continue;
      progress[id] = { ...item, streak: 0 };
      changed = true;
    }
    if (!changed) return base.memory ?? this.memorySection(base, {});
    return this.memorySection(base, { progress });
  }

  // ── 本轮「答错后重新连对」的待办 ────────────────────────────────────
  //
  // 实现在 `sessionQueries.retryTargetsTodayOf`：只认今天的会话，且卡片必须
  // 还在复习中（可能已被重置 / 已掌握）。

  // ── 答题流 ──────────────────────────────────────────────────────────

  /**
   * 从**落盘**的复习会话里剔掉一张卡（总览里标熟时用）。
   *
   * `buildReviewSession` 只在复习轮跑着时读 `flow`；在首页标熟时 flow 是 `idle`，
   * 那条路径不会经过它。所以这里直接改这份已落盘的记录——否则「标熟一张还欠
   * 连对的卡」之后，那条待办仍在盘上，下次复习又把它拉回来了。
   */
  private dropFromSavedReview(id: string): void {
    const review = this.savedSessions?.review;
    if (!review) return;

    const targets = { ...review.targets };
    delete targets[id];
    const streaks = { ...review.streaks };
    delete streaks[id];
    const without = (ids: readonly string[]) => ids.filter((other) => other !== id);

    this.savedSessions = {
      ...this.savedSessions,
      review: {
        ...review,
        queue: without(review.queue),
        doneIds: without(review.doneIds),
        touchedIds: without(review.touchedIds),
        targets,
        failed: without(review.failed),
        streaks,
        currentId: review.currentId === id ? null : review.currentId,
        // 标熟也是今天这一轮的变化：带上新 `rev`，否则同步时会被旧快照盖掉
        rev: nextRev(review.rev),
      },
    };
  }

  /**
   * 把池子**按轮重建**：`activePool = round.cardIds - round.masteredIds`。
   *
   * 这是本轮唯一的「池子从哪来」。以前池子是第二份真相：`endRound` 清一份、
   * `startReview` 挪一份、旧的 `fillActivePool` 补一份，三处都要记得同步，漏一处就
   * 出现「池子里有卡、轮里没有」或者反过来。
   *
   * 重建时保留池子里原有的 `consecutiveCorrect` / `hasBeenShown`（连对进度在
   * 池子条目上显示）；池子里没有的卡按 `progress.streak` 起头。
   * `round` 为 `null`（没有进行中的一轮）时池子就是空的。
   */
  private syncPoolToRound(): void {
    // 先剔掉已经不属于这一轮的卡（题被删 / 在别处被标熟），目标跟着收敛
    const round = this.round
      ? pruneMemoryRound(this.round, (id) => this.isLearnable(id))
      : null;
    this.round = round;

    if (!round) {
      if (this.appState.activePool.length > 0) {
        this.appState = { ...this.appState, activePool: [] };
      }
      return;
    }

    const existing = new Map(
      this.appState.activePool.map((item) => [item.id, item]),
    );
    const activePool = memoryRoundRemaining(round).map((id) => {
      const previous = existing.get(id);
      if (previous) return previous;
      return {
        id,
        // 学到一半的卡要接着之前的连对次数数，不能从 0 开始
        consecutiveCorrect: this.progress[id]?.streak ?? 0,
        hasEverMistaken: false,
        hasBeenShown: false,
        lastSelectedRound: 0,
      };
    });
    this.appState = { ...this.appState, activePool };
  }

  /**
   * 往这一轮里补卡：**只在「每掌握一题就补一题」时补**（`lockRoundPool` 关掉）。
   *
   * 池子（= 轮里还没学完的卡）少于目标，就从候选里挑几道补进 `round.cardIds`。
   * 目标是开轮时定下的，**补卡不会把目标顶高**；`createMemoryRound` 已经保证
   * 「目标 ≤ 这一批的数量」，所以补卡只在「学出来一道、池子空出一个位」时发生。
   *
   * 补进来的卡同时排进本轮队列（否则它在池子里却永远不被抽到，队列一空本轮
   * 就误判成结束了）。
   *
   * 打开「每轮限定题数」时不补：这一批就是这一批，学完为止。
   */
  private refillRound(): void {
    const round = this.round;
    if (!round || this.memorySettings.lockRoundPool) return;

    const room = round.goal - memoryRoundRemaining(round).length;
    if (room <= 0) return;

    const picked = this.poolCandidates(new Set(round.cardIds)).slice(0, room);
    if (picked.length === 0) return;

    this.round = addMemoryRoundCards(
      round,
      picked.map((q) => q.id),
    );
    this.flow = appendQueue(
      this.flow,
      shuffle(picked.map((q) => q.id)),
    );
  }

  /**
   * 还能进池子的候选卡，按 `selectionMode` 排好序。
   *
   * `exclude` 是「已经在这一轮里」的 id（补卡时不该重复挑）。判据与首页的
   * `learnableCount` 完全一致：没学过的，或者学到一半的（`state === "learning"`）。
   */
  private poolCandidates(exclude: ReadonlySet<string>): MemoryQuestion[] {
    const candidates = this.questions.filter(
      (q) => !exclude.has(q.id) && this.isLearnable(q.id),
    );
    return this.appState.settings.selectionMode === "sequential"
      ? candidates
      : shuffle(candidates);
  }

  /**
   * 选下一题；队列空了就结束本次会话。
   *
   * **「这道卡还能不能出」只看会话事实，不看 `activePool`。**
   *
   *   - 复习：在 `review.reviewed`（今天已过关）里的跳过；
   *   - 学习：在 `round.masteredIds`（本轮已掌握）里的跳过；
   *   - 题目被删 / id 改了 → `lookupQuestion` 为空。
   *
   * 以前这里要求「id 必须还在 `activePool` 里」。可 `activePool` 在记忆模式是
   * **运行态**：不落盘（`save()` 永远写空池子）、合并结果里恒为空
   * （`mergeBankState` 有意置 `[]`）。于是任何一次「同步写回 → 重读盘上那份」
   * 都会把池子清空，队列里每一张卡都被判成"不在池子里"逐个丢弃——
   * 表现就是「刚点完『现在合并』，点『下一题』直接说今天复习完了」。
   *
   * 池子不是第二份真相，就不该拿它当出题判据。
   */
  selectNext(): void {
    const next = queueOf(this.flow)[0];
    if (next === undefined) {
      this.finishSession();
      return;
    }

    const settled =
      this.run === "reviewing"
        ? (reviewOf(this.flow)?.reviewed.includes(next) ?? false)
        : (this.round?.masteredIds.includes(next) ?? false);
    const question = settled ? null : this.lookupQuestion(next);

    if (!question) {
      this.flow = dropQueueHead(this.flow);
      this.selectNext();
      return;
    }

    this.flow = showCard(this.flow, question.id);
    this.presentationSeq += 1;
    this.selectedAnswers = [];
    this.resetCopyQuestionStatus();
    // 屏上停了哪一张也是会话的一部分：换设备 / 刷新后要能恢复到这里。
    this.save();
  }

  /**
   * 点一个自评（知道 / 模糊 / 忘记）并结算。
   *
   * UI 走这条；`selectedAnswers` 仍是那条「表单草稿」的公开入口（测试与键盘层
   * 也用它），两者最终都落到 `submit()` 的同一条转移上。
   */
  pick(rating: MemoryAnswerKind): void {
    if (this.showResult) return;
    this.selectedAnswers = [MEMORY_ANSWER_CODE[rating]];
    this.submit();
  }

  /** 记忆题型的「提交」= 用自评结果（知道 / 模糊 / 忘记）结算这一道卡。 */
  submit(): void {
    // 只有「题干页」收自评：答案页重复提交、首页提交都是空操作
    if (this.flow.card?.kind !== "asking") return;
    const question = this.currentQuestion;
    if (!question || this.selectedAnswers.length === 0) return;

    const kind = memoryAnswerKind(this.selectedAnswers[0]);
    // 「模糊」不算答错：答案卡片保持正常配色，反馈音 / 闪烁也按「没答错」处理
    const correct = kind !== "forget";
    // 快照要在改 appState **之前**取：答案页的改判以它为起点重算
    this.flow = answerCard(this.flow, kind, correct, this.appState);
    this.appState = this.applyMemoryAnswer(question, kind);
    this.save();

    this.deps.flash(correct);
    appSound.play(correct ? "answer-correct" : "answer-wrong");

    // 「答对自动下一题」是全局设置（⌘N 切换）：刷题模式在 submit 末尾做同一件事，
    // 记忆模式的「答对」= 自评「知道」。
    if (this.globalSettings.autoNextOnCorrect && correct) {
      this.advanceQuestionFlow();
    }
  }

  /**
   * 答案页的降级操作：把刚才的自评改判成更差的一档。
   *
   * 和刷题模式的「视作正确」是一对反向操作：
   *   - 刷题模式：答错 → 点它 → 改成答对
   *   - 记忆模式：点「知道」显示答案后发现自己没记住 → 点「模糊」/「记错了」
   *
   * 两者都基于判分前的快照重算，所以反复改判不会叠加。
   */
  private downgradeAnswer(kind: MemoryAnswerKind): void {
    const rewind = this.flow.card?.kind === "answered" ? this.flow.card.rewind : null;
    const question = this.currentQuestion;
    if (!rewind || !question) return;

    const correct = kind !== "forget";
    this.flow = reAnswer(this.flow, kind, correct, rewind);
    this.appState = this.applyMemoryAnswer(question, kind, rewind);
    this.save();
    this.deps.flash(correct);
    appSound.play(correct ? "answer-correct" : "answer-wrong");
  }

  /** 「记错了」：改判成忘记（原来答「知道」或「模糊」时才可用）。 */
  markAsWrong(): void {
    if (this.answerKind === "forget") return;
    this.downgradeAnswer("forget");
  }

  /** 「模糊」：把刚才的「知道」改判成模糊（只有原答案是「知道」时可用）。 */
  markAsFuzzy(): void {
    if (this.answerKind !== "know") return;
    this.downgradeAnswer("fuzzy");
  }

  /** 下一题：结算当前卡片，推队列。 */
  advanceQuestionFlow(): void {
    const question = this.currentQuestion;
    if (!question) return;

    const item = this.appState.activePool.find((i) => i.id === question.id);

    // 学习流：还没连对到 N 次的卡片（包括刚答错的）排到队尾继续。
    // 注意：连对到门槛的卡片在 submit 时就已经毕业、离开了 activePool，
    // 所以 `item` 为 undefined 时说明这道已经学会了。
    if (this.run === "learning") {
      // 连对够了的卡片在 submit 时就已经毕业、离开了 activePool，
      // 所以 `item === undefined` 就是「这道学会了」，正好只出现一次。
      if (item !== undefined && item.consecutiveCorrect < this.streakToLearn) {
        this.requeue();
        return;
      }
      this.graduateInLearning(question.id);
      return;
    }

    // 复习流：本轮「复习完成」= 连对到本轮目标次数（默认 1，答错后是 N）。
    // 连对次数存在会话的 `streaks` 里（不再借用 `progress.streak`），
    // 所以退出 / 刷新 / 换设备后接着数。
    const target = this.reviewTarget[question.id] ?? 1;
    const streak = this.reviewStreaks[question.id] ?? 0;
    if (streak < target) {
      this.requeue();
      return;
    }

    // 连对达标 = 「这一轮复习完成」。它不等于「掌握」：
    //   - 本轮没失败过 → 正常推进掌握阶梯（走完 M → 已掌握）
    //   - 本轮失败过   → 阶梯已经归零并定在「明天」，本轮完成不再推进，
    //                    否则答错那道的间隔会被推成和答对一样（bug 根因）
    if (!this.failedThisRound.includes(question.id)) {
      this.appState = this.advanceMastery(question.id);
    }
    this.flow = clearReviewTarget(this.flow, question.id);
    this.flow = clearReviewStreak(this.flow, question.id);
    // 真正过关：进度条分子 +1（答错过的卡要等连对达标才走到这里）
    this.flow = addReviewed(this.flow, question.id);
    this.flow = addTouched(this.flow, question.id);
    this.save();
    this.dropCurrent();
  }

  /**
   * 学习模式：这一题学会了 → 记进本轮（`round.masteredIds`）、补一道新题进池子；
   * 本轮掌握数达到目标就结束这一轮。
   *
   * 注意这里**不再自己数 `roundMastered`**：已掌握是谁就是 `round.masteredIds`，
   * 计数由模型算（`memoryRoundDone`）。以前「计数 + 池子 + 这一批」是三份，
   * 谁忘同步谁就出错。
   */
  private graduateInLearning(id: string): void {
    if (this.round) {
      this.round = markMemoryRoundMastered(this.round, id);
    }

    // 出队 + 把队列里已经离开活动池的题清掉
    this.flow = dropQueueHead(this.flow);
    this.flow = retainInQueue(
      this.flow,
      new Set(this.appState.activePool.map((item) => item.id)),
    );

    // 补卡（「每掌握一题就补一题」时才会补）：新卡进池子，同时排进本轮队列
    // （`refillRound` 自己会把新卡排到队尾）
    this.refillRound();
    this.syncPoolToRound();
    // 本轮进度与补进来的新卡都要立刻落盘，否则紧接着关页面会少算一道
    this.save();

    if (this.round && isMemoryRoundComplete(this.round)) {
      this.finishLearningRound();
      return;
    }

    this.selectNext();
  }

  /**
   * 结束本轮学习。
   *
   * **正常情况下这里不会被提前调用**：`createMemoryRound` 保证「目标 ≤ 这一批
   * 能学出来的数量」，所以学到目标就正好把池子学空。两个 `exhausted` 分支是
   * 兜底（题库被改 / 这一批的卡在总览里被标熟 / 旧数据），分开说是因为文案不同：
   *   - `"bank"`：题库里没有更多新卡了
   *   - `"pool"`：本轮这一批（`lockRoundPool`）里的卡被搁下了
   *
   * 两种都不能报成功，否则用户会看到绿色的「本轮学习完成 · 已掌握 2 / 5 题」。
   */
  private finishLearningRound(exhausted: false | "bank" | "pool" = false): void {
    // 先把这一轮的两个数读出来，再把它丢掉（丢掉之后就只剩设置里的默认值了）
    const mastered = this.roundMastered;
    const target = this.targetPerRound;
    this.round = null;
    this.clearLearningSession();
    this.flow = finishRun();
    this.selectedAnswers = [];
    this.appState = {
      ...this.appState,
      memory: this.memorySection(this.appState, {
        // 首页靠它把学习按钮降一档颜色（今天学过一轮了）
        learnedDay: dayKeyOf(this.now),
      }),
      // 一轮结束，池子跟着轮一起空掉：还没学完的卡都还没学（`state` 是
      // `undefined` 或 `learning`），下一轮开轮时照样会被挑中
      activePool: [],
    };
    this.save();

    if (exhausted && mastered < target) {
      this.deps.toast(
        "这一轮学完了",
        exhausted === "pool"
          ? `已掌握 ${mastered} / ${target} 题，本轮这一批就这些了。`
          : `已掌握 ${mastered} / ${target} 题，题库里没有更多新卡片了。`,
      );
      return;
    }

    this.deps.toast(
      "本轮学习完成",
      `已掌握 ${mastered} / ${target} 题。`,
      "success",
    );
    appSound.play("round-complete");
  }

  /**
   * 把当前这道排到队尾（学习流没连对够、复习流没补完连对时用）。
   *
   * 不收 id：要转的**永远是队头**，而队头就是屏上这一张（`card` 只可能指向
   * 队头）。以前收一个 id 却从不读它，等于留了个「传谁都行」的假参数。
   */
  private requeue(): void {
    this.flow = rotateQueue(this.flow);
    this.selectNext();
  }

  /**
   * 推进掌握阶梯：level +1，间隔按 `2^(level-1)` 天安排；
   * 超过掌握阈值 就变成「已掌握」，level / streak 一起清零。
   */
  private advanceMastery(id: string): RuntimeState {
    const current = this.appState.memory?.progress[id];
    const item = current ?? createReviewProgress(this.now);
    const next = advanceReview(item, this.memorySettings.graduateLevel, this.now);
    return {
      ...this.appState,
      memory: this.writeProgress(this.appState, id, next),
      masteredIds:
        next.state === "mastered"
          ? [...new Set([...this.appState.masteredIds, id])]
          : this.appState.masteredIds,
    };
  }

  /** 出队。完成数不在这里数：复习看 `reviewedIds`，学习看 `round.masteredIds`。 */
  private dropCurrent(): void {
    this.flow = dropQueueHead(this.flow);
    this.selectNext();
  }

  // ── 状态变迁 ────────────────────────────────────────────────────────

  /**
   * 把一次自评写进 `RuntimeState`（并顺手改会话流里的复习记账）。
   *
   * - 学习流：知道 → 连对 +1，连对到 N 次就转「复习中」；忘记 → 连对清零
   * - 复习流：知道 → 只累加本轮连对次数（不动阶梯）；忘记 → 阶梯归零 + 本轮目标提到 N
   */
  private applyMemoryAnswer(
    question: Question,
    kind: MemoryAnswerKind,
    base: RuntimeState = this.appState,
  ): RuntimeState {
    const current = base.memory?.progress[question.id];
    const knows = kind === "know";
    const fuzzy = kind === "fuzzy";
    // 轮内连对次数：知道 +1、模糊不动、忘记清零
    const activePool = base.activePool.map((item) =>
      item.id === question.id
        ? {
            ...item,
            consecutiveCorrect: knows
              ? item.consecutiveCorrect + 1
              : fuzzy
                ? item.consecutiveCorrect
                : 0,
            hasBeenShown: true,
          }
        : item,
    );

    if (this.run === "reviewing") {
      const item = current ?? createReviewProgress(this.now);

      if (kind === "fuzzy" || kind === "forget") {
        // 模糊：掌握阶梯退一级（不清零）；忘记：阶梯归零（明天从 1 天重来）。
        // 两者本轮都按「没记住」处理——目标提到 N、计入「碰过」、
        // 完成时也不推进阶梯（否则退掉的那一级立刻又被加回来）。
        // 注意：**不算过关**，进度条分子不动；它还在队列里，要重新连对 N 次。
        this.flow = setReviewTarget(this.flow, question.id, this.streakToLearn);
        this.flow = addFailed(this.flow, question.id);
        this.flow = addTouched(this.flow, question.id);
        this.flow = setReviewStreak(this.flow, question.id, 0);
        const next = kind === "fuzzy"
          ? fuzzyReview(item, this.now)
          : resetReview(item, this.now);
        return {
          ...base,
          activePool,
          memory: this.writeProgress(base, question.id, {
            ...next,
            // 复习轮的连对在 `sessions.review.streaks`，不写进长期进度
            streak: 0,
          }),
          currentRound: base.currentRound + 1,
        };
      }

      // 答对：只累加「本轮连对次数」，不碰掌握阶梯。
      // 阶梯的推进放在连对达标（本轮复习完成）那一步。
      this.flow = setReviewStreak(
        this.flow,
        question.id,
        (this.reviewStreaks[question.id] ?? 0) + 1,
      );
      this.flow = addTouched(this.flow, question.id);
      return {
        ...base,
        activePool,
        currentRound: base.currentRound + 1,
      };
    }

    // 学习流：知道 +1、模糊保持不变（学不会但也不退）、忘记清零
    const streak = knows
      ? (current?.streak ?? 0) + 1
      : fuzzy
        ? (current?.streak ?? 0)
        : 0;
    const required = this.requiredStreak;
    // `lapses` 是「累计答错次数」，只有「忘记」算；模糊不算答错、毕业时也不清零
    const lapses = (current?.lapses ?? 0) + (kind === "forget" ? 1 : 0);

    if (knows && streak >= required) {
      // 学出来了 → 进入复习中（第 1 次复习安排在明天）
      return {
        ...base,
        activePool: activePool.filter((item) => item.id !== question.id),
        masteredIds: base.masteredIds,
        memory: this.writeProgress(
          base,
          question.id,
          createReviewProgress(this.now, lapses),
        ),
        currentRound: base.currentRound + 1,
      };
    }

    return {
      ...base,
      activePool,
      memory: this.writeProgress(
        base,
        question.id,
        createLearningProgress(streak, lapses),
      ),
      currentRound: base.currentRound + 1,
    };
  }

  /**
   * 生成一份新的 `memory` 段：patch 里没写到的字段原样保留。
   *
   * 实现见 `sessionStore.memorySectionOf`——那一层是纯函数，和「屏上怎么跑」
   * 无关，单独拆出去之后这里只留一行委托。
   */
  private memorySection(
    base: RuntimeState,
    patch: Partial<MemoryStoredState>,
  ): MemoryStoredState {
    return memorySectionOf(base.memory, patch, this.savedSessions);
  }

  /**
   * 写一条进度，并原样保住 `memory` 段里的其它字段。
   *
   * **这里是进度写入的唯一收口，也是唯一盖修订戳的地方**（见 `src/lib/rev.ts`）。
   * 盖戳的基准取"本机见过的同一条卡的最大戳"（本地那份与本次要写的那份取大），
   * 计数逐个递增——**不读墙上时钟**，所以两台设备的钟谁快谁慢都不影响次序。
   *
   * 注意：**从云端拉回来 / 合并出来的那份不走这里**（`sync/apply` 直接落盘），
   * 否则两台设备各盖各的戳，同样的内容会算出不同状态，永远收敛不了。
   */
  private writeProgress(
    base: RuntimeState,
    id: string,
    progress: MemoryProgress,
  ): MemoryStoredState {
    return withProgress(base, id, progress, this.savedSessions);
  }

  private finishSession(): void {
    // 收尾报的是**今天过了几道**，与进度条同一个数（`reviewedIds` → 会话里的
    // `doneIds`）。以前这里读 `flow.run.completed`——那是「本次进入复习之后过了
    // 几道」，当天中途刷新 / 退出再进来会从 0 重数，总览里「标熟」的卡也不计，
    // 于是进度条显示 5 / 5、收尾却说「共复习 2 道」。两份来源必然对不上，
    // 所以那份计数已经删掉，别再把它加回来。
    const learned = this.reviewedIds.length;
    const run = this.run;

    // 学习轮池子空了（队列跟着空）就按「这一轮学完」收尾。
    //
    // 正常情况下**走不到这里**：目标 ≤ 这一批的数量（`createMemoryRound`），
    // 所以学到目标那一下 `graduateInLearning` 就把本轮收了。这里兜的是
    // 题库中途被改 / 这一批的卡在总览里被标熟 之类的外部变化。
    if (run === "learning") {
      if (this.appState.activePool.length === 0) {
        this.finishLearningRound(this.newCount === 0 ? "bank" : "pool");
        return;
      }
      // 队列空了但池子里还有卡：这一轮还没学完，别判成结束。
      // 把池子重新排一遍（自愈），否则会停在「首页说有半轮、点进来没题」。
      //
      // 只重排**题库里真的存在**的卡：`selectNext` 会跳过找不到的 id，跳过之后
      // 队列又空 → 再回到这里重排 → 一张都排不出来时就成了死循环。所以先筛一遍，
      // 一张都不剩说明池子是脏的（题被删 / id 变了），按题库耗尽收尾。
      const known = new Set(this.questions.map((q) => q.id));
      const alive = this.appState.activePool.filter((item) => known.has(item.id));
      if (alive.length === 0) {
        this.finishLearningRound("bank");
        return;
      }
      this.flow = replaceQueue(
        this.flow,
        shuffle(alive.map((item) => item.id)),
      );
      this.selectNext();
      return;
    }

    // 先带着**当前 flow** 存一次：队列刚走完的那一刻，`doneIds` 正好是
    // 今天过完的全部卡，进度条停在 5 / 5（不是 0 / 0）。
    this.save();
    this.flow = finishRun();
    this.selectedAnswers = [];
    // 复习会话**不在这里删**。
    //
    // 它记的是「今天过了哪几道、连对补到几次」这个**事实**，不是「还在跑」
    // 这个状态：队列空了，`startReview` 自然不会再出题（`isDue` 已经把过关的卡
    // 排到未来）。删掉的话「答完最后一道 → 收尾说共 5 道 → 进度条却归零」，
    // 而且今天再打开复习也说不清今天到底复习了几道。
    //
    // 真正换成新的一天是在下次 `startReview`：`day` 不是今天时计数归零、队列按
    // `reviewQueueToday` 重排（见 `startReview`）。
    this.appState = { ...this.appState, activePool: [] };
    this.save();
    this.deps.toast(
      "本轮复习完成",
      `共复习 ${learned} 道卡片。`,
      "success",
    );
    appSound.play("round-complete");
  }

  // ── 设置（全局设置开关在基类） ──────────────────────────────────────

  /** 记忆模式的复习阶梯设置。 */
  updateMemorySettings(patch: Partial<MemoryBankSettings>): void {
    const next = sanitizeMemorySettings({
      ...this.memorySettings,
      ...patch,
    });
    this.appState = {
      ...this.appState,
      memory: this.memorySection(this.appState, { settings: next }),
    };
    this.save();
  }

  /** 按库设置（连对次数、顺序）。记忆模式的数量设置在 `roundTarget`。 */
  updateBankSettings(patch: {
    correctStreakToMaster?: number;
    selectionMode?: "random" | "sequential";
  }): void {
    this.appState = {
      ...this.appState,
      settings: sanitizeBankSettings({ ...this.appState.settings, ...patch }),
    };
    this.save();
  }

  /** 重置记忆模式进度（保留设置）；调试用的时间偏移一并清零。 */
  reset(): void {
    if (this.debugOffset !== 0) this.debugResetDays();
    // 先把答题流停掉再清会话：`exitSession` 的第一步会带着**当前 flow** 存一次
    // 快照，如果这会儿还在复习，那一份会被重新写成「今天过了一半」的会话，
    // 「重置后复习进度归零」就成了一句空话（真踩过）。
    this.flow = finishRun();
    this.selectedAnswers = [];
    this.appState = buildRuntimeState(this.questions, {
      ...createEmptyState(),
      activePool: [],
      settings: this.appState.settings,
      // 重置的墓碑戳：没有它，另一台设备同步时会把旧进度并集回来
      resetRev: nextRev(this.appState.resetRev ?? 0),
      memory: {
        progress: {},
        settings: this.memorySettings,
      },
    });
    // 本轮是题库级状态，换掉 appState 不会自动清：留着会让下一轮从旧的
    // 「已掌握 X / Y」接着数，只学几道就提前结束本轮。
    // 现在「清一轮」只有一句 `round = null`（以前要记得清四个字段）。
    this.round = null;
    this.savedSessions = undefined;
    this.learningSessionId = "";
    this.learningSessionDay = 0;
    this.learningSessionRev = 0;
    this.reviewSessionDay = null;
    this.reviewSessionRev = 0;
    this.exitSession();
    this.save();
    appSound.play("progress-reset");
  }

  // ── 复制当前题目（沿用题型的 formatCopyText） ────────────────────────

  async copyCurrentQuestion(
    options: CopyQuestionOptions = {},
  ): Promise<CopyQuestionResult> {
    const question = this.currentQuestion;
    if (!question) return "unavailable";
    return this.copyQuestion(question, options);
  }

  /**
   * 复制任意一道题（总览列表的复制按钮走这里）。
   *
   * 与 `QuizSession.copyQuestion` **同名同签名**（`options` + `pattern`），
   * 这样两个 session 都能直接喂给 `QuestionCopyStatusStore`。
   * `options.announce` 为真时（快捷键触发）才弹 toast；按钮触发靠
   * `copyQuestionStatus` 表现，和刷题模式一致。
   *
   * 记忆模式没有选项打乱 / 填空输入，复制上下文只带选中的选项。
   */
  async copyQuestion(
    question: Question,
    options: CopyQuestionOptions = {},
    pattern: QuestionCopyPattern = QuestionCopyPattern.QuestionWithAnswer,
  ): Promise<CopyQuestionResult> {
    const typeDef = QUESTION_TYPES[question.type];
    if (!typeDef) return "unavailable";

    const context: QuestionCopyContext = {
      shuffledOptions: [],
      selectedAnswers: this.selectedAnswers,
      blankAnswerInputs: [],
    };

    return this.copyToClipboard(
      question,
      typeDef,
      context,
      options,
      pattern,
      true,
    );
  }

  // ── 临时调试（删掉 devClock 时一并删除这三行 + 顶部 import） ────────

  /** 调试用：把「今天」往后推一天，用来检验复习到期。 */
  debugAddDay(): number {
    this.debugOffset = devAddDay();
    return this.debugOffset;
  }

  /** 调试用：当前已经快进了几天 */
  get debugDayOffset(): number {
    return this.debugOffset;
  }

  /** 调试用：清零快进天数 */
  debugResetDays(): void {
    devResetDays();
    this.debugOffset = 0;
  }

  // ── 进度备份（和刷题模式共用同一套编解码） ──────────────────────────
  // 导出 / 读剪贴板 / 二次确认都在基类，这里只回答「导入的状态怎么落到
  // 记忆模式的运行时状态上」。

  protected applyImportedState(state: StoredState): void {
    this.appState = withSyncedMasteredIds(
      buildRuntimeState(this.questions, {
        ...state,
        activePool: [],
        // 导入是「整段覆盖」：盖一个戳，别让云端的旧进度在下次同步时并集回来
        resetRev: nextRev(this.appState.resetRev ?? 0),
        memory: state.memory ?? {
          progress: {},
          settings: this.memorySettings,
        },
      }),
    );
    // 备份里不带「本轮 / 今天」的短周期状态（见 AGENTS.md），所以导入后必须
    // 按新一轮重新开始：否则旧会话会叠到导入的进度上，几道就结束本轮。
    this.savedSessions = undefined;
    this.learningSessionId = "";
    this.learningSessionDay = 0;
    this.learningSessionRev = 0;
    this.reviewSessionDay = null;
    this.reviewSessionRev = 0;
    this.round = null;
    this.exitSession();
  }

  // ── 持久化 ──────────────────────────────────────────────────────────

  private save(): void {
    // 正在从盘上重读：盘上那份就是要写的东西，这时再写会把半成品（或刚被合并
    // 进来的结果）覆盖掉。见 `isReloading`。
    if (this.isReloading) return;

    // 1. 把当前 flow 收成两份会话（没有进行中的会话就是 undefined）。
    const sessions = this.buildSessions(this.savedSessions);
    this.savedSessions = sessions;

    // 2. 整份交给 `saveState`：它内部有 `persistedState` 白名单（`pendingIds`
    //    这类运行期字段不会落盘），这里再手抄一遍字段清单只会多一处漏改点。
    saveState(this.hash, {
      ...this.appState,
      // 记忆模式的活动池是运行时投影：学习轮由 `round` 重建、复习队列由
      // `sessions.review` 恢复。落盘它会变成第二份真相（而且会和刷题模式的
      // `activePool` 同步语义打架），所以永远写空。
      activePool: [],
      masteredMistakes: this.appState.masteredMistakes ?? {},
      memory: this.memorySection(this.appState, { sessions }),
    });
  }

  /** 把 `this.round` + 当前 flow 收成学习会话（没有进行中的一轮时 undefined）。 */
  private buildLearningSession(
    previous: MemoryLearningSession | undefined,
  ): MemoryLearningSession | undefined {
    const built = buildLearningSessionOf({
      round: this.round,
      run: this.run,
      flow: this.flow,
      previous,
      sessionId: this.learningSessionId,
      sessionDay: this.learningSessionDay,
      sessionRev: this.learningSessionRev,
      now: this.now,
    });
    if (built.session) {
      this.learningSessionId = built.id;
      this.learningSessionDay = built.day;
      this.learningSessionRev = built.rev;
    }
    return built.session;
  }

  /** 把当前复习 flow 收成今天的复习会话（不在复习时保留盘上那份）。 */
  private buildReviewSession(
    previous: MemoryReviewSession | undefined,
  ): MemoryReviewSession | undefined {
    const built = buildReviewSessionOf({
      run: this.run,
      flow: this.flow,
      previous,
      sessionDay: this.reviewSessionDay,
      sessionRev: this.reviewSessionRev,
      now: this.now,
    });
    if (built.session && this.run === "reviewing") {
      this.reviewSessionDay = built.day;
      this.reviewSessionRev = built.rev;
    }
    return built.session;
  }

  private buildSessions(
    previous: MemorySessionsState | undefined,
  ): MemorySessionsState | undefined {
    return buildSessions(
      this.buildLearningSession(previous?.learning),
      this.buildReviewSession(previous?.review),
    );
  }

  private clearLearningSession(): void {
    const next = { ...(this.savedSessions ?? {}) };
    delete next.learning;
    this.savedSessions = next.review ? next : undefined;
    this.learningSessionId = "";
    this.learningSessionDay = 0;
    this.learningSessionRev = 0;
  }

  private loadState(
    stored: ReturnType<typeof loadStoredState>,
  ): RuntimeState {
    return loadMemoryState({
      stored,
      questions: this.questions,
      now: this.now,
    });
  }
}

/** 空复习记账的共享常量（避免每次读 getter 都新建对象）。 */
const EMPTY_IDS: readonly string[] = [];
const EMPTY_REVIEW_TARGET: Readonly<Record<string, number>> = {};

/** 把某张卡放回队头（恢复「上次停在答案页」时用）；不在队列里就原样返回。 */
function promoteToHead(queue: readonly string[], id: string | null): string[] {
  if (!id || !queue.includes(id)) return [...queue];
  return [id, ...queue.filter((other) => other !== id)];
}

function createEmptyState(): StoredState {
  return createEmptyStoredState(createDefaultBankSettings());
}

/** 复习间隔（天），供 UI 文案使用。 */
export { memoryIntervalDays };
