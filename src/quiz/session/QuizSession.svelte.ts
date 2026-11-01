/**
 * QuizSession：答题流的状态层。
 *
 * 把 QuizView 之前的所有 reactive state、derived、actions 聚合到一个 class。
 * 子组件通过 useQuizSession() 拿到实例，避免 prop drilling。
 *
 * 副作用（flash / toast）通过构造时注入的 deps 调用，方便单测 mock。
 *
 * ── 「屏上现在是什么」只有一份真相 ──────────────────────────────────────────
 *
 * 出题 / 判分 / 新题预告这一串以前是四个独立字段（`currentQuestion` /
 * `showResult` / `isCorrect` / `isPreviewingNewQuestion`）拼出来的，能拼出
 * 一大堆不存在的画面，于是每个读它的地方都得自己再判一次。现在整屏状态是
 * `this.flow`（`QuizFlow`，见 `./quizFlow`）——**所有转移都走那里的纯函数**，
 * 对外只留只读 getter（`currentQuestion` / `showResult` / `isCorrect` /
 * `isPreviewingNewQuestion` / `currentNewQuestion`），子组件的写法不用改。
 *
 * 作答草稿（`selectedAnswers` / `blankAnswerInputs` / `shuffledOptions`）不在
 * 那台机器里：它们是用户正在填的表单，换题时由 `selectNext()` 清空。
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
import { SWAP_LEAVING_ATTR } from "@/lib/transitions/swap";
import type {
  CopyQuestionOptions,
  CopyQuestionResult,
} from "@/quiz/session/types";
import {
  ProgressSessionBase,
  type SessionDeps,
} from "@/quiz/session/ProgressSessionBase.svelte";
import {
  EMPTY_QUIZ_FLOW,
  advance,
  answerIsCorrect,
  ask,
  dropPreview,
  enqueue,
  judge,
  markCorrect,
  nextQueuedOf,
  questionOf,
  resetFlow,
  rewindOf,
  showsAnswer,
  type QuizFlow,
} from "./quizFlow";

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
  /** 屏上的状态机（出题中 / 已判分 / 新题预告 / 空）。 */
  private flow: QuizFlow = $state(EMPTY_QUIZ_FLOW);
  /**
   * 上一次**真正出过**的题（加权选题用它避开刚答完的那一道）。
   *
   * 不能拿 `currentQuestion` 代替：预告态屏上是刚入池的新题，而这里要避开的是
   * 「用户刚刚作答过的那道」——它已经不在屏上了，却仍然是下一题最不该出现的。
   */
  private lastAskedId: string | null = null;
  /** 作答草稿：用户正在填的表单，换题时清空（不属于状态机）。 */
  shuffledOptions: ShuffledOption[] = $state([]);
  selectedAnswers: number[] = $state([]);
  blankAnswerInputs: string[] = $state([]);

  /**
   * 出题序号：每次 `selectNext()` 都 +1，UI 用它做换题过渡的 `{#key}`。
   *
   * 与记忆模式的同名字段口径一致：按「一次出题」而不是「一道题」计数——
   * 同一道题被排回池子再次出现时也算新的一次展示，照样该淡入。
   */
  presentationSeq = $state(0);

  // === 筛选变更确认 state ===
  pendingFilterType: QuestionType | "all" | null = $state(null);

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

  // === 屏上状态（只读投影，写法与旧字段一致） ===

  /** 屏上那道题；空状态 / 预告态之外的任何时候都有值。 */
  get currentQuestion(): Question | null {
    return questionOf(this.flow);
  }

  /** 是否已经亮出答案（判分后 / 新题预告）。 */
  get showResult(): boolean {
    return showsAnswer(this.flow);
  }

  /** 画面上的对错（预告态恒为 true：它展示的就是「已掌握」那一档）。 */
  get isCorrect(): boolean {
    return answerIsCorrect(this.flow);
  }

  /** 屏上是不是「刚入池的新题预告」。 */
  get isPreviewingNewQuestion(): boolean {
    return this.flow.kind === "preview";
  }

  /** 队首的新题（预告态就是屏上那道）。 */
  get currentNewQuestion(): Question | null {
    return nextQueuedOf(this.flow);
  }

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
    this.flow = resetFlow();
    this.appState = fillActivePool(this.appState);
    this.save();
    this.selectNext();
  }

  /**
   * 选下一题，重置作答草稿。
   *
   * **待提示队列在这里清空**：出下一题意味着「新题预告」这件事结束了；
   * 队列只在同一次判分与它之后的那次推进之间有效。
   */
  selectNext(): void {
    const next = selectNextFromPool(
      this.questions,
      this.appState,
      this.lastAskedId ?? undefined,
    );

    this.flow = next ? ask(next) : resetFlow();
    this.lastAskedId = next?.id ?? null;
    this.presentationSeq += 1;
    this.markCurrentQuestionAsShown();

    if (next?.options) {
      const optionsWithIndex = next.options.map((opt, idx) => ({
        ...opt,
        originalIndex: idx,
      }));
      this.shuffledOptions = shuffle(optionsWithIndex);
    } else {
      this.shuffledOptions = [];
    }

    this.selectedAnswers = [];
    const answerCount = Array.isArray(next?.answer)
      ? (next.answer as string[]).length
      : 1;
    this.blankAnswerInputs = Array(answerCount).fill("");

    this.resetCopyQuestionStatus();
    this.focusBlankInputIfNeeded();
  }

  /** 提交当前作答 */
  submit(): void {
    // 只有「出题中」才收提交：预告态 / 判分后重复提交都是空操作
    if (this.flow.kind !== "asking") return;
    const question = this.flow.question;
    if (
      !canSubmitCurrentAnswer(
        question,
        this.selectedAnswers,
        this.blankAnswerInputs,
      )
    ) {
      return;
    }

    const nextIsCorrect = evaluateAnswer(
      question,
      this.selectedAnswers,
      this.blankAnswerInputs,
    );

    // 快照要在改 appState **之前**取：「视作正确」以它为起点重算
    this.flow = judge(this.flow, nextIsCorrect, this.appState);
    this.deps.flash(nextIsCorrect);
    maybePlayAnswerSound(this.globalSettings, this.deps.sound, nextIsCorrect);
    const poolIdsBeforeAnswer = this.activePoolIdSet();
    this.appState = applyAnswer(this.appState, question.id, nextIsCorrect);
    this.enqueueNewlyPooled(poolIdsBeforeAnswer);
    this.save();

    if (nextIsCorrect && this.globalSettings.autoNextOnCorrect) {
      this.advanceQuestionFlow();
    }
  }

  /**
   * 「当作正确」：把上次 submit 时记下的快照当起点，
   * 以 isCorrect=true 重新走 applyAnswer。
   * 这样 hasEverMistaken 不会被这次 typo 打上、streak 自然 +1。
   */
  treatLastAnswerAsCorrect(): void {
    const rewind = rewindOf(this.flow);
    const question = this.currentQuestion;
    if (!rewind || !question) return;
    const poolIdsBeforeRewind = this.activePoolIdSet();
    this.appState = applyAnswer(rewind, question.id, true);
    this.enqueueNewlyPooled(poolIdsBeforeRewind);
    this.flow = markCorrect(this.flow);
    this.save();
    this.deps.flash(true);
    this.maybePlayAnswerSoundForCorrect();
  }

  /**
   * 把任意一道题标为已掌握（顶部 indicator / PoolPanel 双击）。
   * 如果掌握的就是屏上这一道，自动进入下一步流程（必要时先展示新题预览）。
   */
  markAsMastered(questionId: string): void {
    this.applyMastery(questionId);
    // 预告态不动流程：屏上是预告卡，推进由「我知道了」/「标熟」自己那条路走
    if (this.flow.kind !== "preview" && this.currentQuestion?.id === questionId) {
      this.advanceQuestionFlow();
    }
  }

  /** 顶部 indicator 双击：掌握当前题 */
  markCurrentAsMastered(): void {
    if (!this.currentQuestion) return;
    this.markAsMastered(this.currentQuestion.id);
  }

  markPreviewQuestionAsMastered(): void {
    if (this.flow.kind !== "preview") return;
    this.applyMastery(this.flow.queued[0].id);

    const next = dropPreview(this.flow);
    this.resetCopyQuestionStatus();
    if (next === null) {
      this.selectNext();
      return;
    }
    this.flow = next;
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
    this.flow = resetFlow();
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

  /**
   * 直接设定活动池的开合（`togglePool` 的幂等版）。
   *
   * 窄版面的池子是个抽屉，关闭的途径有好几条（下滑 / 点遮罩 / 点关闭按钮），
   * 它们都只知道「现在该关」，不该关心「现在是不是开着」——所以给一个设定值的
   * 入口，而不是逼调用方去 toggle。宽版面的那一列仍然走 `togglePool`。
   */
  setPoolOpen(open: boolean): void {
    if (this.appState.ui.showPool === open) return;
    this.appState.ui.showPool = open;
    this.save();
  }

  /**
   * 有新题入池：排进「待提示」队列（答题流的 `enqueue` 转移）。
   *
   * 正常路径由 `enqueueNewlyPooled` 在判分 / 标熟之后调用；单独公开是因为
   * 它是这台机器的一条正式转移（测试也用它摆出「答完这一题、池子里又进来一道」
   * 的画面，而不是去写内部字段）。
   */
  queueNewQuestions(questions: readonly Question[]): void {
    this.flow = enqueue(this.flow, questions);
  }

  /**
   * 下一题。
   *
   * 机器自己转得动就转（预告 → 下一张预告、判分 → 预告），转不动
   * （队列空了）才回到题库出题——这一层判断只在 `advance()` 里写一次。
   */
  advanceQuestionFlow(): void {
    const next = advance(this.flow);
    if (next !== null) {
      this.flow = next;
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
    this.flow = resetFlow();
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

  /**
   * 把一道题标成已掌握（只改状态，不动答题流）。
   *
   * 「标熟」有三个入口（顶栏双击、活动池双击、总览列表、新题预告），
   * 它们对 `appState` 要做的事逐字相同，所以只有这一份实现；
   * 流程怎么走由各自的调用点决定（见 `markAsMastered` / `markPreviewQuestionAsMastered`）。
   */
  private applyMastery(questionId: string): void {
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
  }

  private maybePlayAnswerSoundForCorrect(): void {
    maybePlayAnswerSound(this.globalSettings, this.deps.sound, true);
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

    if (added.length > 0) this.flow = enqueue(this.flow, added);
  }

  private focusBlankInputIfNeeded(): void {
    if (this.currentQuestion?.type !== "blank") return;
    void tick().then(() => {
      /*
       * 换题过渡期间，旧题那一层还留在 DOM 里 100ms（见 `swapOut`），
       * 它的输入框也还匹配 `.blank-input`。所以：
       *   - 跳过被标了 `SWAP_LEAVING_ATTR` 的那一层；
       *   - 取最后一个匹配项（新的一层排在旧的后面）。
       * 否则焦点会落在 100ms 后就被删掉的输入框上，看起来像「没聚焦」。
       */
      const inputs = [
        ...document.querySelectorAll<HTMLInputElement>(
          ".blank-input:not(:disabled)",
        ),
      ].filter((el) => el.closest(`[${SWAP_LEAVING_ATTR}]`) === null);
      inputs.at(-1)?.focus();
    });
  }
}
