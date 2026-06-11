/**
 * QuizSession：答题流的状态层（Pinia 等价物）。
 *
 * 把 QuizView 之前的所有 reactive state、derived、actions 聚合到一个 class。
 * 子组件通过 useQuizSession() 拿到实例，避免 prop drilling。
 *
 * 副作用（flash / toast）通过构造时注入的 deps 调用，方便单测 mock。
 */

import { tick } from "svelte";
import type {
  ActivePoolItem,
  Option,
  Question,
  QuestionType,
  RuntimeState,
  StoredState,
} from "../../types";
import type { Bank } from "../../source/types";
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
  loadRuntimeState,
  rebuildRuntimeState,
  reconcileAfterSettingsChange,
  saveState,
  selectNextFromPool,
  shuffle,
} from "../../features/quiz";
import {
  copyProgressToClipboard,
  parseImportedProgress,
  readProgressFromClipboard,
} from "../../features/quiz/progressActions";
import {
  EXPORT_STATUS_ERROR_RESET_MS,
  EXPORT_STATUS_SUCCESS_RESET_MS,
} from "../../config";
import { QUESTION_TYPES } from "../types/registry";
import {
  initializeSoundPreference,
  maybePlayAnswerSound,
  maybePlaySuccessSound,
  setSoundEnabledPreference,
} from "$sound";
import type { SoundPlayer } from "../../sound/types";

export type ExportStatus = "idle" | "copied" | "error";
export type CopyQuestionResult = "copied" | "error" | "unavailable";

export type ToastVariant = "default" | "success" | "destructive";

export interface QuizSessionDeps {
  /** 提交答案后触发全屏闪烁 */
  flash(isCorrect: boolean): void;
  /** 显示 toast 提示 */
  toast(title: string, description?: string, variant?: ToastVariant): void;
  /** 播放音效。bundled 模式下是空实现。 */
  sound: SoundPlayer;
}

export interface QuizSessionOptions {
  /** Library 模式：设置变更同步写入本地默认设置，新题库加载时使用。 */
  persistDefaultSettings?: boolean;
}

export interface CopyQuestionOptions {
  /** 快捷键触发时用 toast 提供反馈；按钮触发时用按钮状态反馈。 */
  announce?: boolean;
}

export type ShuffledOption = Option & { originalIndex: number };

export class QuizSession {
  readonly bank: Bank;
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

  // === 导入导出 state ===
  exportStatus: ExportStatus = $state("idle");
  importConfirmText: string | null = $state(null);

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

  constructor(
    bank: Bank,
    private readonly deps: QuizSessionDeps,
    private readonly options: QuizSessionOptions = {},
  ) {
    this.bank = bank;
    this.questions = bank.questions;
    this.hash = bank.hash;
    this.filterOptions = buildFilterOptions(this.questions);
    this.appState = loadRuntimeState(this.questions, this.hash, {
      usePersistedDefaultSettings: this.options.persistDefaultSettings === true,
    });
    initializeSoundPreference(this.appState);
  }

  // ────────────────────────────────────────────────────────────────
  // 答题流
  // ────────────────────────────────────────────────────────────────

  /** 入口：补齐活动池 + 选第一道题 */
  initialize(): void {
    this.appState = fillActivePool(this.appState);
    this.save();
    this.selectNext();
  }

  /** 选下一题，重置作答相关 state */
  selectNext(): void {
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
    maybePlayAnswerSound(this.appState, this.deps.sound, nextIsCorrect);
    this.appState = applyAnswer(
      this.appState,
      this.currentQuestion.id,
      nextIsCorrect,
    );
    this.save();

    if (nextIsCorrect && this.appState.settings.autoNextOnCorrect) {
      this.selectNext();
    }
  }

  /**
   * 「当作正确」：把上次 submit 时记下的 preSubmitState 当起点，
   * 以 isCorrect=true 重新走 applyAnswer。
   * 这样 hasEverMistaken 不会被这次 typo 打上、streak 自然 +1。
   */
  treatLastAnswerAsCorrect(): void {
    if (!this.preSubmitState || !this.currentQuestion) return;
    this.appState = applyAnswer(
      this.preSubmitState,
      this.currentQuestion.id,
      true,
    );
    this.preSubmitState = null;
    this.save();
    this.isCorrect = true;
    this.deps.flash(true);
    maybePlayAnswerSound(this.appState, this.deps.sound, true);
  }

  /**
   * 把任意一道题标为已掌握（顶部 indicator / PoolPanel 双击）。
   * 如果掌握的就是当前题，自动 selectNext。
   */
  markAsMastered(questionId: string): void {
    const nextState: RuntimeState = {
      ...this.appState,
      activePool: this.appState.activePool.filter(
        (item) => item.id !== questionId,
      ),
      masteredIds: this.appState.masteredIds.includes(questionId)
        ? [...this.appState.masteredIds]
        : [...this.appState.masteredIds, questionId],
      pendingIds: this.appState.pendingIds.filter((id) => id !== questionId),
    };
    this.appState = fillActivePool(nextState);
    this.save();
    if (this.currentQuestion?.id === questionId) {
      this.selectNext();
    }
  }

  /** 顶部 indicator 双击：掌握当前题 */
  markCurrentAsMastered(): void {
    if (!this.currentQuestion) return;
    this.markAsMastered(this.currentQuestion.id);
  }

  // ────────────────────────────────────────────────────────────────
  // 设置 / 状态变更
  // ────────────────────────────────────────────────────────────────

  setFilter(type: QuestionType | "all"): void {
    if (this.appState.filterType === type) return;
    this.appState = rebuildRuntimeState(this.questions, this.appState, type);
    this.appState = fillActivePool(this.appState);
    this.save();
    this.selectNext();
  }

  reset(): void {
    this.appState = createResetRuntimeState(this.questions, this.hash, {
      usePersistedDefaultSettings: this.options.persistDefaultSettings === true,
    });
    this.initialize();
  }

  toggleAutoNext(): void {
    const next = !this.appState.settings.autoNextOnCorrect;
    this.appState.settings.autoNextOnCorrect = next;
    this.saveSettingsChange();
    this.deps.toast(
      next ? "答对自动下一题已开启" : "答对自动下一题已关闭",
      next
        ? "答对后会立即进入下一题，无需手动点击。"
        : "答对后停留在结果页，按空格 / 回车继续。",
    );
  }

  toggleSound(): void {
    this.setSoundEnabled(!this.appState.settings.soundEnabled);
  }

  setSoundEnabled(next: boolean): void {
    setSoundEnabledPreference(
      this.appState,
      next,
      () => this.saveSettingsChange(),
      this.deps.toast,
      this.deps.sound,
    );
  }

  toggleProgressFocus(): void {
    if (this.stats.learning === 0) return;
    this.appState.ui.progressFocused = !this.appState.ui.progressFocused;
    this.save();
  }

  togglePool(): void {
    this.appState.ui.showPool = !this.appState.ui.showPool;
    this.save();
  }

  async copyCurrentQuestion(
    options: CopyQuestionOptions = {},
  ): Promise<CopyQuestionResult> {
    if (!this.currentQuestion || !this.currentTypeDef) return "unavailable";

    const text = this.currentTypeDef.formatCopyText(this.currentQuestion, {
      showResult: this.showResult,
      isCorrect: this.isCorrect,
      shuffledOptions: this.shuffledOptions,
      selectedAnswers: this.selectedAnswers,
      blankAnswerInputs: this.blankAnswerInputs,
    });

    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.clipboard?.writeText
      ) {
        throw new Error("Clipboard API is unavailable.");
      }
      await navigator.clipboard.writeText(text);
      if (options.announce) {
        this.deps.toast(
          "题目已复制到剪贴板",
          "可直接粘贴到任意位置。",
          "success",
        );
      }
      return "copied";
    } catch {
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

  /** 算法相关设置变更：钳值、重 reconcile 活动池 */
  handleAlgorithmChange(): void {
    const reconcileResult = reconcileAfterSettingsChange(
      this.questions,
      this.appState,
      this.currentQuestion?.id,
    );
    this.appState = reconcileResult.state;
    this.saveSettingsChange();
    // 注：reconcileResult.shouldSelectNext 历史上未被消费（旧 QuizView 行为），
    // 这里保留原行为。如未来需要"当前题被裁出池时自动 selectNext" 可在这里启用。
  }

  /** 非算法偏好变更（如 autoNextOnCorrect）：持久化当前题库与默认设置 */
  handlePreferenceChange(): void {
    this.saveSettingsChange();
  }

  // ────────────────────────────────────────────────────────────────
  // 导入导出
  // ────────────────────────────────────────────────────────────────

  applyImportedState(newState: StoredState): void {
    const stateWithPending: RuntimeState = { ...newState, pendingIds: [] };
    this.appState = rebuildRuntimeState(
      this.questions,
      stateWithPending,
      newState.filterType,
    );
    this.save();
    this.selectNext();
  }

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
      this.deps.toast(
        "进度已复制到剪贴板",
        "粘贴到任意位置即可备份。",
        "success",
      );
      maybePlaySuccessSound(this.appState, this.deps.sound);
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
    this.importConfirmText = result.text;
  }

  cancelImport(): void {
    this.importConfirmText = null;
  }

  async commitImport(): Promise<void> {
    if (!this.importConfirmText) return;
    const text = this.importConfirmText;
    this.importConfirmText = null;
    const parsed = await parseImportedProgress(text, this.hash, this.questions);
    if (!parsed.ok) {
      this.deps.toast("导入失败", parsed.error, "destructive");
      return;
    }
    this.applyImportedState(parsed.state);
    this.deps.toast("进度已导入", "已覆盖当前进度。", "success");
    maybePlaySuccessSound(this.appState, this.deps.sound);
  }

  // ────────────────────────────────────────────────────────────────
  // 内部
  // ────────────────────────────────────────────────────────────────

  private save(options: { updateDefaultSettings?: boolean } = {}): void {
    saveState(this.hash, this.appState, {
      updateDefaultSettings:
        this.options.persistDefaultSettings === true &&
        options.updateDefaultSettings === true,
    });
  }

  private saveSettingsChange(): void {
    this.save({ updateDefaultSettings: true });
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
