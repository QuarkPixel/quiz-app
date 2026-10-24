/**
 * QuizSession：答题流的状态层。
 *
 * 把 QuizView 之前的所有 reactive state、derived、actions 聚合到一个 class。
 * 子组件通过 useQuizSession() 拿到实例，避免 prop drilling。
 *
 * 副作用（flash / toast）通过构造时注入的 deps 调用，方便单测 mock。
 */

import { tick } from "svelte";
import type {
  ActivePoolItem,
  Question,
  QuestionType,
  RuntimeState,
  StoredState,
} from "@/types";
import type { QuizBank } from "@/source/types";
import {
  GlobalSettingsStore,
  globalSettingsStore,
} from "@/features/globalSettings.svelte";
import {
  applyAnswer,
  buildFilterOptions,
  canSubmitCurrentAnswer,
  computeLearningSegments,
  createResetRuntimeState,
  evaluateAnswer,
  fillActivePool,
  getActivePoolItem,
  getRequiredStreak,
  getStats,
  hasShownActivePoolOutsideFilter,
  loadRuntimeState,
  rebuildRuntimeState,
  rebuildRuntimeStateForFilterChange,
  reconcileAfterSettingsChange,
  sanitizeBankSettings,
  saveState,
  selectNextFromPool,
  shuffle,
  type FilterChangeActivePoolPolicy,
} from "@/features/quiz";
import { QUESTION_TYPES } from "../types/registry";
import {
  QuestionCopyPattern,
  type QuestionCopyContext,
  type ShuffledOption,
} from "../types/types";
import { maybePlayAnswerSound } from "@/sound";
import type {
  CopyQuestionOptions,
  CopyQuestionResult,
} from "@/quiz/session/types";
import {
  ProgressSessionBase,
  type SessionDeps,
} from "@/quiz/session/ProgressSessionBase.svelte";

/** 两个模式共用的 deps 形状，保留旧名字方便调用方按模式引用。 */
export type QuizSessionDeps = SessionDeps;

const EMPTY_COPY_CONTEXT: QuestionCopyContext = {
  shuffledOptions: [],
  selectedAnswers: [],
  blankAnswerInputs: [],
};

export class QuizSession extends ProgressSessionBase {
  readonly bank: QuizBank;
  // 这些 readonly 字段在 constructor body 中赋值；TS 静态分析认为它们在
  // 下面的 $derived 字段初始化时 "尚未赋值"，但 $derived 表达式是惰性的
  // （只在外部访问时求值），那时 constructor body 已执行完，赋值已完成。
  // 用 ! 显式告诉 TS "我们保证这些字段在被读取前已赋值"。
  readonly questions!: Question[];
  readonly hash!: string;
  readonly filterOptions!: ReturnType<typeof buildFilterOptions>;

  // === 答题流 state ===
  appState: RuntimeState = $state(null as unknown as RuntimeState);
  currentQuestion: Question | null = $state(null);
  shuffledOptions: ShuffledOption[] = $state([]);
  selectedAnswers: number[] = $state([]);
  blankAnswerInputs: string[] = $state([]);
  showResult = $state(false);
  isCorrect = $state(false);

  // === 筛选变更确认 / 新题预览 state ===
  pendingFilterType: QuestionType | "all" | null = $state(null);
  isPreviewingNewQuestion = $state(false);

  /**
   * 答题过程中新进入活动池、待提示的题目队列（FIFO）。
   * 仅在 notifyNewQuestionInPool 开启时填充。答题流里一次最多入池一题，
   * 所以这其实总是 0/1 条；用队列只是为了语义上稳健。
   */
  newQuestionQueue: Question[] = $state([]);

  /**
   * submit 前的 appState 快照，用于「当作正确」时 rewind。
   * 不是 $state —— 只是临时引用，不参与 reactivity。
   */
  private preSubmitState: RuntimeState | null = null;

  // === derived ===
  stats = $derived(getStats(this.questions, this.appState));
  currentTypeDef = $derived(
    this.currentQuestion ? QUESTION_TYPES[this.currentQuestion.type] : null,
  );
  currentPoolItem: ActivePoolItem | undefined = $derived(
    this.currentQuestion
      ? getActivePoolItem(this.appState, this.currentQuestion.id)
      : undefined,
  );
  requiredStreak = $derived(
    this.currentPoolItem
      ? getRequiredStreak(this.currentPoolItem, this.appState)
      : 1,
  );
  learningSegments = $derived(
    computeLearningSegments(this.questions, this.appState),
  );
  allMastered = $derived.by(() => {
    if (this.questions.length === 0) return false;
    const masteredSet = new Set(this.appState.masteredIds);
    return this.questions.every((q) => masteredSet.has(q.id));
  });
  /** 当前要展示的新题（队首），无则 null */
  currentNewQuestion: Question | null = $derived(
    this.newQuestionQueue[0] ?? null,
  );

  constructor(
    bank: QuizBank,
    deps: QuizSessionDeps,
    globalSettingsRef: GlobalSettingsStore = globalSettingsStore,
  ) {
    super(deps, globalSettingsRef);
    this.bank = bank;
    this.questions = bank.questions;
    this.hash = bank.hash;
    this.filterOptions = buildFilterOptions(this.questions);
    this.appState = loadRuntimeState(this.questions, this.hash);
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

  // ────────────────────────────────────────────────────────────────
  // 答题流
  // ────────────────────────────────────────────────────────────────

  /** 入口：补齐活动池 + 选第一道题 */
  initialize(): void {
    this.clearNewQuestionPreviewState();
    this.appState = fillActivePool(this.appState);
    this.save();
    this.selectNext();
  }

  /** 选下一题，重置作答相关 state */
  selectNext(): void {
    this.isPreviewingNewQuestion = false;
    this.currentQuestion = selectNextFromPool(
      this.questions,
      this.appState,
      this.currentQuestion?.id,
    );
    this.markCurrentQuestionAsShown();

    if (this.currentQuestion?.options) {
      const optionsWithIndex = this.currentQuestion.options.map((opt, idx) => ({
        ...opt,
        originalIndex: idx,
      }));
      this.shuffledOptions = shuffle(optionsWithIndex);
    } else {
      this.shuffledOptions = [];
    }

    this.selectedAnswers = [];
    const answerCount = Array.isArray(this.currentQuestion?.answer)
      ? (this.currentQuestion.answer as string[]).length
      : 1;
    this.blankAnswerInputs = Array(answerCount).fill("");

    this.showResult = false;
    this.isCorrect = false;
    this.preSubmitState = null;
    this.resetCopyQuestionStatus();
    this.focusBlankInputIfNeeded();
  }

  /** 提交当前作答 */
  submit(): void {
    if (
      !this.currentQuestion ||
      !canSubmitCurrentAnswer(
        this.currentQuestion,
        this.selectedAnswers,
        this.blankAnswerInputs,
      )
    ) {
      return;
    }

    const nextIsCorrect = evaluateAnswer(
      this.currentQuestion,
      this.selectedAnswers,
      this.blankAnswerInputs,
    );

    this.preSubmitState = this.appState;
    this.showResult = true;
    this.isCorrect = nextIsCorrect;
    this.deps.flash(nextIsCorrect);
    maybePlayAnswerSound(this.globalSettings, this.deps.sound, nextIsCorrect);
    const poolIdsBeforeAnswer = this.activePoolIdSet();
    this.appState = applyAnswer(
      this.appState,
      this.currentQuestion.id,
      nextIsCorrect,
    );
    this.enqueueNewlyPooled(poolIdsBeforeAnswer);
    this.save();

    if (nextIsCorrect && this.globalSettings.autoNextOnCorrect) {
      this.advanceQuestionFlow();
    }
  }

  /**
   * 「当作正确」：把上次 submit 时记下的 preSubmitState 当起点，
   * 以 isCorrect=true 重新走 applyAnswer。
   * 这样 hasEverMistaken 不会被这次 typo 打上、streak 自然 +1。
   */
  treatLastAnswerAsCorrect(): void {
    if (!this.preSubmitState || !this.currentQuestion) return;
    const poolIdsBeforeRewind = this.activePoolIdSet();
    this.appState = applyAnswer(
      this.preSubmitState,
      this.currentQuestion.id,
      true,
    );
    this.enqueueNewlyPooled(poolIdsBeforeRewind);
    this.preSubmitState = null;
    this.save();
    this.isCorrect = true;
    this.deps.flash(true);
    maybePlayAnswerSound(this.globalSettings, this.deps.sound, true);
  }

  /**
   * 把任意一道题标为已掌握（顶部 indicator / PoolPanel 双击）。
   * 如果掌握的就是当前题，自动进入下一步流程（必要时先展示新题预览）。
   */
  markAsMastered(questionId: string): void {
    const poolIdsBeforeMastery = this.activePoolIdSet();
    const activeItem = this.appState.activePool.find(
      (item) => item.id === questionId,
    );
    const masteredMistakes = {
      ...this.appState.masteredMistakes,
      [questionId]:
        activeItem?.hasEverMistaken ??
        this.appState.masteredMistakes[questionId] ??
        false,
    };
    const nextState: RuntimeState = {
      ...this.appState,
      activePool: this.appState.activePool.filter(
        (item) => item.id !== questionId,
      ),
      masteredIds: this.appState.masteredIds.includes(questionId)
        ? [...this.appState.masteredIds]
        : [...this.appState.masteredIds, questionId],
      masteredMistakes,
      pendingIds: this.appState.pendingIds.filter((id) => id !== questionId),
    };
    this.appState = fillActivePool(nextState);
    this.enqueueNewlyPooled(poolIdsBeforeMastery);
    this.save();
    if (this.currentQuestion?.id === questionId) {
      this.advanceQuestionFlow();
    }
  }

  /** 顶部 indicator 双击：掌握当前题 */
  markCurrentAsMastered(): void {
    if (!this.currentQuestion) return;
    this.markAsMastered(this.currentQuestion.id);
  }

  markPreviewQuestionAsMastered(): void {
    const previewQuestion = this.currentNewQuestion;
    if (!previewQuestion) return;

    const previewQuestionId = previewQuestion.id;
    this.markAsMastered(previewQuestionId);

    if (this.currentNewQuestion?.id === previewQuestionId) {
      this.newQuestionQueue = this.newQuestionQueue.slice(1);
    }

    if (this.currentNewQuestion) {
      this.isPreviewingNewQuestion = true;
      this.resetCopyQuestionStatus();
      return;
    }

    this.isPreviewingNewQuestion = false;
    this.selectNext();
  }

  // ────────────────────────────────────────────────────────────────
  // 设置 / 状态变更
  // ────────────────────────────────────────────────────────────────

  setFilter(type: QuestionType | "all"): boolean {
    if (this.appState.filterType === type) return true;

    if (hasShownActivePoolOutsideFilter(this.questions, this.appState, type)) {
      this.pendingFilterType = type;
      return false;
    }

    this.applyFilterChange(type, "keep-shown");
    return true;
  }

  cancelPendingFilterChange(): void {
    this.pendingFilterType = null;
  }

  confirmPendingFilterChange(
    activePoolPolicy: FilterChangeActivePoolPolicy,
  ): void {
    if (!this.pendingFilterType) return;
    this.applyFilterChange(this.pendingFilterType, activePoolPolicy);
  }

  private applyFilterChange(
    type: QuestionType | "all",
    activePoolPolicy: FilterChangeActivePoolPolicy,
  ): void {
    this.pendingFilterType = null;
    this.clearNewQuestionPreviewState();
    this.appState = rebuildRuntimeStateForFilterChange(
      this.questions,
      this.appState,
      type,
      activePoolPolicy,
    );
    this.appState = fillActivePool(this.appState);
    this.save();
    this.selectNext();
  }

  reset(): void {
    this.appState = createResetRuntimeState(this.questions, this.hash);
    this.initialize();
  }

  // ── 模式内 UI 开关（全局设置开关在基类） ────────────────────────────

  toggleProgressFocus(): void {
    if (this.stats.learning === 0) return;
    this.appState.ui.progressFocused = !this.appState.ui.progressFocused;
    this.save();
  }

  togglePool(): void {
    this.appState.ui.showPool = !this.appState.ui.showPool;
    this.save();
  }

  advanceQuestionFlow(): void {
    if (this.isPreviewingNewQuestion) {
      this.newQuestionQueue = this.newQuestionQueue.slice(1);
      this.resetCopyQuestionStatus();
      if (this.currentNewQuestion) return;
      this.selectNext();
      return;
    }

    if (this.currentNewQuestion) {
      this.isPreviewingNewQuestion = true;
      this.resetCopyQuestionStatus();
      return;
    }

    this.selectNext();
  }

  async copyCurrentQuestion(
    options: CopyQuestionOptions = {},
    pattern?: QuestionCopyPattern,
  ): Promise<CopyQuestionResult> {
    if (!this.currentQuestion || !this.currentTypeDef) return "unavailable";

    return this.copyToClipboard(
      this.currentQuestion,
      this.currentTypeDef,
      this.getCurrentQuestionCopyContext(),
      options,
      pattern ?? this.getCurrentQuestionCopyPattern(),
      true,
    );
  }

  async copyPreviewQuestion(
    options: CopyQuestionOptions = {},
    pattern: QuestionCopyPattern = QuestionCopyPattern.QuestionWithAnswer,
  ): Promise<CopyQuestionResult> {
    const question = this.currentNewQuestion;
    if (!question) return "unavailable";

    const typeDef = QUESTION_TYPES[question.type];
    if (!typeDef) return "unavailable";

    return this.copyToClipboard(
      question,
      typeDef,
      EMPTY_COPY_CONTEXT,
      options,
      pattern,
      true,
    );
  }

  /** 复制指定题目文本（用于列表等非当前题场景）。 */
  async copyQuestion(
    question: Question,
    options: CopyQuestionOptions = {},
    pattern: QuestionCopyPattern = QuestionCopyPattern.QuestionWithAnswer,
  ): Promise<CopyQuestionResult> {
    const typeDef = QUESTION_TYPES[question.type];
    if (!typeDef) return "unavailable";

    return this.copyToClipboard(
      question,
      typeDef,
      EMPTY_COPY_CONTEXT,
      options,
      pattern,
      false,
    );
  }

  /** 算法相关设置变更：钳值、重 reconcile 活动池 */
  handleAlgorithmChange(): void {
    const reconcileResult = reconcileAfterSettingsChange(
      this.questions,
      this.appState,
      this.currentQuestion?.id,
    );
    this.appState = reconcileResult.state;
    this.saveSettingsChange();
    if (reconcileResult.shouldSelectNext) {
      this.selectNext();
    }
  }

  /** 按库偏好变更（如 notifyNewQuestionInPool）：持久化当前题库与默认模板 */
  handlePreferenceChange(): void {
    this.saveSettingsChange();
  }

  // ────────────────────────────────────────────────────────────────
  // 导入导出
  // ────────────────────────────────────────────────────────────────

  applyImportedState(newState: StoredState): void {
    this.clearNewQuestionPreviewState();
    const stateWithPending: RuntimeState = {
      ...newState,
      masteredMistakes: newState.masteredMistakes ?? {},
      settings: sanitizeBankSettings(newState.settings),
      pendingIds: [],
    };
    this.appState = rebuildRuntimeState(
      this.questions,
      stateWithPending,
      newState.filterType,
    );
    this.save();
    this.selectNext();
  }

  // 导入导出（exportProgress / startImport / commitImport）在基类里，
  // 这里只需要 `applyImportedState`：把备份变成刷题流的运行时状态。

  // ────────────────────────────────────────────────────────────────
  // 内部
  // ────────────────────────────────────────────────────────────────

  private save(options: { updateDefaultSettings?: boolean } = {}): void {
    saveState(this.hash, this.appState, {
      updateDefaultSettings: options.updateDefaultSettings === true,
    });
  }

  private saveSettingsChange(): void {
    this.save({ updateDefaultSettings: true });
  }

  private clearNewQuestionPreviewState(): void {
    this.isPreviewingNewQuestion = false;
    this.newQuestionQueue = [];
  }

  private getCurrentQuestionCopyContext(): QuestionCopyContext {
    return {
      shuffledOptions: this.shuffledOptions,
      selectedAnswers: this.selectedAnswers,
      blankAnswerInputs: this.blankAnswerInputs,
    };
  }

  private getCurrentQuestionCopyPattern(): QuestionCopyPattern {
    if (!this.showResult) return QuestionCopyPattern.QuestionOnly;
    return this.isCorrect
      ? QuestionCopyPattern.QuestionWithAnswer
      : QuestionCopyPattern.QuestionWithMyAnswerAndAnswer;
  }

  private markCurrentQuestionAsShown(): void {
    if (!this.currentQuestion) return;

    const itemIndex = this.appState.activePool.findIndex(
      (item) => item.id === this.currentQuestion?.id,
    );
    const item = this.appState.activePool[itemIndex];
    if (!item || item.hasBeenShown) return;

    const activePool = [...this.appState.activePool];
    activePool[itemIndex] = { ...item, hasBeenShown: true };
    this.appState = { ...this.appState, activePool };
    this.save();
  }

  /** 活动池里当前的题目 id 集合，用于 diff 出新入池的题。 */
  private activePoolIdSet(): Set<string> {
    return new Set(this.appState.activePool.map((item) => item.id));
  }

  /**
   * 对比一次状态变迁前后的活动池，把新进入的题目按 settings 入队提示。
   * 仅答题流（submit / 当作正确 / 掌握）调用，启动与批量填充不触发。
   */
  private enqueueNewlyPooled(previousIds: Set<string>): void {
    if (!this.appState.settings.notifyNewQuestionInPool) return;

    const questionsById = new Map(this.questions.map((q) => [q.id, q]));
    const added = this.appState.activePool
      .filter((item) => !previousIds.has(item.id))
      .map((item) => questionsById.get(item.id))
      .filter((q): q is Question => q !== undefined);

    if (added.length > 0) {
      this.newQuestionQueue = [...this.newQuestionQueue, ...added];
    }
  }

  private focusBlankInputIfNeeded(): void {
    if (this.currentQuestion?.type !== "blank") return;
    void tick().then(() => {
      const el = document.querySelector<HTMLInputElement>(
        ".blank-input:not(:disabled)",
      );
      el?.focus();
    });
  }
}
