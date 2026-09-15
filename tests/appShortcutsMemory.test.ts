import { describe, it, expect, vi } from "vitest";
import {
  createAppKeyboardHandler,
  type KeyboardSession,
} from "../src/features/appShortcuts";
import type { KeyboardUiActions } from "../src/quiz/session/types";
import { SHORTCUTS } from "../src/config";
import type { Question } from "../src/types";
import { MEMORY_ANSWER_CODE } from "../src/quiz/types/memory/logic";

/**
 * 记忆模式走**与刷题模式同一个**键盘分发（`features/appShortcuts.ts`）。
 *
 * 这组用例守两件事：
 *   1. 记忆题型的按键（知道 / 模糊 / 忘记 / 下一题 / 记错了）经统一分发后
 *      落到 session 的对应方法上；
 *   2. 上下文守卫仍然保守——按钮上的 Space / Enter 让给原生点击，
 *      对话框里的按键不穿透（这两条曾经是记忆模式自己写守卫时踩过的坑）。
 */

const MEMORY_QUESTION: Question = {
  id: "m1",
  type: "memory",
  question: "取得进步",
  answer: "make progress",
};

function makeMemorySession(
  overrides: {
    showResult?: boolean;
    isSessionActive?: boolean;
    selectedAnswers?: number[];
  } = {},
) {
  return {
    currentQuestion: MEMORY_QUESTION,
    showResult: overrides.showResult ?? false,
    isSessionActive: overrides.isSessionActive ?? true,
    globalSettings: {
      soundEnabled: false,
      autoSubmitOnSelection: false,
      autoNextOnCorrect: false,
    },
    selectedAnswers: overrides.selectedAnswers ?? [],
    submit: vi.fn(),
    advanceQuestionFlow: vi.fn(),
    markAsWrong: vi.fn(),
    markAsFuzzy: vi.fn(),
    exitSession: vi.fn(),
    copyCurrentQuestion: vi.fn(),
    startImport: vi.fn(),
    exportProgress: vi.fn(),
    toggleAutoNext: vi.fn(),
    toggleSound: vi.fn(),
  } as unknown as KeyboardSession & {
    submit: ReturnType<typeof vi.fn>;
    advanceQuestionFlow: ReturnType<typeof vi.fn>;
    markAsWrong: ReturnType<typeof vi.fn>;
    markAsFuzzy: ReturnType<typeof vi.fn>;
    exitSession: ReturnType<typeof vi.fn>;
    toggleSound: ReturnType<typeof vi.fn>;
    toggleAutoNext: ReturnType<typeof vi.fn>;
  };
}

const ui: KeyboardUiActions = {
  toggleReview: () => {},
  toggleSettings: () => {},
};

function mkEvent(
  init: Partial<KeyboardEvent> & { target?: HTMLElement } = {},
): KeyboardEvent {
  const e: any = {
    key: init.key ?? " ",
    code: init.code ?? "Space",
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    defaultPrevented: init.defaultPrevented ?? false,
    isComposing: init.isComposing ?? false,
    target: init.target ?? document.body,
    preventDefault: vi.fn(),
  };
  return e as KeyboardEvent;
}

describe("记忆模式：题目级按键", () => {
  it("`Space` / `Enter` = 知道，并直接提交", () => {
    const session = makeMemorySession();
    const handler = createAppKeyboardHandler(session, ui);

    handler(mkEvent({ code: "Space", key: " " }));
    expect(session.selectedAnswers).toEqual([MEMORY_ANSWER_CODE.know]);
    expect(session.submit).toHaveBeenCalledOnce();

    session.selectedAnswers = [];
    handler(mkEvent({ code: "Enter", key: "Enter" }));
    expect(session.selectedAnswers).toEqual([MEMORY_ANSWER_CODE.know]);
    expect(session.submit).toHaveBeenCalledTimes(2);
  });

  it("`'` = 模糊；`;` = 忘记", () => {
    const session = makeMemorySession();
    const handler = createAppKeyboardHandler(session, ui);

    handler(mkEvent({ code: "Quote", key: "'" }));
    expect(session.selectedAnswers).toEqual([MEMORY_ANSWER_CODE.fuzzy]);

    session.selectedAnswers = [];
    handler(mkEvent({ code: "Semicolon", key: ";" }));
    expect(session.selectedAnswers).toEqual([MEMORY_ANSWER_CODE.forget]);
  });

  it("答案页：`Space` = 下一题，`;` / `'` = 把自评降级", () => {
    const session = makeMemorySession({ showResult: true });
    const handler = createAppKeyboardHandler(session, ui);

    handler(mkEvent({ code: "Space", key: " " }));
    expect(session.advanceQuestionFlow).toHaveBeenCalledOnce();

    handler(mkEvent({ code: "Semicolon", key: ";" }));
    expect(session.markAsWrong).toHaveBeenCalledOnce();

    handler(mkEvent({ code: "Quote", key: "'" }));
    expect(session.markAsFuzzy).toHaveBeenCalledOnce();
  });

  it("`Esc` = 结束本轮（会话进行中）", () => {
    const session = makeMemorySession({ isSessionActive: true });

    createAppKeyboardHandler(session, ui)(
      mkEvent({ key: "Escape", code: "Escape" }),
    );

    expect(session.exitSession).toHaveBeenCalledOnce();
  });

  it("`Esc` 在首页（没有进行中的会话）不做事", () => {
    const session = makeMemorySession({ isSessionActive: false });

    createAppKeyboardHandler(session, ui)(
      mkEvent({ key: "Escape", code: "Escape" }),
    );

    expect(session.exitSession).not.toHaveBeenCalled();
  });
});

describe("记忆模式：上下文守卫（与刷题模式同一套）", () => {
  it("`Space` / `Enter` 落在按钮上时让给原生点击，避免一次按键走两遍", () => {
    const session = makeMemorySession({ showResult: true });
    const button = document.createElement("button");
    const ev = mkEvent({ code: "Space", key: " ", target: button });

    createAppKeyboardHandler(session, ui)(ev);

    expect(session.advanceQuestionFlow).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("输入框里的按键交给浏览器（不要在打字时触发知道 / 忘记）", () => {
    const session = makeMemorySession();
    const input = document.createElement("input");

    createAppKeyboardHandler(session, ui)(
      mkEvent({ code: "Space", key: " ", target: input }),
    );

    expect(session.submit).not.toHaveBeenCalled();
    expect(session.selectedAnswers).toEqual([]);
  });

  it("对话框内的按键不穿透（只允许对话框自己的 Esc）", () => {
    const session = makeMemorySession();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);

    createAppKeyboardHandler(session, ui)(
      mkEvent({ code: "Semicolon", key: ";", target: button }),
    );

    expect(session.submit).not.toHaveBeenCalled();
    expect(session.exitSession).not.toHaveBeenCalled();
    document.body.removeChild(dialog);
  });

  it("已经处理过 / 输入法组词中的按键不再介入", () => {
    const session = makeMemorySession();

    createAppKeyboardHandler(session, ui)(
      mkEvent({ code: "Space", key: " ", isComposing: true }),
    );
    createAppKeyboardHandler(session, ui)(
      mkEvent({ code: "Space", key: " ", defaultPrevented: true }),
    );

    expect(session.submit).not.toHaveBeenCalled();
  });
});

describe("记忆模式：应用级快捷键不再漏", () => {
  it("⌘S（音效）/ ⌘N（答对自动下一题）都会命中 session", () => {
    const session = makeMemorySession();
    const handler = createAppKeyboardHandler(session, ui);

    handler(mkEvent({ metaKey: true, key: SHORTCUTS.toggleSound }));
    handler(mkEvent({ metaKey: true, key: SHORTCUTS.toggleAutoNext }));

    expect(session.toggleSound).toHaveBeenCalledOnce();
    expect(session.toggleAutoNext).toHaveBeenCalledOnce();
  });

  it("⌘⇧I 整体让给应用级处理，不落进题目级分发", () => {
    const session = makeMemorySession();
    const ev = mkEvent({
      metaKey: true,
      shiftKey: true,
      key: SHORTCUTS.toggleGlobalSettings.toUpperCase(),
    });

    createAppKeyboardHandler(session, ui)(ev);

    expect(session.selectedAnswers).toEqual([]);
    expect(session.submit).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});
