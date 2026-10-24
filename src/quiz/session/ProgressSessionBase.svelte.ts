/**
 * ProgressSessionBase：刷题 / 记忆两个模式的「会话外壳」。
 *
 * 这两个模式在业务上完全不同（一个按连对次数掌握，一个按复习阶梯排期），
 * 但有一批行为是**逐字相同**的，以前在两边的 `Session` 里各抄了一份：
 *
 *   - 进度备份：导出到剪贴板 / 从剪贴板读入 / 二次确认后覆盖
 *   - 复制题目：走题型的 `formatCopyText`，失败兜底文案一样
 *   - 全局设置开关：音效、答对自动下一题、选中自动提交
 *   - 那几个「按钮闪一下再复原」的计时器
 *
 * 抄两份的代价不是多几行，而是**改一处忘一处**：记忆模式就漏过 ⌘N / ⌘S 两个键
 * （见 `@/features/globalSettingsActions` 的注释）。所以这里把它们收进一个基类，
 * 子类只回答「状态从哪来、存到哪去」这几个问题。
 *
 * 抽象成员只有四个，都是为了把「子类才知道的事」外置：
 *   - `sessionHash` / `sessionQuestions` / `sessionState`：导出、导入、复制要用的数据
 *   - `applyImportedState`：把解析出来的 `StoredState` 变成自己的运行时状态
 *
 * 落盘仍然各写各的（`save()` 在子类里）：两个模式的 `save` 不只是字段不同，
 * 记忆模式还要把 `this.round` 覆写进 `appState.round`（本轮是会话状态，
 * 不能等下一次 `appState` 变更才落盘）。
 */

import { writeText } from "clipboard-polyfill";
import type {
  GlobalSettings,
  Question,
  RuntimeState,
  StoredState,
} from "@/types";
import {
  GlobalSettingsStore,
  globalSettingsStore,
} from "@/features/globalSettings.svelte";
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
import { maybePlaySuccessSound } from "@/sound";
import {
  applySoundEnabledPreference,
  toggleAutoNextPreference,
  toggleSoundPreference,
} from "@/features/globalSettingsActions";
import type { Toast } from "@/features/toast.svelte";
import type { SoundPlayer } from "@/sound/types";
import type {
  QuestionCopyContext,
  QuestionCopyPattern,
  QuestionTypeDef,
} from "@/quiz/types/types";
import type {
  CopyQuestionOptions,
  CopyQuestionResult,
  CopyQuestionStatus,
} from "./types";

export type ExportStatus = "idle" | "copied" | "error";

/**
 * 会话的副作用出口。两个模式的 deps 形状本来就一样，
 * 以前各声明一份（`QuizSessionDeps` / `MemorySessionDeps`），现在只留这一份。
 */
export interface SessionDeps {
  /** 提交答案后触发全屏闪烁 */
  flash(isCorrect: boolean): void;
  /** 显示 toast 提示 */
  toast: Toast;
  /** 播放音效 */
  sound: SoundPlayer;
}

export abstract class ProgressSessionBase {
  // === 导入导出 state ===
  exportStatus: ExportStatus = $state("idle");
  /**
   * 待二次确认的导入文本（`null` = 没有待确认的导入）。
   * 导入会覆盖全部进度，必须先问一次；弹窗由 `ImportProgressDialog` 渲染。
   */
  importConfirmText: string | null = $state(null);

  // === 复制题目 state ===
  copyQuestionStatus: CopyQuestionStatus = $state("idle");
  private copyQuestionResetTimer: ReturnType<typeof setTimeout> | null = null;

  protected constructor(
    protected readonly deps: SessionDeps,
    protected readonly globalSettingsRef: GlobalSettingsStore = globalSettingsStore,
  ) {}

  // ── 子类必须回答的四件事 ────────────────────────────────────────────

  /** 当前题库的 hash（进度备份按它校验是不是同一个库）。 */
  protected abstract get sessionHash(): string;
  /** 当前题库的题目（备份里要带上题号顺序）。 */
  protected abstract get sessionQuestions(): readonly Question[];
  /** 要导出的运行时状态。 */
  protected abstract get sessionState(): RuntimeState;
  /** 导入确认后，把解析出来的状态落到自己的运行时状态上。 */
  protected abstract applyImportedState(state: StoredState): void;

  /** 全局设置（跨题库共享，和侧边栏「全局设置」是同一个实例）。 */
  get globalSettings(): GlobalSettings {
    return this.globalSettingsRef.value;
  }

  // ── 全局设置开关 ────────────────────────────────────────────────────

  toggleSound(): void {
    toggleSoundPreference(
      this.globalSettingsRef,
      this.deps.toast,
      this.deps.sound,
    );
  }

  setSoundEnabled(next: boolean): void {
    applySoundEnabledPreference(
      this.globalSettingsRef,
      next,
      this.deps.toast,
      this.deps.sound,
    );
  }

  toggleAutoNext(): void {
    toggleAutoNextPreference(this.globalSettingsRef, this.deps.toast);
  }

  setAutoSubmitOnSelection(next: boolean): void {
    if (this.globalSettings.autoSubmitOnSelection === next) return;
    this.globalSettingsRef.update({ autoSubmitOnSelection: next });
  }

  // ── 进度备份 ────────────────────────────────────────────────────────

  async exportProgress(): Promise<void> {
    if (this.exportStatus !== "idle") return;
    const result = await copyProgressToClipboard(
      this.sessionState,
      this.sessionHash,
      this.sessionQuestions,
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
    this.importConfirmText = result.text;
  }

  cancelImport(): void {
    this.importConfirmText = null;
  }

  async commitImport(): Promise<void> {
    const text = this.importConfirmText;
    if (!text) return;
    this.importConfirmText = null;

    const parsed = await parseImportedProgress(
      text,
      this.sessionHash,
      this.sessionQuestions,
    );
    if (!parsed.ok) {
      this.deps.toast("导入失败", parsed.error, "destructive");
      return;
    }
    this.applyImportedState(parsed.state);
    this.deps.toast("进度已导入", "已覆盖当前进度。", "success");
    maybePlaySuccessSound(this.globalSettings, this.deps.sound);
  }

  // ── 复制题目 ────────────────────────────────────────────────────────

  /**
   * 复制一道题（唯一的出口）。
   *
   * `trackStatus` 决定要不要把结果写进 `copyQuestionStatus`：
   * 按钮触发靠它显示「已复制 / 失败」，快捷键触发则只弹 toast
   * （`options.announce`），两者互不干扰。
   */
  protected async copyToClipboard(
    question: Question,
    typeDef: QuestionTypeDef,
    context: QuestionCopyContext,
    options: CopyQuestionOptions,
    pattern: QuestionCopyPattern,
    trackStatus: boolean,
  ): Promise<CopyQuestionResult> {
    const onStatus = trackStatus
      ? (status: CopyQuestionStatus) => this.setCopyQuestionStatus(status)
      : undefined;

    try {
      await writeText(typeDef.formatCopyText(question, context, pattern));
      onStatus?.("copied");
      if (options.announce) {
        this.deps.toast(
          "题目已复制到剪贴板",
          "可直接粘贴到任意位置。",
          "success",
        );
      }
      return "copied";
    } catch {
      onStatus?.("error");
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

  /** 立刻把复制按钮状态复位（切题时用）。 */
  protected resetCopyQuestionStatus(): void {
    if (this.copyQuestionResetTimer) {
      clearTimeout(this.copyQuestionResetTimer);
      this.copyQuestionResetTimer = null;
    }
    this.copyQuestionStatus = "idle";
  }

  private setCopyQuestionStatus(status: CopyQuestionStatus): void {
    if (this.copyQuestionResetTimer) {
      clearTimeout(this.copyQuestionResetTimer);
    }
    this.copyQuestionStatus = status;
    this.copyQuestionResetTimer = setTimeout(() => {
      this.copyQuestionStatus = "idle";
      this.copyQuestionResetTimer = null;
    }, COPY_STATUS_RESET_MS);
  }
}
