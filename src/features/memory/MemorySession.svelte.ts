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
  GlobalSettings,
  MemoryBankSettings,
  MemoryProgress,
  MemoryProgressMap,
  MemoryQuestion,
  MemoryReviewState,
  MemoryRoundState,
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
  addMemoryRoundCards,
  createMemoryRound,
  isMemoryRoundComplete,
  markMemoryRoundMastered,
  memoryRoundDone,
  memoryRoundRemaining,
  pruneMemoryRound,
} from "@/features/memory/round";
import { nextRev, revOf } from "@/lib/rev";
import {
  normalizeMemoryProgressMap,
  normalizeMemoryRetry,
  normalizeMemoryReview,
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
  COPY_STATUS_RESET_MS,
  EXPORT_STATUS_ERROR_RESET_MS,
  EXPORT_STATUS_SUCCESS_RESET_MS,
} from "@/config";
import {
  maybePlayAnswerSound,
  maybePlaySuccessSound,
} from "@/sound";
import {
  toggleAutoNextPreference,
  toggleSoundPreference,
} from "@/features/globalSettingsActions";
import type { Toast } from "@/features/toast.svelte";
import type { SoundPlayer } from "@/sound/types";

export type MemoryRun = "idle" | "learning" | "reviewing";

export interface MemorySessionDeps {
  flash(isCorrect: boolean): void;
  toast: Toast;
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
   * 当前的学习轮（`null` = 没有进行中的一轮）。
   *
   * **本轮的唯一真相**：目标、这一批、已掌握都在这里，池子是它的投影。
   * 落盘为 `StoredState.round`，学到一半退出 / 刷新都能续上；
   * 「结束本轮」= 置 `null`。
   */
  round: MemoryRoundState | null = $state(null);
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
  /**
   * 复习：今天这一轮的总题数（进度条分母）。
   *
   * 与 `reviewedIds` 一起**落盘**（`state.memory.review`）：复习轮同样可以中断续做，
   * 中途退出 / 刷新后重新进来，进度条该接着数而不是从 0 / N 重来。
   * 开轮时定下，中途不变——答错补进来的卡不该把分母撑大。
   */
  reviewTotal = $state(0);
  /**
   * 复习：今天已经复习完的题（每过一题就加进来，进度条靠它变绿）。
   *
   * 落盘的那一份在 `state.memory.review.reviewedIds`，跨过凌晨 5 点自动作废。
   */
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
  /**
   * 进度备份导入：待二次确认的文本（`null` = 没有待确认的导入）。
   *
   * 与 `QuizSession` 同名同语义——导入会覆盖全部进度，必须先问一次；
   * 弹窗由 `ImportProgressDialog` 渲染。
   */
  importConfirmText: string | null = $state(null);
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
    // 进行中的一轮（如果有）：目标 / 这一批 / 已掌握整份读回来
    this.round = this.appState.round ?? null;
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
   *
   * **直接数 `reviewQueueToday()` 的长度**，不再自己拼一遍「到期 + 待补」——
   * 首页这个数字与「复习」入口的队列必须是同一个判据，否则会出现
   * 「首页说还有 12 道，点进去却说今天没有需要复习的题目」（真踩过）。
   * 这里多算一次队列很便宜（题量级的一次 filter），换来的是两边不会各说各话。
   */
  get reviewableCount(): number {
    return this.reviewQueueToday().length;
  }

  /**
   * 当前时间（带调试用的天数偏移）。
   * UI 想算「还有几天到期」时必须用这个，不要直接 `Date.now()`——
   * 否则调试里「加一天」之后，界面上的天数不会跟着变。
   */
  get now(): number {
    return this.fixedNow ? this.fixedNow() : devNow(this.debugOffset);
  }

  /**
   * 本轮学习目标（题）。
   *
   * 有进行中的一轮就用**那一轮的目标**（开轮时定下，中途改设置不影响它）；
   * 没有就用设置里的 `roundTarget`（首页「每轮 N 道」的文案）。
   */
  get targetPerRound(): number {
    if (this.round) return this.round.goal;
    return Math.max(1, this.memorySettings.roundTarget);
  }

  /** 本轮已经掌握了几道（UI / 测试都用它，读的是轮模型） */
  get roundMastered(): number {
    return this.round ? memoryRoundDone(this.round) : 0;
  }

  /** 本轮目标；没有进行中的一轮时是 0（`MemoryHome` 据此判断「是不是在续轮」） */
  get roundGoal(): number {
    return this.round?.goal ?? 0;
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
   * 学到一半（这一轮还有没学完的卡），下次点「学习新的题目」接着这一轮继续。
   *
   * 判据是**轮模型里还剩几道能学的**，不是「池子里有没有条目」——池子只是轮的
   * 投影，复习期间它还被借去当到期队列了（以前用池子判断，于是「学完一轮后去
   * 复习」会让首页以为还有半轮）。
   */
  get hasOngoingRound(): boolean {
    const round = this.round;
    if (!round) return false;
    return memoryRoundRemaining(round).some((id) => this.isLearnable(id));
  }

  /** 这道卡还能学吗（没学过，或者学到一半）。与 `poolCandidates` 同一份判据。 */
  private isLearnable(id: string): boolean {
    const progress = this.progress[id];
    return progress === undefined || progress.state === "learning";
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
   * 两种情况，判据只有一条：**轮模型里还有没有没学完的卡**。
   *   - 有 → 续这一轮（池子按轮重建，复习期间它被借去当到期队列了）
   *   - 没有 → 开新的一轮：挑一批卡，目标取「设置」与「这一批有几道」的小值
   *
   * 目标必须在这里收敛（`createMemoryRound` 负责），否则就会出现
   * 「设置 5 题、题库只剩 3 道可学、学到第 3 道突然收尾」——用户报的那条。
   */
  startLearning(): void {
    if (!this.hasOngoingRound) {
      // 旧的一轮（如果还有残留）作废：新的一轮就是新的一批、新的目标
      this.round = this.pickRound();
      if (!this.round) {
        this.deps.toast("没有新的题目了", "去「复习」里继续吧。");
        return;
      }
    }

    // 池子 = 轮里还没学完的卡（顺序与 `cardIds` 一致）。
    // 复习轮借 `activePool` 当到期队列，所以**每次进学习都要重建一次**。
    this.syncPoolToRound();
    if (this.appState.activePool.length === 0) {
      this.deps.toast("没有新的题目了", "去「复习」里继续吧。");
      this.round = null;
      return;
    }

    this.run = "learning";
    this.completed = 0;
    this.shownIds = [];
    this.reviewTarget = {};
    this.queue = shuffleArray(
      this.appState.activePool.map((item) => ({ id: item.id })),
    );
    // 开轮这一步也要落盘：这一批是谁、目标几道，都是刚定下的，不写下去
    // 的话「开轮后立刻刷新 / 切题库」会读回上一份状态
    this.save();
    this.selectNext();
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
   * 这里刻意**不看** `memory.review.reviewedIds`：那份清单只回答「进度条的分子
   * 现在是多少」，不回答「这道卡今天还能不能练」。之前拿它把卡踢出队列，于是
   * 「到期 12 道、其中 12 道今天已经复习过」时首页说还有 12 道、点进来却是
   * 「今天没有需要复习的题目」——两个入口各说各话（真踩过，用户直接点不开复习）。
   *
   * 到期就得能复习：今天的卡今天想再过一遍是完全正常的需求，分母会跟着长
   * （见 `startReview` 里 `reviewTotal` 的算法）。
   */
  private reviewQueueToday(): MemoryQuestion[] {
    const now = this.now;
    const due = this.questions.filter((q) => {
      const item = this.progress[q.id];
      return item ? isDue(item, now) : false;
    });

    // 答错后还没补完连对的卡：它们已经不在「到期」里了（`nextDue` 被推到明天），
    // 但仍留在本轮（今天），否则「答错后必须连对 N 次」一出会话就没了
    const retryTargets = this.retryTargetsToday();
    const dueIds = new Set(due.map((q) => q.id));
    const retryQuestions = this.questions.filter(
      (q) => retryTargets[q.id] !== undefined && !dueIds.has(q.id),
    );

    return [...due, ...retryQuestions];
  }

  /**
   * 开始「复习」：今天到期的题 + 还没补完连对的题，全部排进本轮队列。
   *
   * 出题顺序一律随机（不再按逾期天数排序）。
   *
   * **进度条的计数跨会话保留**（`state.memory.review`）：今天已经复习过 5 道，
   * 退出再进来仍是 5 / N，而不是从 0 重来。那份额外的清单只用来算数，
   * 不参与「谁进队列」——见 `reviewQueueToday()`。
   */
  startReview(): void {
    const retryTargets = this.retryTargetsToday();
    const queueQuestions = this.reviewQueueToday();

    if (queueQuestions.length === 0) {
      this.deps.toast("今天没有需要复习的题目");
      return;
    }

    // 今天已经复习过的那一份（进度条分子；隔天会被净化掉）
    const stored = this.storedReviewToday();
    const reviewedBefore = stored?.reviewedIds ?? [];

    this.run = "reviewing";
    this.completed = 0;
    this.shownIds = [];
    this.reviewTarget = { ...retryTargets };
    // 进度条的两个数：
    //   分子 = 今天已经复习过的（跨会话保留，退出再进来接着数）
    //   分母 = 今天这一轮总共要过几道。**开轮时就按当前队列定下并落盘**，
    //          中途不因为答错补回来几张卡就变大（否则进度条永远追不上）；
    //          重进时取「存下来的 total」与「这一轮实际要过的题」的较大值——
    //          到期数变了（例如今天又到期了新卡）时分母跟着长，不会画出「6 / 5」
    const queueIds = new Set(queueQuestions.map((q) => q.id));
    this.reviewedIds = [...reviewedBefore];
    this.reviewTotal = Math.max(
      stored?.total ?? 0,
      new Set([...reviewedBefore, ...queueIds]).size,
    );
    // 带待办的卡都是本轮答错过的：重新进来后完成连对时同样不许推进掌握阶梯
    // （阶梯已经归零并定在「明天」，推进了就会变成和一次答对一样的间隔）
    this.failedThisRound = Object.keys(retryTargets);
    const shuffled = shuffleArray(queueQuestions);
    this.appState = {
      ...this.appState,
      // 复习轮借 `activePool` 当到期队列用。学习轮不需要另存一份：
      // 它随时能由 `round`（`cardIds - masteredIds`）重建，
      // 回到学习时 `startLearning` 会调 `syncPoolToRound()` 恢复。
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

  /**
   * 今天那一份复习进度（已复习清单 + 分母）；今天还没进过复习时是 null。
   *
   * 隔天 / 结构非法的数据由 `normalizeMemoryReview` 在载入时丢掉，
   * 所以这里只管读。
   */
  private storedReviewToday(): MemoryReviewState | null {
    const review = this.appState.memory?.review;
    if (!review || review.day !== studyDay(this.now)) return null;
    return review;
  }

  /**
   * 记一道「今天复习过了」（进度条靠它变绿），返回这道加入之后的清单快照。
   *
   * 判分流要的是**快照**而不是直接改 `appState`：它随后会用 `writeProgress` /
   * `writeRetryTarget` 重建整个 `memory` 段，从 `base` 展开——先改 `appState`
   * 会被那一步覆盖（真踩过：答错后退出，`memory.review` 整个丢了，重进来
   * 进度条又变 0 / N）。所以这里只动 `reviewedIds`，清单由调用方写进那一次
   * `memory` 段里（`withReview`）。
   *
   * 不走判分流的路径（「下一题」结算、总览里标熟）用 `markReviewedAndSave()`
   * ——那里没有别的东西要一起写，直接落进 `appState` 更省事。
   */
  private reviewSnapshot(id: string): MemoryReviewState | undefined {
    if (!this.reviewedIds.includes(id)) {
      this.reviewedIds = [...this.reviewedIds, id];
    }
    return this.reviewSectionFor(this.reviewedIds);
  }

  /** 记一道已复习，并**直接写进 `appState`**（调用方之后照常 `save()`）。 */
  private markReviewedAndSave(id: string): void {
    this.reviewedIds = this.reviewedIds.includes(id)
      ? this.reviewedIds
      : [...this.reviewedIds, id];
    this.appState = {
      ...this.appState,
      memory: this.memorySection(this.appState, {
        review: this.reviewSectionFor(this.reviewedIds),
      }),
    };
  }

  /**
   * 今天的复习清单的快照。
   *
   * 分母 `total` 是**开轮时**定下的那个数，不跟着补进来的卡涨；
   * 隔天 / 结构非法的数据由 `normalizeMemoryReview` 在载入时丢掉。
   */
  private reviewSectionFor(
    reviewedIds: string[],
  ): MemoryReviewState | undefined {
    if (reviewedIds.length === 0) return undefined;
    return {
      day: studyDay(this.now),
      reviewedIds: [...reviewedIds],
      total: Math.max(this.reviewTotal, reviewedIds.length),
    };
  }

  /** 回到首页。 */
  exitSession(): void {
    this.run = "idle";
    this.queue = [];
    this.currentQuestion = null;
    this.showResult = false;
    this.selectedAnswers = [];
    this.shownIds = [];
    // 这一轮整个留着（`round` 不动）：下次「学习新的题目」接着这一轮继续。
    // 池子不用特意放回 `activePool`——`startLearning` 会按 `round` 重建。
    this.save();
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
    this.appState = this.withSyncedMasteredIds({
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

    this.queue = this.queue.filter((item) => item.id !== id);
    this.shownIds = this.shownIds.filter((shown) => shown !== id);
    this.failedThisRound = this.failedThisRound.filter((other) => other !== id);
    if (id in this.reviewTarget) {
      const rest = { ...this.reviewTarget };
      delete rest[id];
      this.reviewTarget = rest;
    }
    this.clearRetryTarget(id);
    if (this.run === "reviewing" && inRound) this.markReviewedAndSave(id);

    // 学习轮少了一张就补一张进来：池子始终是满的（与 `graduateInLearning` 同一条规矩）
    if (this.run === "learning") {
      this.refillRound();
      this.syncPoolToRound();
    }
    this.save();

    // 标熟也可能正好把这一轮凑满（在总览里连点几下）：照常收尾
    if (this.run === "learning" && this.round && isMemoryRoundComplete(this.round)) {
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

    this.queue = [];
    this.currentQuestion = null;
    this.showResult = false;
    this.selectedAnswers = [];
    this.shownIds = [];
    this.reviewTarget = {};
    this.round = null;
    this.run = "idle";
    this.appState = {
      ...this.appState,
      activePool: [],
      memory: this.clearLearningStreaks(),
    };
    // 这里**不写** `learnedDay`：没学完的一轮不算「今天学过一轮」，
    // 首页的学习入口该保持高亮（和 `exitSession` 同一口径）
    this.save();
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
    this.queue = [
      ...this.queue,
      ...shuffleArray(picked.map((q) => ({ id: q.id }))),
    ];
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
      : shuffleArray(candidates);
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

    // 「答对自动下一题」是全局设置（⌘N 切换）：刷题模式在 submit 末尾做同一件事，
    // 记忆模式的「答对」= 自评「知道」。
    if (this.globalSettings.autoNextOnCorrect && this.isCorrect) {
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
    this.markReviewedAndSave(question.id);
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
    this.shownIds = this.shownIds.filter((x) => x !== id);
    this.completed += 1;

    // 出队 + 把队列里已经离开活动池的题清掉
    this.queue = this.queue
      .slice(1)
      .filter((item) =>
        this.appState.activePool.some((poolItem) => poolItem.id === item.id),
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
    maybePlaySuccessSound(this.globalSettings, this.deps.sound);
  }

  /** 排到队尾（学习流没连对够时用）。 */
  private requeue(id: string): void {
    this.queue = [...this.queue.slice(1), { id }];
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
        const review = this.reviewSnapshot(question.id);
        return {
          ...base,
          activePool,
          memory: this.withReview(
            this.writeRetryTarget(
              this.writeProgress(
                base,
                question.id,
                fuzzyReview(item, this.now),
              ),
              question.id,
              this.streakToLearn,
            ),
            review,
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
        const review = this.reviewSnapshot(question.id);
        return {
          ...base,
          activePool,
          memory: this.withReview(
            this.writeRetryTarget(
              this.writeProgress(
                base,
                question.id,
                resetReview(item, this.now),
              ),
              question.id,
              this.streakToLearn,
            ),
            review,
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
      review: "review" in patch ? patch.review : current?.review,
      learnedDay: "learnedDay" in patch ? patch.learnedDay : current?.learnedDay,
    };
  }

  /**
   * 写一条进度，并原样保住 `memory` 段里的其它字段。
   *
   * **这里是进度写入的唯一收口，也是唯一盖修订戳的地方**（见 `src/lib/rev.ts`）。
   * 盖戳的基准取"本机见过的同一条卡的最大戳"（本地那份与本次要写的那份取大），
   * 这样本机钟慢于对端时，本机的新改动也不会被判成旧改动。
   *
   * 注意：**从云端拉回来 / 合并出来的那份不走这里**（`sync/apply` 直接落盘），
   * 否则两台设备各盖各的戳，同样的内容会算出不同状态，永远收敛不了。
   */
  private writeProgress(
    base: RuntimeState,
    id: string,
    progress: MemoryProgress,
  ): MemoryStoredState {
    const stamped: MemoryProgress = {
      ...progress,
      rev: nextRev(Date.now(), Math.max(revOf(base.memory?.progress?.[id]), revOf(progress))),
    };
    return this.memorySection(base, {
      progress: { ...(base.memory?.progress ?? {}), [id]: stamped },
    });
  }

  /**
   * 把今天的复习清单并进一份刚重建的 `memory` 段。
   *
   * `writeProgress` / `writeRetryTarget` 都是从 `base` 重建的，看不见
   * `reviewSnapshot` 刚记下的那一道，所以判分流最后要过这一道手。
   * `review === undefined` 说明今天还没复习过任何一道，这时保持原样。
   */
  private withReview(
    memory: MemoryStoredState,
    review: MemoryReviewState | undefined,
  ): MemoryStoredState {
    return review === undefined ? memory : { ...memory, review };
  }

  private finishSession(): void {
    const learned = this.completed;
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
      this.queue = shuffleArray(
        this.appState.activePool.map((item) => ({ id: item.id })),
      );
      this.selectNext();
      return;
    }

    this.run = "idle";
    this.currentQuestion = null;
    this.showResult = false;
    this.selectedAnswers = [];
    this.queue = [];
    // 复习轮的到期队列用完就丢掉；学习轮的池子由 `round` 重建，
    // 所以这里不用（也没有）暂存位要放回来。
    //
    // 今天这一份复习进度**不清**（`state.memory.review`）：它是「今天复习过哪些
    // 卡」这个事实，不是「本轮还在跑」这个状态。清掉的话「答完最后一道 → 收尾
    // 文案里数着刚才那几道 → 进度条却已经归零」，也说不清今天到底复习了几道。
    // 它自己会在跨过凌晨 5 点（学习日变了）被净化掉。
    this.appState = { ...this.appState, activePool: [] };
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
    toggleSoundPreference(
      this.globalSettingsRef,
      this.deps.toast,
      this.deps.sound,
    );
  }

  toggleAutoNext(): void {
    toggleAutoNextPreference(this.globalSettingsRef, this.deps.toast);
  }

  /** 本轮是否正在进行（首页为 false）。键盘层用它决定 Esc / 题目级按键是否生效。 */
  get isSessionActive(): boolean {
    return this.run !== "idle";
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
    // 本轮是会话状态，换掉 appState 不会自动清：留着会让下一轮从旧的
    // 「已掌握 X / Y」接着数，只学几道就提前结束本轮；复习进度条的两个数同理。
    // 现在「清一轮」只有一句 `round = null`（以前要记得清四个字段）。
    this.round = null;
    this.reviewedIds = [];
    this.reviewTotal = 0;
    this.exitSession();
    this.save();
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
    }, COPY_STATUS_RESET_MS);
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
    // 先不落盘：等 UI 二次确认（覆盖全部进度且不可撤销）。
    // 与 `QuizSession` 走同一套流程，弹窗本身也是同一个组件。
    this.importConfirmText = result.text;
  }

  cancelImport(): void {
    this.importConfirmText = null;
  }

  async commitImport(): Promise<void> {
    const text = this.importConfirmText;
    if (!text) return;
    this.importConfirmText = null;

    const parsed = await parseImportedProgress(text, this.hash, this.questions);
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
    // 重新开始：否则旧的一轮会叠到导入的进度上，几道就结束本轮；
    // 复习进度条的两个数也是「本轮」状态，一起归零
    this.round = null;
    this.reviewedIds = [];
    this.reviewTotal = 0;
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
      // 学习轮：目标 / 这一批 / 已掌握一起存（拆开存就会各自漂移）
      round: this.round ?? undefined,
    });
  }

  private loadState(
    stored: ReturnType<typeof loadStoredState>,
  ): RuntimeState {
    // 本轮的「重新连对」待办与今天的复习进度都只保留今天的：昨天写下的东西
    // 今天已经没意义（那道卡今天本来就会到期，答对一次即过；复习进度条则要
    // 从新的一天重新数）
    const today = studyDay(this.now);
    // 展开原段再覆盖要净化的字段：以后 `memory` 加字段时不会被这里悄悄抹掉
    const memory = stored.memory
      ? {
          ...stored.memory,
          progress: normalizeMemoryProgressMap(stored.memory.progress),
          settings: sanitizeMemorySettings(stored.memory.settings),
          retry: normalizeMemoryRetry(stored.memory.retry, today),
          review: normalizeMemoryReview(stored.memory.review, today),
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
