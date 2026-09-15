/**
 * 应用级键盘分发：**刷题模式与记忆模式共用这一份**。
 *
 * 以前这里是 `quiz/session/keyboardHandler.ts`（只服务刷题模式），记忆模式在
 * `MemoryView.svelte` 里另抄了一份。两份一分开，⌘N / ⌘S 这类「后加的应用级
 * 快捷键」就只会落在其中一边——所以现在按**能力**分发：
 *
 *   - 应用级动作（总览 / 设置 / 复制 / 导入导出 / 音效 / 自动下一题）走
 *     `SHORTCUTS` + `APP_SHORTCUTS` 这一份注册表，两个模式行为一致；
 *   - 只有某一个模式有的能力（活动池、本轮会话）声明成可选成员，
 *     宿主没实现就自然跳过，不需要 `if (mode === …)` 这种分支。
 *
 * 题目级按键仍然全部交给题型注册表（`getKeyboardAction`），这里只做
 * 「该不该拦这次按键」的上下文判定。
 */

import { SHORTCUTS, SHORTCUT_IDS, type ShortcutId } from "@/config";
import { isGlobalSettingsShortcut } from "@/features/globalSettingsShortcut";
import {
  hasSelectedText,
  isEditingTarget,
  isInsideDialog,
  isInteractiveTarget,
} from "@/features/quiz";
import type {
  CopyQuestionOptions,
  CopyQuestionResult,
  KeyboardUiActions,
} from "@/quiz/session/types";
import { QUESTION_TYPES_LOGIC } from "@/quiz/types/registry-logic";
import { QuestionCopyPattern } from "@/quiz/types/types";
import type {
  QuestionKeyboardAction,
  ShuffledOption,
} from "@/quiz/types/types";
import type { GlobalSettings, Question } from "@/types";

/**
 * 键盘层需要的最小会话形状。
 *
 * 刻意按**结构**声明而不是引用 `QuizSession`：记忆模式的 `MemorySession`
 * 直接结构化满足它，不必继承 / 不必断言，也不会因为少了某个刷题专属字段
 * 就整体不兼容。
 */
export interface KeyboardSession {
  currentQuestion: Question | null;
  showResult: boolean;
  globalSettings: GlobalSettings;
  /** 题型级动作会写它（选项 / 自评结果） */
  selectedAnswers: number[];
  /** 刷题模式才有：乱序后的选项 */
  shuffledOptions?: ShuffledOption[];
  /** 刷题模式才有：填空输入 */
  blankAnswerInputs?: string[];
  /** 刷题模式才有：新题入池预览态 */
  isPreviewingNewQuestion?: boolean;
  /** 记忆模式才有：本轮会话是否正在进行（决定 Esc 是否要结束本轮） */
  isSessionActive?: boolean;

  copyCurrentQuestion(
    options?: CopyQuestionOptions,
    pattern?: QuestionCopyPattern,
  ): Promise<CopyQuestionResult>;
  /** 刷题模式才有：复制预览中的新题 */
  copyPreviewQuestion?(
    options?: CopyQuestionOptions,
    pattern?: QuestionCopyPattern,
  ): Promise<CopyQuestionResult>;
  startImport(): void | Promise<void>;
  exportProgress(): void | Promise<void>;

  submit(): void;
  advanceQuestionFlow(): void;
  /** 记忆模式才有：答案页把刚才的自评降级 */
  markAsWrong?(): void;
  markAsFuzzy?(): void;
  exitSession?(): void;

  /** 全局设置开关（两个模式都实现，走 `@/features/globalSettingsActions`） */
  toggleAutoNext(): void;
  toggleSound(): void;
  /** 刷题模式才有：展开 / 收起活动池 */
  togglePool?(): void;
}

/** 一次按键是否被这个 action 消费（消费了才 preventDefault）。 */
type ShortcutRunner = (event: KeyboardEvent) => boolean;

/**
 * ⌘/Ctrl + 单键 的分发表。
 *
 * 类型是 `Record<ShortcutId, …>`：`SHORTCUTS` 里新增一个键，这里少写一项就
 * 编译不过——注册表与分发不会各自漂移。值为 `null` = 有意交给别人处理。
 */
function buildModHandlers(
  session: KeyboardSession,
  ui: KeyboardUiActions,
): Record<ShortcutId, ShortcutRunner | null> {
  return {
    // ⌘B 归 Sidebar 的 context 管（它管着侧边栏的开合状态）
    sidebar: null,
    // ⌘⇧I 由窗口级的应用监听打开全局设置，见 `globalSettingsShortcut.ts`
    toggleGlobalSettings: null,

    togglePool: session.togglePool
      ? () => {
          session.togglePool?.();
          return true;
        }
      : null,
    toggleReview: () => {
      ui.toggleReview();
      return true;
    },
    toggleSettings: () => {
      ui.toggleSettings();
      return true;
    },
    copyQuestion: (event) => {
      // 打字中 / 选中了文本：把 ⌘C 留给浏览器
      if (isEditingTarget(event) || hasSelectedText()) return false;
      if (session.isPreviewingNewQuestion && session.copyPreviewQuestion) {
        void session.copyPreviewQuestion(
          { announce: true },
          QuestionCopyPattern.QuestionWithAnswer,
        );
        return true;
      }
      void session.copyCurrentQuestion({ announce: true });
      return true;
    },
    importProgress: () => {
      void session.startImport();
      return true;
    },
    exportProgress: () => {
      void session.exportProgress();
      return true;
    },
    toggleAutoNext: () => {
      session.toggleAutoNext();
      return true;
    },
    toggleSound: () => {
      session.toggleSound();
      return true;
    },
  };
}

/**
 * 按键字母 → 快捷键 id。
 *
 * 从 `SHORTCUTS` 推出来，不手抄一份字母表。`toggleGlobalSettings` 要跳过：
 * 它带 ⇧、而且和 `toggleSettings` 共用字母 `i`，进表会互相覆盖
 * （带 ⇧ 的版本在 `isGlobalSettingsShortcut` 那里就整体放行了）。
 */
const MOD_KEY_TO_ID = new Map<string, ShortcutId>(
  SHORTCUT_IDS.filter((id) => id !== "toggleGlobalSettings").map((id) => [
    SHORTCUTS[id],
    id,
  ]),
);

export function createAppKeyboardHandler(
  session: KeyboardSession,
  ui: KeyboardUiActions,
): (event: KeyboardEvent) => void {
  const modHandlers = buildModHandlers(session, ui);

  return (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;

    // ⌘⇧I 是应用级快捷键，必须在这里整体让出去：下面的题目级分发不认修饰键，
    // `i` 在第 9 个选项存在时正好是它的字母——拦不住就会顺手选中 I 选项，
    // 开着自动提交还会直接提交。
    if (isGlobalSettingsShortcut(event)) return;

    const isMod = event.metaKey || event.ctrlKey;
    const target =
      typeof Element !== "undefined" && event.target instanceof Element
        ? event.target
        : null;
    const inDialog = isInsideDialog(event);
    const inBlankInput = target?.classList.contains("blank-input") === true;

    // Cmd/Ctrl + 单键：应用级快捷键（⇧ / ⌥ 组合不在此列）
    if (isMod && !event.altKey && !event.shiftKey) {
      const id = MOD_KEY_TO_ID.get(event.key.toLowerCase());
      if (!id) return;
      if (inDialog) return;
      if (modHandlers[id]?.(event)) event.preventDefault();
      return;
    }

    // 弹窗内：只剩「Enter 让输入框失焦」这一件事——输入框靠 `onchange`
    // 落盘，不 blur 的话改了数字也不会生效。
    if (inDialog) {
      if (event.code === "Enter" && isEditingTarget(event)) {
        (target as HTMLElement | null)?.blur();
      }
      return;
    }

    // Esc：记忆模式「结束本轮」（刷题模式没有这个概念，不实现就不响应）
    if (event.key === "Escape") {
      if (session.isSessionActive) session.exitSession?.();
      return;
    }

    if (inBlankInput && event.code === "Space") return;
    if (isEditingTarget(event) && !inBlankInput) return;

    const question = session.currentQuestion;
    if (!question) return;

    const logic = QUESTION_TYPES_LOGIC[question.type];
    const action = logic?.getKeyboardAction(
      {
        question,
        showResult: session.showResult,
        autoSubmitOnSelection: session.globalSettings.autoSubmitOnSelection,
        shuffledOptions: session.shuffledOptions ?? [],
        selectedAnswers: session.selectedAnswers,
        blankAnswerInputs: session.blankAnswerInputs ?? [],
      },
      {
        key: event.key.toLowerCase(),
        code: event.code,
        scope: inBlankInput ? "blank-input" : "global",
      },
    );
    if (!action) return;

    // Space / Enter 落在其他原生 / ARIA 交互目标上时保留默认行为
    // （否则一次按键会「原生点击 + 全局处理器」各触发一次，答案页直接连跳两题）
    if (
      action.kind !== "set-selected-answers" &&
      !inBlankInput &&
      isInteractiveTarget(event)
    ) {
      return;
    }

    if (runQuestionAction(session, action)) event.preventDefault();
  };
}

/** 执行题型给出的动作；返回是否真的做了事（没做就不吃这次按键）。 */
function runQuestionAction(
  session: KeyboardSession,
  action: QuestionKeyboardAction | null,
): boolean {
  if (!action) return false;

  switch (action.kind) {
    case "next":
      session.advanceQuestionFlow();
      return true;
    case "submit":
      session.submit();
      return true;
    // 记忆模式专用的两个改判动作：宿主没实现就说明当前模式没有这个动作
    case "mark-wrong":
      if (!session.markAsWrong) return false;
      session.markAsWrong();
      return true;
    case "mark-fuzzy":
      if (!session.markAsFuzzy) return false;
      session.markAsFuzzy();
      return true;
    case "set-selected-answers":
      session.selectedAnswers = action.value;
      if (action.autoSubmit) session.submit();
      return true;
  }
}
