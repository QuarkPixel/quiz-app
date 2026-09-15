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
 */

import type {
  GlobalSettings,
  MemoryBankSettings,
  MemoryProgress,
  MemoryProgressMap,
  MemoryQuestion,
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
  isDue,
  memoryIntervalDays,
  resetReview,
  studyDay,
} from "@/features/memory/algorithm";
import {
  normalizeMemoryProgressMap,
  normalizeMemoryRetry,
} from "@/features/memory/normalize";
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
import { buildRuntimeState, loadStoredState, saveState } from "@/store";
import {
  createDefaultBankSettings,
  sanitizeBankSettings,
} from "@/bankSettings";
import { STORAGE_PREFIX_QUESTIONS } from "@/config";
import { QUESTION_TYPES } from "@/quiz/types/registry";
import {
  memoryAnswerKind,
  type MemoryAnswerKind,
} from "@/quiz/types/memory/logic";
import {
  QuestionCopyPattern,
  type QuestionCopyContext,
} from "@/quiz/types/types";
import { writeText } from "clipboard-polyfill";
import {
  copyProgressToClipboard,
  parseImportedProgress,
  readProgressFromClipboard,
} from "@/features/quiz/progressActions";
import {
  EXPORT_STATUS_ERROR_RESET_MS,
  EXPORT_STATUS_SUCCESS_RESET_MS,
} from "@/config";
import {
  maybePlayAnswerSound,
  maybePlaySuccessSound,
  setSoundEnabledPreference,
} from "@/sound";
import type { SoundPlayer } from "@/sound/types";

export type MemoryRun = "idle" | "learning" | "reviewing";

export interface MemorySessionDeps {
  flash(isCorrect: boolean): void;
  toast(
    title: string,
    description?: string,
    variant?: "default" | "success" | "destructive",
  ): void;
  sound: SoundPlayer;
}

/** 队列里的一项。 */
interface MemoryQueueItem {
  id: string;
}


export class MemorySession {
  readonly bank: MemoryBank;
  readonly questions: MemoryQuestion[];

  /** 当前会话：首页 / 学习 / 复习 */
  run: MemoryRun = $state("idle");
  /** 同一批里已经出现过的题（用于显示连对进度） */
  shownIds = $state<string[]>([]);
  /**
   * 出题序号：每次 `selectNext()` 都 +1。
   *
   * 题干字号的过渡要按「一次出题」而不是「一道卡」来分界：同一道卡被排回队尾
   * 再次出现时（答错后重来、池子里只有一两道卡）它仍然是新的一次展示，不该
   * 从答案页的小字号动画回大字号。UI 用它做 `{#key}`。
   */
  presentationSeq = $state(0);
  /**
   * 本轮已经掌握了几题（达到 `roundTarget` 本轮就结束）。
   * 这是**落盘**的：学到一半退出，下次进来继续算这一轮。
   */
  roundMastered = $state(0);
  /** 本轮的目标题数快照（开始时从设置里取，中途改设置不影响本轮） */
  roundGoal = $state(0);
  /**
   * 本轮「复习完成」还需要连对几次（key = 题 id）。
   * 默认 1（答对一次就完成本轮）；答错后提到 `correctStreakToMaster`（默认 3）。
   * 这是**轮内**状态，不影响复习阶梯（阶梯只由答错重置、由答对推进）。
   *
   * 同一个值还会落盘一份（`state.memory.retry`）：中途退出 / 刷新后重新进复习时，
   * 这些卡即使不在「今天到期」里也要继续回到本轮，直到补完连对次数。
   */
  reviewTarget = $state<Record<string, number>>({});
  /** 本轮完成数量（用于结束文案） */
  completed = $state(0);
  /** 复习：本轮开始时的总题数（进度条分母；只在本会话有效） */
  reviewTotal = $state(0);
  /** 复习：已经过了一遍的题（每过一题就加进来，进度条靠它变绿） */
  reviewedIds = $state<string[]>([]);
  /**
   * 本轮复习里被降级过的题（「忘记」→ 阶梯归零；「模糊」→ 阶梯退一级）。
   *
   * 「这一轮完成」≠「掌握了」：降级说明没记住，阶梯已经被调低。
   * 所以本轮连对达标时，只要这道在本轮降级过，就**不允许**再推进阶梯，
   * 否则答错那道会和一次答对那道拿到同样的间隔（之前的 bug），
   * 「模糊」退掉的那一级也会立刻被加回来。
   */
  failedThisRound = $state<string[]>([]);
  /** 进度备份：和 QuizSession 同一套状态 */
  exportStatus: "idle" | "copied" | "error" = $state("idle");
  /** 临时调试：当前快进的天数（响应式，供 UI 与 now() 使用） */
  debugOffset = $state(0);
  /** 「复制题目」按钮的状态（和 QuizSession 同名同语义） */
  copyQuestionStatus: "idle" | "copied" | "error" = $state("idle");
  private copyQuestionResetTimer: ReturnType<typeof setTimeout> | null = null;
  // ── 与 QuestionArea 对齐的会话状态 ─────────────────────────────────
  currentQuestion: Question | null = $state(null);
  showResult = $state(false);
  /**
   * 当前这道卡这一轮的自评结果（知道 / 模糊 / 忘记）。
   * 答案页的「记错了 / 模糊」会改写它，按钮组合也按它决定。
   */
  answerKind: MemoryAnswerKind = $state("know");
  /** 最终判定（「知道 / 模糊」算没答错；「记错了」会把 isCorrect 翻回 false） */
  isCorrect = $state(false);
  selectedAnswers: number[] = $state([]);

  appState: RuntimeState = $state(buildRuntimeState([], createEmptyState()));

  private readonly hash: string;
  private readonly globalSettingsRef: GlobalSettingsStore;
  private readonly deps: MemorySessionDeps;
  /**
   * 固定时间源（只有测试会传）。
   *
   * 生产环境不设置它：`now` getter 每次都现算 `Date.now() + debugOffset`，
   * 这样调试里「加一天」能立刻对已挂载的会话生效。之前把偏移捕获进闭包，
   * 导致加天数对当前会话无效（总览里的「N 天后复习」永远不变）。
   */
  private readonly fixedNow: (() => number) | null = null;
  private queue: MemoryQueueItem[] = $state([]);
  /** submit 前的快照，供「记错了」回退 */
  private preSubmitState: RuntimeState | null = null;

  constructor(
    bank: MemoryBank,
    deps: MemorySessionDeps,
    globalSettingsRef: GlobalSettingsStore = globalSettingsStore,
    options: { now?: () => number } = {},
  ) {
    this.bank = bank;
    this.hash = bank.hash;
    this.questions = bank.questions;
    this.deps = deps;
    this.globalSettingsRef = globalSettingsRef;
    this.debugOffset = devDayOffset();
    this.fixedNow = options.now ?? null;
    const stored = loadStoredState(bank.hash);
    this.appState = this.loadState(stored);
    this.roundMastered = stored.roundMastered ?? 0;
    this.roundGoal = stored.roundGoal ?? 0;
    this.normalizeQuestionTypes();
    this.syncQueueToPool();
  }

  currentTypeDef = $derived(
    this.currentQuestion ? QUESTION_TYPES[this.currentQuestion.type] : null,
  );

  // ── 记忆模式自己的进度与设置 ────────────────────────────────────────

  /** 每道题的复习阶梯（来自 `appState.memory`） */
  progress = $derived<MemoryProgressMap>(
    this.appState.memory?.progress ?? {},
  );

  /** 记忆模式的按库设置（复习阶梯阈值等） */
  memorySettings = $derived<MemoryBankSettings>(
    this.appState.memory?.settings ?? createDefaultMemorySettings(),
  );

  /** 当前题的连对次数（UI 文案用） */
  get currentStreak(): number {
    return this.currentPoolItem?.consecutiveCorrect ?? 0;
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
    return this.questions.filter((q) => this.progress[q.id] === undefined)
      .length;
  }
  get reviewingCount(): number {
    return Object.values(this.progress).filter(
      (p) => p.state === "reviewing",
    ).length;
  }
  get learningCount(): number {
    return Object.values(this.progress).filter((p) => p.state === "learning")
      .length;
  }
  get masteredCount(): number {
    return Object.values(this.progress).filter((p) => p.state === "mastered")
      .length;
  }
  /** 今日到期待复习数量 */
  get dueCount(): number {
    const now = this.now;
    return this.questions.filter((q) => {
      const item = this.progress[q.id];
      return item ? isDue(item, now) : false;
    }).length;
  }

  /**
   * 今天还没补完的「答错后重新连对」数量。
   *
   * 这些卡已经在答错时被推到明天（`nextDue` = 明天），所以不在 `dueCount` 里，
   * 但本轮还没完成——今天重新进复习时必须继续出现。
   */
  get pendingRetryCount(): number {
    const targets = this.retryTargetsToday();
    const ids = Object.keys(targets);
    if (ids.length === 0) return 0;
    return this.questions.filter((q) => targets[q.id] !== undefined).length;
  }

  /**
   * 今天可以进入复习的卡片数：到期的 + 还没补完连对的。
   * 首页入口的可点击性与「今日待复习」统计都用它，否则答错后退出再进来
   * 会因为「到期 0 道」而点不开复习。
   */
  get reviewableCount(): number {
    return this.dueCount + this.pendingRetryCount;
  }

  /**
   * 当前时间（带调试用的天数偏移）。
   * UI 想算「还有几天到期」时必须用这个，不要直接 `Date.now()`——
   * 否则调试里「加一天」之后，界面上的天数不会跟着变。
   */
  get now(): number {
    return this.fixedNow ? this.fixedNow() : devNow(this.debugOffset);
  }

  /** 本轮学习目标（题） */
  get targetPerRound(): number {
    if (this.roundGoal > 0) return this.roundGoal;
    return Math.max(1, this.memorySettings.roundTarget);
  }

  /** 本轮学习已完成多少 / 共多少（进度条用） */
  get roundCompletedCount(): number {
    return Math.min(this.roundMastered, this.targetPerRound);
  }

  /** 复习进度：今天要复习的总题数（没有会话时用当前到期数） */
  get reviewDoneCount(): number {
    return this.reviewedIds.length;
  }

  /** 首页「学习新的题目」这次会学几道 */
  get nextBatchSize(): number {
    return Math.min(
      this.learnableCount,
      this.targetPerRound,
    );
  }

  /**
   * 学习轮的活动池：成员与顺序都保持原样。
   *
   * 复习轮要拿 `activePool` 当到期队列用，所以进复习之前学习池会被原样挪到
   * `appState.learningPool`（落盘），结束时再放回 `activePool`。
   * 所以这里优先读暂存的那一份。
   *
   * 最后那层过滤是给旧版本留下的状态兜底：老版本会直接把到期队列写进
   * `activePool`，没有暂存位，于是复习中的卡会混进来——它们不属于学习轮
   * （否则在学习流里答对它会被当成「刚学会」，把复习阶梯冲回第 1 级）。
   */
  get learningPool(): RuntimeState["activePool"] {
    const pool = this.appState.learningPool ?? this.appState.activePool;
    return pool.filter((item) => {
      const progress = this.progress[item.id];
      return progress === undefined || progress.state === "learning";
    });
  }

  /** 学到一半（活动池里还有没学完的卡），下次点「学习新的题目」接着这一轮继续 */
  get hasOngoingRound(): boolean {
    return this.learningPool.length > 0;
  }

  /**
   * 今天是否已经学完过一轮（`memory.learnedDay` 是不是今天）。
   *
   * 首页据此把「学习」按钮降一档颜色：今天学过一轮之后按钮不再是加重色，
   * 但仍然可以点（点了就是再学一轮）。跨过凌晨 5 点自然失效。
   */
  get learnedToday(): boolean {
    return this.appState.memory?.learnedDay === studyDay(this.now);
  }

  /** 「学习新的题目」还能学几道：没学过的 + 学到一半的 */
  get learnableCount(): number {
    return this.newCount + this.learningCount;
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

  /** 全局设置（跨题库共享，和侧边栏「全局设置」是同一个实例）。 */
  get globalSettings(): GlobalSettings {
    return this.globalSettingsRef.value;
  }

  // ── 会话入口 ────────────────────────────────────────────────────────

  /**
   * 开始「学习新的题目」。
   *
   * 上一轮只要学到一半就接着继续，**一道都没掌握也一样**：中途退出不该丢掉
   * 这一轮，也不该重挑一批题。判断依据是「池子里还有没有没学完的卡」，
   * 不是「已经掌握了几道」。
   */
  startLearning(): void {
    // 把学习轮的活动池放回 `activePool`（如果中途去复习过，池子暂存在
    // `learningPool` 里，成员和顺序都是原样），顺手清掉暂存位。
    const ongoing = this.hasOngoingRound;
    this.appState = {
      ...this.appState,
      activePool: this.learningPool,
      learningPool: undefined,
      pendingIds: [],
    };

    // 这一轮的计数还能不能接着用？
    //  - 池子里还有没学完的卡 → 正常续轮
    //  - 池子被「复习」顶掉过，但这一轮已经掌握了几道 → 计数留着，只把池子放回来
    const keepRound = this.roundGoal > 0 && (ongoing || this.roundMastered > 0);
    if (!keepRound) {
      // 新的一轮：从 0 开始数
      this.roundMastered = 0;
      this.roundGoal = Math.max(1, this.memorySettings.roundTarget);
    } else if (this.roundMastered >= this.roundGoal) {
      // 计数已经到顶就不该再留着，免得进度条卡在「5-5」
      this.roundMastered = 0;
    }

    this.fillActivePool();
    if (this.appState.activePool.length === 0) {
      this.deps.toast("没有新的题目了", "去「复习」里继续吧。");
      return;
    }

    this.run = "learning";
    this.completed = 0;
    this.shownIds = [];
    this.reviewTarget = {};
    this.queue = shuffleArray(
      this.appState.activePool.map((item) => ({ id: item.id })),
    );
    this.selectNext();
  }

  /**
   * 开始「复习」：今天到期的题 + 还没补完连对的题，全部排进本轮队列。
   *
   * 出题顺序一律随机（不再按逾期天数排序）。答错过的卡已经不在「到期」里了，
   * 所以要靠 `state.memory.retry` 把它们捞回来，否则「答错后必须连对 N 次」
   * 一出会话就没了。
   */
  startReview(): void {
    const now = this.now;
    const due = this.questions.filter((q) => {
      const item = this.progress[q.id];
      return item ? isDue(item, now) : false;
    });

    // 答错后还没补完连对的卡：它们仍留在本轮（今天），即使已经不在到期列表里
    const retryTargets = this.retryTargetsToday();
    const dueIds = new Set(due.map((q) => q.id));
    const retryQuestions = this.questions.filter(
      (q) => retryTargets[q.id] !== undefined && !dueIds.has(q.id),
    );

    const queueQuestions = [...due, ...retryQuestions];
    if (queueQuestions.length === 0) {
      this.deps.toast("今天没有需要复习的题目");
      return;
    }

    this.run = "reviewing";
    this.completed = 0;
    this.shownIds = [];
    this.reviewTarget = { ...retryTargets };
    this.reviewedIds = [];
    // 带待办的卡都是本轮答错过的：重新进来后完成连对时同样不许推进掌握阶梯
    // （阶梯已经归零并定在「明天」，推进了就会变成和一次答对一样的间隔）
    this.failedThisRound = Object.keys(retryTargets);
    this.reviewTotal = queueQuestions.length;
    const shuffled = shuffleArray(queueQuestions);
    this.appState = {
      ...this.appState,
      // 复习轮要拿 `activePool` 当到期队列用：学习轮的活动池先原样挪到
      // `learningPool`（成员与顺序都不动，并且落盘），复习结束后放回。
      learningPool: this.learningPool,
      activePool: shuffled.map((q) => ({
        id: q.id,
        consecutiveCorrect: 0,
        hasEverMistaken: false,
        hasBeenShown: false,
        lastSelectedRound: 0,
      })),
    };
    this.save();
    this.syncQueueToPool();
    this.selectNext();
  }

  /** 回到首页。 */
  exitSession(): void {
    this.run = "idle";
    this.queue = [];
    this.currentQuestion = null;
    this.showResult = false;
    this.selectedAnswers = [];
    this.shownIds = [];
    // 活动池与本轮掌握计数都保留：下次「学习新的题目」接着这一轮继续
    this.restoreLearningPool();
    this.save();
  }

  /**
   * 复习结束时把学习轮的活动池放回 `activePool`。
   * 没在复习（或本来就没有暂存的池子）时是空操作。
   */
  private restoreLearningPool(): void {
    const stash = this.appState.learningPool;
    if (stash === undefined) return;
    this.appState = {
      ...this.appState,
      activePool: stash,
      learningPool: undefined,
    };
  }

  // ── 本轮「答错后重新连对」的待办 ────────────────────────────────────
  //
  // 答错时把「这道卡本轮还要连对 N 次」写进 `state.memory.retry`（落盘），
  // 这样中途退出 / 刷新 / 切题库回来时，它还留在本轮里；跨过凌晨 5 点
  // （学习日变了）就自动作废，卡片按常规的「明天重来」走。

  /**
   * 今天仍然有效的「重新连对」要求：题目 id → 还要连对几次。
   *
   * 只认当天的待办，并且卡片必须还在复习中（可能已被重置 / 已掌握）。
   */
  private retryTargetsToday(
    base: RuntimeState = this.appState,
  ): Record<string, number> {
    const retry = base.memory?.retry;
    if (!retry || retry.day !== studyDay(this.now)) return {};

    const targets: Record<string, number> = {};
    for (const [id, target] of Object.entries(retry.targets)) {
      const item = base.memory?.progress[id];
      if (item?.state === "reviewing" && target >= 1) targets[id] = target;
    }
    return targets;
  }

  /** 记下「这道卡本轮还要连对几次」（同一天里重复答错就覆盖）。 */
  private writeRetryTarget(
    memory: MemoryStoredState,
    id: string,
    target: number,
  ): MemoryStoredState {
    const day = studyDay(this.now);
    const previous = memory.retry?.day === day ? memory.retry.targets : {};
    return {
      ...memory,
      retry: { day, targets: { ...previous, [id]: target } },
    };
  }

  /** 本轮复习完成（或重置）后清掉这道卡的待办。 */
  private clearRetryTarget(id: string): void {
    const memory = this.appState.memory;
    const retry = memory?.retry;
    if (!memory || !retry || retry.targets[id] === undefined) return;

    const targets = { ...retry.targets };
    delete targets[id];
    this.appState = {
      ...this.appState,
      memory: this.memorySection(this.appState, {
        retry:
          Object.keys(targets).length === 0
            ? undefined
            : { day: retry.day, targets },
      }),
    };
  }

  // ── 答题流 ──────────────────────────────────────────────────────────

  /**
   * 活动题目池：池子里的题 = 本轮正在练的题；每掌握一题就从「未学习」里补一题进来。
   * 记忆模式不再单独配置池大小，池子容量与本轮目标共用 `roundTarget`。
   */
  private fillActivePool(): void {
    const size = Math.max(1, this.targetPerRound);
    const inPool = new Set(this.appState.activePool.map((item) => item.id));
    const candidates = this.questions.filter((q) => {
      if (inPool.has(q.id)) return false;
      const progress = this.progress[q.id];
      // 没学过的，或者「学到一半但掉在池子外」的卡。后者是旧版「半轮被重置成
      // 新一轮」留下的孤儿：它有 learning 进度、进不了「未学习」，又不在池子里，
      // 不收回来就永远学不到。
      return progress === undefined || progress.state === "learning";
    });
    const room = Math.max(0, size - inPool.size);
    if (room === 0 || candidates.length === 0) return;

    const picked =
      this.appState.settings.selectionMode === "sequential"
        ? candidates.slice(0, room)
        : shuffleArray(candidates).slice(0, room);

    const added = picked.map((q) => ({
      id: q.id,
      // 学到一半被收回来的卡要接着之前的连对次数数，不能从 0 开始
      consecutiveCorrect: this.progress[q.id]?.streak ?? 0,
      hasEverMistaken: false,
      hasBeenShown: false,
      lastSelectedRound: 0,
    }));
    const addedQueue = shuffleArray(added).map((item) => ({ id: item.id }));
    this.appState = {
      ...this.appState,
      activePool: [...this.appState.activePool, ...added],
    };
    // 新补进来的题加入本轮队列，同样随机出题
    this.queue = [...this.queue, ...addedQueue];
  }

  /**
   * 选下一题；队列空了就结束本次会话。
   *
   * 队列和 `activePool` 必须保持一致：卡片毕业（进入复习中）后就会离开
   * activePool，所以这里跳过已经不在池子里的题，避免刚毕业的卡又被抽出来。
   */
  selectNext(): void {
    const next = this.queue[0];
    if (!next) {
      this.finishSession();
      return;
    }

    const inPool = this.appState.activePool.some(
      (item) => item.id === next.id,
    );
    const question = inPool
      ? (this.questions.find((q) => q.id === next.id) ?? null)
      : null;

    if (!question) {
      this.queue = this.queue.slice(1);
      this.selectNext();
      return;
    }

    this.currentQuestion = question;
    this.presentationSeq += 1;
    this.showResult = false;
    this.answerKind = "know";
    this.isCorrect = false;
    this.selectedAnswers = [];
    this.preSubmitState = null;
    this.resetCopyQuestionStatus();
    this.markAsShown(question.id);
  }

  /** 记忆题型的「提交」= 用自评结果（知道 / 模糊 / 忘记）结算这一道卡。 */
  submit(): void {
    const question = this.currentQuestion;
    if (!question || this.showResult || this.selectedAnswers.length === 0) {
      return;
    }

    const kind = memoryAnswerKind(this.selectedAnswers[0]);
    this.answerKind = kind;
    // 「模糊」不算答错：答案卡片保持正常配色，反馈音 / 闪烁也按「没答错」处理
    this.isCorrect = kind !== "forget";
    this.showResult = true;

    this.preSubmitState = this.appState;
    this.appState = this.applyMemoryAnswer(question, kind);
    this.save();

    this.deps.flash(this.isCorrect);
    maybePlayAnswerSound(this.globalSettings, this.deps.sound, this.isCorrect);
  }

  /**
   * 答案页的降级操作：把刚才的自评改判成更差的一档。
   *
   * 和刷题模式的「视作正确」是一对反向操作：
   *   - 刷题模式：答错 → 点它 → 改成答对
   *   - 记忆模式：点「知道」显示答案后发现自己没记住 → 点「模糊」/「记错了」
   *
   * 两者都基于 `preSubmitState`（提交前的状态）重算，所以反复改判不会叠加。
   */
  private downgradeAnswer(kind: MemoryAnswerKind): void {
    const question = this.currentQuestion;
    if (!question || !this.showResult || !this.preSubmitState) return;

    this.answerKind = kind;
    this.isCorrect = kind !== "forget";
    this.appState = this.applyMemoryAnswer(question, kind, this.preSubmitState);
    this.save();
    this.deps.flash(this.isCorrect);
    maybePlayAnswerSound(this.globalSettings, this.deps.sound, this.isCorrect);
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
        this.requeue(question.id);
        return;
      }
      this.graduateInLearning(question.id);
      return;
    }

    // 复习流：本轮「复习完成」= 连对到本轮目标次数（默认 1，答错后是 N）。
    const progress = this.appState.memory?.progress[question.id];
    const target = this.reviewTarget[question.id] ?? 1;
    const streak = progress?.streak ?? 0;
    if (streak < target) {
      this.requeue(question.id);
      return;
    }

    // 连对达标 = 「这一轮复习完成」。它不等于「掌握」：
    //   - 本轮没失败过 → 正常推进掌握阶梯（走完 M → 已掌握）
    //   - 本轮失败过   → 阶梯已经归零并定在「明天」，本轮完成不再推进，
    //                    否则答错那道的间隔会被推成和答对一样（bug 根因）
    if (!this.failedThisRound.includes(question.id)) {
      this.appState = this.advanceMastery(question.id);
    } else {
      // 本轮失败过：阶梯已经归零（明天重来），把轮内连对清零，
      // 避免「明天复习时 streak 从 3 继续数」这种歧义
      const item = this.progress[question.id];
      if (item && item.streak !== 0) {
        this.appState = {
          ...this.appState,
          memory: this.writeProgress(this.appState, question.id, {
            ...item,
            streak: 0,
          }),
        };
      }
    }
    delete this.reviewTarget[question.id];
    // 这一道的本轮要求补完了：清掉落盘的待办，并立刻把阶梯 / streak 写下去
    // （「下一题」之后再关页面不该丢掉这次推进）
    this.clearRetryTarget(question.id);
    this.markReviewed(question.id);
    this.save();
    this.dropCurrent();
  }

  /**
   * 学习模式：这一题学会了 → 记入本轮、补一道新题进活动池；
   * 本轮掌握数达到目标就结束这一轮。
   */
  private graduateInLearning(id: string): void {
    this.roundMastered += 1;
    this.shownIds = this.shownIds.filter((x) => x !== id);
    this.completed += 1;

    // 出队 + 把队列里已经离开活动池的题清掉
    this.queue = this.queue
      .slice(1)
      .filter((item) =>
        this.appState.activePool.some((poolItem) => poolItem.id === item.id),
      );

    this.fillActivePool();
    // 本轮计数与补进来的新卡都要立刻落盘，否则紧接着关页面会少算一道
    this.save();

    if (this.roundMastered >= this.targetPerRound) {
      this.finishLearningRound();
      return;
    }

    this.selectNext();
  }

  /**
   * 结束本轮学习。
   *
   * `exhausted = true` 表示是「题库里没有更多新卡了」导致的收尾（而不是学满了
   * `roundTarget`）：这时不该报成功，否则用户会看到绿色的「本轮学习完成 ·
   * 已掌握 2 / 5 题」。
   */
  private finishLearningRound(exhausted = false): void {
    const mastered = this.roundMastered;
    const target = this.targetPerRound;
    this.roundMastered = 0;
    this.roundGoal = 0;
    this.run = "idle";
    this.currentQuestion = null;
    this.queue = [];
    this.showResult = false;
    this.selectedAnswers = [];
    this.appState = {
      ...this.appState,
      memory: this.memorySection(this.appState, {
        // 首页靠它把学习按钮降一档颜色（今天学过一轮了）
        learnedDay: studyDay(this.now),
      }),
      activePool: this.endRoundPool(),
    };
    this.save();

    if (exhausted && mastered < target) {
      this.deps.toast(
        "这一轮学完了",
        `已掌握 ${mastered} / ${target} 题，题库里没有更多新卡片了。`,
      );
      return;
    }

    this.deps.toast(
      "本轮学习完成",
      `已掌握 ${mastered} / ${target} 题。`,
      "success",
    );
    maybePlaySuccessSound(this.globalSettings, this.deps.sound);
  }

  /** 一轮结束时：只在还没学完的题里保留活动池，学完就清空 */
  private endRoundPool(): RuntimeState["activePool"] {
    const stillUnlearned = this.questions.some(
      (q) => this.progress[q.id] === undefined,
    );
    return stillUnlearned ? this.appState.activePool : [];
  }

  private markReviewed(id: string): void {
    if (this.reviewedIds.includes(id)) return;
    this.reviewedIds = [...this.reviewedIds, id];
  }

  /** 排到队尾（学习流没连对够时用）。 */
  private requeue(id: string): void {
    this.queue = [...this.queue.slice(1), { id }];
    this.selectNext();
  }

  /**
   * 推进掌握阶梯：level +1，间隔按 `2^(level-1)` 天安排；
   * 超过掌握阈值 M 就变成「已掌握」，level / streak 一起清零。
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

  /** 出队并计入本轮完成数。 */
  private dropCurrent(): void {
    this.queue = this.queue.slice(1);
    this.completed += 1;
    this.selectNext();
  }

  // ── 状态变迁 ────────────────────────────────────────────────────────

  /**
   * 把一次自评写进 `RuntimeState`。
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

      if (kind === "fuzzy") {
        // 模糊：掌握阶梯退一级（不清零），本轮照「忘记」处理——目标提到 N、
        // 计入本轮已复习、完成时也不推进阶梯（否则退掉的这一级立刻又被加回来）
        this.reviewTarget = {
          ...this.reviewTarget,
          [question.id]: this.streakToLearn,
        };
        if (!this.failedThisRound.includes(question.id)) {
          this.failedThisRound = [...this.failedThisRound, question.id];
        }
        this.markReviewed(question.id);
        return {
          ...base,
          activePool,
          memory: this.writeRetryTarget(
            this.writeProgress(
              base,
              question.id,
              fuzzyReview(item, this.now),
            ),
            question.id,
            this.streakToLearn,
          ),
          currentRound: base.currentRound + 1,
        };
      }

      if (kind === "forget") {
        // 忘记了：掌握阶梯归零（明天从 1 天重来），本轮连对清零，
        // 并且这道卡在本轮需要连对 N 次才算复习完——这个要求同时落盘，
        // 中途退出 / 刷新后重新进复习时它还会回到本轮（见 `retryTargetsToday`）。
        this.reviewTarget = {
          ...this.reviewTarget,
          [question.id]: this.streakToLearn,
        };
        if (!this.failedThisRound.includes(question.id)) {
          this.failedThisRound = [...this.failedThisRound, question.id];
        }
        // 这道今天已经处理过了（之后还会再出现几次也不算新的一题），
        // 进度条与「今日已复习」都要认它
        this.markReviewed(question.id);
        return {
          ...base,
          activePool,
          memory: this.writeRetryTarget(
            this.writeProgress(
              base,
              question.id,
              resetReview(item, this.now),
            ),
            question.id,
            this.streakToLearn,
          ),
          currentRound: base.currentRound + 1,
        };
      }

      // 答对：只累加「本轮连对次数」，不碰掌握阶梯。
      // 阶梯的推进放在连对达标（本轮复习完成）那一步。
      const streak = (item.streak ?? 0) + 1;
      return {
        ...base,
        activePool,
        memory: this.writeProgress(base, question.id, {
          ...item,
          streak,
        }),
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
   * 让 `masteredIds` 与 `memory.progress` 保持一致。
   *
   * 记忆模式以 `progress[].state === "mastered"` 为准，`masteredIds` 只是它的
   * 投影（导出文件名会数这个数量）。载入 / 导入进度时同步一次，免得出现
   * 「进度里明明有已掌握的卡，文件名却写 (0 of N)」这种自相矛盾。
   */
  private withSyncedMasteredIds(state: RuntimeState): RuntimeState {
    if (!state.memory) return state;
    const masteredIds = Object.entries(state.memory.progress)
      .filter(([, item]) => item.state === "mastered")
      .map(([id]) => id);
    return { ...state, masteredIds };
  }

  /**
   * 生成一份新的 `memory` 段：patch 里没写到的字段原样保留。
   *
   * `memory` 段每次都是整体重建的，漏掉哪个字段就会在下次 `save()` 时把它抹掉
   * （设置、本轮待办、今天学过一轮的标记都踩过这个坑），所以只走这一个出口。
   */
  private memorySection(
    base: RuntimeState,
    patch: Partial<MemoryStoredState>,
  ): MemoryStoredState {
    const current = base.memory;
    return {
      progress: patch.progress ?? current?.progress ?? {},
      settings:
        patch.settings ?? current?.settings ?? createDefaultMemorySettings(),
      retry: "retry" in patch ? patch.retry : current?.retry,
      learnedDay: "learnedDay" in patch ? patch.learnedDay : current?.learnedDay,
    };
  }

  /** 写一条进度，并原样保住 `memory` 段里的其它字段。 */
  private writeProgress(
    base: RuntimeState,
    id: string,
    progress: MemoryProgress,
  ): MemoryStoredState {
    return this.memorySection(base, {
      progress: { ...(base.memory?.progress ?? {}), [id]: progress },
    });
  }

  private finishSession(): void {
    const learned = this.completed;
    const run = this.run;

    // 学习池可能因为题库已没有未学习卡片而自然耗尽，此时即使目标数
    // 尚未达到，也要正常收尾并清掉本轮计数，不能留下一个下次会被重置的
    //“半轮”状态。`exhausted = true` 让收尾文案不谎报「已掌握满 X 题」。
    if (run === "learning" && this.newCount === 0) {
      this.finishLearningRound(true);
      return;
    }

    this.run = "idle";
    this.currentQuestion = null;
    this.showResult = false;
    this.selectedAnswers = [];
    this.queue = [];
    // 复习轮的到期队列用完就丢掉，同时把学习轮的活动池放回来
    // （复习期间它暂存在 `learningPool` 里）
    this.appState = {
      ...this.appState,
      activePool: this.appState.learningPool ?? [],
      learningPool: undefined,
    };
    this.save();
    this.deps.toast(
      run === "reviewing" ? "本轮复习完成" : "本轮学习完成",
      run === "reviewing"
        ? `共复习 ${learned} 道卡片。`
        : `共学会 ${learned} 道卡片，明天开始复习。`,
      "success",
    );
    maybePlaySuccessSound(this.globalSettings, this.deps.sound);
  }

  private resetCopyQuestionStatus(): void {
    if (this.copyQuestionResetTimer) {
      clearTimeout(this.copyQuestionResetTimer);
      this.copyQuestionResetTimer = null;
    }
    this.copyQuestionStatus = "idle";
  }

  private markAsShown(id: string): void {
    if (this.shownIds.includes(id)) return;
    this.shownIds = [...this.shownIds, id];
  }

  private syncQueueToPool(): void {
    this.queue = this.appState.activePool.map((item) => ({ id: item.id }));
  }

  // ── 设置 / 全局设置 ─────────────────────────────────────────────────

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

  toggleSound(): void {
    setSoundEnabledPreference(
      this.globalSettings,
      !this.globalSettings.soundEnabled,
      () => this.globalSettingsRef.persist(),
      this.deps.toast,
      this.deps.sound,
    );
  }

  /** 重置记忆模式进度（保留设置）；调试用的时间偏移一并清零。 */
  reset(): void {
    if (this.debugOffset !== 0) this.debugResetDays();
    this.appState = buildRuntimeState(this.questions, {
      ...createEmptyState(),
      settings: this.appState.settings,
      memory: {
        progress: {},
        settings: this.memorySettings,
      },
    });
    // 本轮计数是会话字段，换掉 appState 不会自动清：留着会让下一轮从旧的
    // 「已掌握 X / Y」接着数，只学几道就提前结束本轮
    this.roundMastered = 0;
    this.roundGoal = 0;
    this.exitSession();
    this.save();
  }

  // ── 复制当前题目（沿用题型的 formatCopyText） ────────────────────────

  async copyCurrentQuestion(
    options: CopyQuestionOptions = {},
  ): Promise<boolean> {
    const question = this.currentQuestion;
    if (!question) return false;
    const result = await this.copyQuestion(question, options);
    return result === "copied";
  }

  /**
   * 复制任意一道题（总览列表的复制按钮走这里）。
   *
   * 与 `QuizSession.copyQuestion` **同名同签名**（`options` + `pattern`），
   * 这样两个 session 都能直接喂给 `QuestionCopyStatusStore`。
   * `options.announce` 为真时（快捷键触发）才弹 toast；按钮触发靠
   * `copyQuestionStatus` 表现，和刷题模式一致。
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

    try {
      await writeText(typeDef.formatCopyText(question, context, pattern));
      this.copyQuestionStatus = "copied";
      this.resetCopyQuestionStatusLater();
      if (options.announce) {
        this.deps.toast(
          "题目已复制到剪贴板",
          "可直接粘贴到任意位置。",
          "success",
        );
      }
      return "copied";
    } catch {
      this.copyQuestionStatus = "error";
      this.resetCopyQuestionStatusLater();
      if (options.announce) {
        this.deps.toast(
          "复制失败",
          "当前浏览器不允许写入剪贴板。",
          "destructive",
        );
      }
      return "error";
    }
  }

  /** 和刷题模式一样：复制状态展示 1.8 秒后回到 idle。 */
  private resetCopyQuestionStatusLater(): void {
    if (this.copyQuestionResetTimer) {
      clearTimeout(this.copyQuestionResetTimer);
    }
    this.copyQuestionResetTimer = setTimeout(() => {
      this.copyQuestionStatus = "idle";
      this.copyQuestionResetTimer = null;
    }, 1800);
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

  async exportProgress(): Promise<void> {
    if (this.exportStatus !== "idle") return;
    const result = await copyProgressToClipboard(
      this.appState,
      this.hash,
      this.questions,
    );
    if (result.ok) {
      this.exportStatus = "copied";
      setTimeout(
        () => (this.exportStatus = "idle"),
        EXPORT_STATUS_SUCCESS_RESET_MS,
      );
      this.deps.toast("进度已复制到剪贴板", "粘贴到任意位置即可备份。", "success");
      maybePlaySuccessSound(this.globalSettings, this.deps.sound);
    } else {
      this.exportStatus = "error";
      setTimeout(
        () => (this.exportStatus = "idle"),
        EXPORT_STATUS_ERROR_RESET_MS,
      );
      this.deps.toast("导出失败", result.error, "destructive");
    }
  }

  async startImport(): Promise<void> {
    const result = await readProgressFromClipboard();
    if (!result.ok) {
      this.deps.toast("无法导入", result.error, "destructive");
      return;
    }
    const parsed = await parseImportedProgress(
      result.text,
      this.hash,
      this.questions,
    );
    if (!parsed.ok) {
      this.deps.toast("导入失败", parsed.error, "destructive");
      return;
    }
    this.appState = this.withSyncedMasteredIds(
      buildRuntimeState(this.questions, {
        ...parsed.state,
        memory: parsed.state.memory ?? {
          progress: {},
          settings: this.memorySettings,
        },
      }),
    );
    // 备份里不带「本轮」的短周期状态（见 AGENTS.md），所以导入后必须按新一轮
    // 重新开始：否则旧的 roundMastered 会叠到导入的进度上，几道就结束本轮
    this.roundMastered = 0;
    this.roundGoal = 0;
    this.exitSession();
    this.deps.toast("进度已导入", "已覆盖当前进度。", "success");
    maybePlaySuccessSound(this.globalSettings, this.deps.sound);
  }

  // ── 持久化 ──────────────────────────────────────────────────────────

  private save(): void {
    saveState(this.hash, {
      masteredIds: this.appState.masteredIds,
      masteredMistakes: this.appState.masteredMistakes ?? {},
      activePool: this.appState.activePool,
      currentRound: this.appState.currentRound,
      filterType: this.appState.filterType,
      settings: this.appState.settings,
      ui: this.appState.ui,
      memory: this.appState.memory,
      roundMastered: this.roundMastered,
      roundGoal: this.roundGoal,
      // 复习期间暂存的学习轮活动池
      learningPool: this.appState.learningPool,
    });
  }

  private loadState(
    stored: ReturnType<typeof loadStoredState>,
  ): RuntimeState {
    // 本轮的「重新连对」待办只保留今天的：昨天写下的要求今天已经没意义
    // （那道卡今天本来就会到期，答对一次即过）
    const today = studyDay(this.now);
    // 展开原段再覆盖要净化的字段：以后 `memory` 加字段时不会被这里悄悄抹掉
    const memory = stored.memory
      ? {
          ...stored.memory,
          progress: normalizeMemoryProgressMap(stored.memory.progress),
          settings: sanitizeMemorySettings(stored.memory.settings),
          retry: normalizeMemoryRetry(stored.memory.retry, today),
        }
      : { progress: {}, settings: createDefaultMemorySettings() };
    return this.withSyncedMasteredIds(
      buildRuntimeState(this.questions, {
        ...stored,
        memory,
      }),
    );
  }
}

function createEmptyState(): StoredState {
  return {
    masteredIds: [],
    masteredMistakes: {},
    activePool: [],
    currentRound: 0,
    filterType: "all",
    settings: createDefaultBankSettings(),
    ui: { progressFocused: false, showPool: false },
  };
}

function shuffleArray<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** 复习间隔（天），供 UI 文案使用。 */
export { memoryIntervalDays };
