import { describe, it, expect, vi } from "vitest";
import {
  createKeyboardHandler,
  type KeyboardUiActions,
} from "../src/quiz/session/keyboardHandler";
import { SHORTCUTS } from "../src/config";
import type { QuizSession } from "../src/quiz/session/QuizSession.svelte";
import type { Question } from "../src/types";

// QuizSession 是 class，但 keyboardHandler 只用其上的几个方法 + showResult 字段。
// 用最小 stub 模拟，避免引入 svelte 运行时。
function makeQuestion(
  type: Question["type"] = "single",
  optionCount = 3,
): Question {
  if (type === "blank") {
    return {
      id: "b1",
      type,
      question: "blank",
      answer: "hello",
    };
  }
  if (type === "judgment") {
    return {
      id: "j1",
      type,
      question: "judgment",
      answer: true,
    };
  }
  return {
    id: "s1",
    type,
    question: "choice",
    options: Array.from({ length: optionCount }, (_, index) => ({
      text: String.fromCharCode(65 + index),
    })),
    answer: type === "multiple" ? [0, 2] : [1],
  };
}

function makeShuffledOptions(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    text: String.fromCharCode(65 + index),
    originalIndex: index,
  }));
}

function makeSessionStub(
  showResult = false,
  options: {
    questionType?: Question["type"];
    autoSubmitOnSelection?: boolean;
    selectedAnswers?: number[];
    isPreviewingNewQuestion?: boolean;
    /** 选项条数：默认 3，回归「⌘⇧I 撞上第 9 个选项」时需要 9 条 */
    optionCount?: number;
  } = {},
) {
  const optionCount = options.optionCount ?? 3;
  return {
    showResult,
    isPreviewingNewQuestion: options.isPreviewingNewQuestion ?? false,
    currentQuestion: makeQuestion(options.questionType, optionCount),
    currentNewQuestion: makeQuestion(options.questionType, optionCount),
    shuffledOptions: makeShuffledOptions(optionCount),
    selectedAnswers: options.selectedAnswers ?? [],
    blankAnswerInputs: [""],
    globalSettings: {
      soundEnabled: false,
      autoSubmitOnSelection: options.autoSubmitOnSelection ?? true,
      autoNextOnCorrect: false,
    },
    submit: vi.fn(),
    selectNext: vi.fn(),
    advanceQuestionFlow: vi.fn(),
    copyCurrentQuestion: vi.fn(),
    copyPreviewQuestion: vi.fn(),
    copyQuestion: vi.fn(),
    togglePool: vi.fn(),
    toggleAutoNext: vi.fn(),
    toggleSound: vi.fn(),
    startImport: vi.fn(),
    exportProgress: vi.fn(),
  } as unknown as QuizSession & {
    submit: ReturnType<typeof vi.fn>;
    selectNext: ReturnType<typeof vi.fn>;
    advanceQuestionFlow: ReturnType<typeof vi.fn>;
    copyCurrentQuestion: ReturnType<typeof vi.fn>;
    copyPreviewQuestion: ReturnType<typeof vi.fn>;
    copyQuestion: ReturnType<typeof vi.fn>;
    togglePool: ReturnType<typeof vi.fn>;
    toggleAutoNext: ReturnType<typeof vi.fn>;
    toggleSound: ReturnType<typeof vi.fn>;
    startImport: ReturnType<typeof vi.fn>;
    exportProgress: ReturnType<typeof vi.fn>;
  };
}

function makeUiStub() {
  return {
    toggleReview: vi.fn(),
    toggleSettings: vi.fn(),
  } satisfies KeyboardUiActions;
}

function mkEvent(
  init: Partial<KeyboardEvent> & {
    key?: string;
    code?: string;
    target?: HTMLElement;
  } = {},
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

// ---------------------------------------------------------------------------
// 修饰键组合：Cmd/Ctrl + 单键 → 派发对应 action
// ---------------------------------------------------------------------------

describe("Mod 快捷键派发", () => {
  it("Cmd+P → togglePool", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    const handler = createKeyboardHandler(session, ui);
    handler(mkEvent({ metaKey: true, key: SHORTCUTS.togglePool }));
    expect(session.togglePool).toHaveBeenCalledOnce();
  });

  it("Cmd+D → toggleReview", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ metaKey: true, key: SHORTCUTS.toggleReview }),
    );
    expect(ui.toggleReview).toHaveBeenCalledOnce();
  });

  it("Cmd+C → copyCurrentQuestion", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    const ev = mkEvent({ metaKey: true, key: SHORTCUTS.copyQuestion });
    createKeyboardHandler(session, ui)(ev);
    expect(session.copyCurrentQuestion).toHaveBeenCalledWith({
      announce: true,
    });
    expect(ev.preventDefault).toHaveBeenCalledOnce();
  });

  it("预览态 Cmd+C → copyPreviewQuestion", () => {
    const session = makeSessionStub(false, {
      isPreviewingNewQuestion: true,
    });
    const ui = makeUiStub();
    const ev = mkEvent({ metaKey: true, key: SHORTCUTS.copyQuestion });
    createKeyboardHandler(session, ui)(ev);
    expect(session.copyPreviewQuestion).toHaveBeenCalledOnce();
    expect(session.copyCurrentQuestion).not.toHaveBeenCalled();
    expect(ev.preventDefault).toHaveBeenCalledOnce();
  });

  it("Cmd+C on input → 不抢默认复制", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    const input = document.createElement("input");
    const ev = mkEvent({
      metaKey: true,
      key: SHORTCUTS.copyQuestion,
      target: input,
    });
    createKeyboardHandler(session, ui)(ev);
    expect(session.copyCurrentQuestion).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("Cmd+C 有选中文本 → 不抢默认复制", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "selected text",
    } as Selection);
    const ev = mkEvent({ metaKey: true, key: SHORTCUTS.copyQuestion });
    createKeyboardHandler(session, ui)(ev);
    expect(session.copyCurrentQuestion).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("Cmd+I → toggleSettings", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ metaKey: true, key: SHORTCUTS.toggleSettings }),
    );
    expect(ui.toggleSettings).toHaveBeenCalledOnce();
  });

  it("Cmd+P on input → 仍触发（Cmd 快捷键在编辑区也生效）", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    const input = document.createElement("input");
    const ev = mkEvent({
      metaKey: true,
      key: SHORTCUTS.togglePool,
      target: input,
    });
    createKeyboardHandler(session, ui)(ev);
    expect(session.togglePool).toHaveBeenCalledOnce();
    expect(ev.preventDefault).toHaveBeenCalledOnce();
  });

  it("Cmd+A → toggleAutoNext", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ metaKey: true, key: SHORTCUTS.toggleAutoNext }),
    );
    expect(session.toggleAutoNext).toHaveBeenCalledOnce();
  });

  it("Cmd+I → startImport", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ metaKey: true, key: SHORTCUTS.importProgress }),
    );
    expect(session.startImport).toHaveBeenCalledOnce();
  });

  it("Cmd+E → exportProgress", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ metaKey: true, key: SHORTCUTS.exportProgress }),
    );
    expect(session.exportProgress).toHaveBeenCalledOnce();
  });

  it("Cmd+B (sidebar) → 不抢，留给 Sidebar context", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    const ev = mkEvent({ metaKey: true, key: SHORTCUTS.sidebar });
    createKeyboardHandler(session, ui)(ev);
    expect(session.togglePool).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("Cmd+Shift+P → 不触发（要求纯 Cmd+key 组合）", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ metaKey: true, shiftKey: true, key: SHORTCUTS.togglePool }),
    );
    expect(session.togglePool).not.toHaveBeenCalled();
  });

  it("Cmd+Shift+I（全局设置）→ 整套让给应用级处理，不落进题目级分发", () => {
    // 9 个选项时 `i` 正好是第 9 个选项的字母：这里没拦住的话，
    // ⌘⇧I 会顺手选中 I 选项，开着自动提交还会把答案提交掉。
    const session = makeSessionStub(false, { optionCount: 9 });
    const ui = makeUiStub();
    const ev = mkEvent({
      metaKey: true,
      shiftKey: true,
      key: SHORTCUTS.toggleGlobalSettings.toUpperCase(),
    });
    createKeyboardHandler(session, ui)(ev);
    expect(session.selectedAnswers).toEqual([]);
    expect(session.submit).not.toHaveBeenCalled();
    expect(ui.toggleSettings).not.toHaveBeenCalled();
    // 不吃按键：拦下它、打开全局设置的是窗口级的应用快捷键
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Space / Enter 全局分支
// ---------------------------------------------------------------------------

describe("Space / Enter 全局快捷键", () => {
  it("Space (showResult=false) → submit", () => {
    const session = makeSessionStub(false);
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ code: "Space", key: " " }),
    );
    expect(session.submit).toHaveBeenCalledOnce();
    expect(session.selectNext).not.toHaveBeenCalled();
  });

  it("Space (showResult=true) → advanceQuestionFlow", () => {
    const session = makeSessionStub(true);
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ code: "Space", key: " " }),
    );
    expect(session.advanceQuestionFlow).toHaveBeenCalledOnce();
    expect(session.submit).not.toHaveBeenCalled();
  });

  it("Enter (showResult=false) → submit", () => {
    const session = makeSessionStub(false);
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ code: "Enter", key: "Enter" }),
    );
    expect(session.submit).toHaveBeenCalledOnce();
  });

  it("Enter on button → 不抢控件默认激活", () => {
    const session = makeSessionStub(false);
    const ui = makeUiStub();
    const button = document.createElement("button");
    const ev = mkEvent({ code: "Enter", key: "Enter", target: button });
    createKeyboardHandler(session, ui)(ev);
    expect(session.submit).not.toHaveBeenCalled();
    expect(session.advanceQuestionFlow).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("Space on ARIA button → 不抢控件默认激活", () => {
    const session = makeSessionStub(false);
    const ui = makeUiStub();
    const button = document.createElement("div");
    button.setAttribute("role", "button");
    const ev = mkEvent({ code: "Space", key: " ", target: button });
    createKeyboardHandler(session, ui)(ev);
    expect(session.submit).not.toHaveBeenCalled();
    expect(session.advanceQuestionFlow).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("IME 组合输入中的 Enter → 不提交", () => {
    const session = makeSessionStub(false);
    const ui = makeUiStub();
    const ev = mkEvent({
      code: "Enter",
      key: "Enter",
      isComposing: true,
    });
    createKeyboardHandler(session, ui)(ev);
    expect(session.submit).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("其他键 → 不触发", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ code: "KeyZ", key: "z" }),
    );
    expect(session.submit).not.toHaveBeenCalled();
    expect(session.advanceQuestionFlow).not.toHaveBeenCalled();
  });

  it("填空题未聚焦输入框时按 Space → submit", () => {
    const session = makeSessionStub(false, { questionType: "blank" });
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ code: "Space", key: " " }),
    );
    expect(session.submit).toHaveBeenCalledOnce();
    expect(session.advanceQuestionFlow).not.toHaveBeenCalled();
  });

  it("填空题上的 Enter → submit", () => {
    const session = makeSessionStub(false, { questionType: "blank" });
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ code: "Enter", key: "Enter" }),
    );
    expect(session.submit).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Dialog 内 Enter 让输入框 blur
// ---------------------------------------------------------------------------

describe("Dialog 内 Enter 行为", () => {
  it("Enter on input 在 dialog 内 → blur 输入框", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const input = document.createElement("input");
    dialog.appendChild(input);
    document.body.appendChild(dialog);
    input.focus();
    const blurSpy = vi.spyOn(input, "blur");

    const session = makeSessionStub();
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ code: "Enter", key: "Enter", target: input }),
    );
    expect(blurSpy).toHaveBeenCalled();
    expect(session.submit).not.toHaveBeenCalled();
    document.body.removeChild(dialog);
  });
});

describe("题型级字母快捷键", () => {
  it("单选题按 A → 选中 A 并提交", () => {
    const session = makeSessionStub(false, { questionType: "single" });
    const ui = makeUiStub();

    createKeyboardHandler(session, ui)(mkEvent({ code: "KeyA", key: "a" }));

    expect(session.selectedAnswers).toEqual([0]);
    expect(session.submit).toHaveBeenCalledOnce();
  });

  it("单选题关闭自动提交后按 B → 只选中不提交", () => {
    const session = makeSessionStub(false, {
      questionType: "single",
      autoSubmitOnSelection: false,
    });
    const ui = makeUiStub();

    createKeyboardHandler(session, ui)(mkEvent({ code: "KeyB", key: "b" }));

    expect(session.selectedAnswers).toEqual([1]);
    expect(session.submit).not.toHaveBeenCalled();
  });

  it("多选题按 B → 切换 B 选项", () => {
    const session = makeSessionStub(false, {
      questionType: "multiple",
      selectedAnswers: [0],
    });
    const ui = makeUiStub();

    createKeyboardHandler(session, ui)(mkEvent({ code: "KeyB", key: "b" }));
    expect(session.selectedAnswers).toEqual([0, 1]);
    expect(session.submit).not.toHaveBeenCalled();

    createKeyboardHandler(session, ui)(mkEvent({ code: "KeyA", key: "a" }));
    expect(session.selectedAnswers).toEqual([1]);
  });

  it("单选题按 2 → 选中第 2 个选项并提交", () => {
    const session = makeSessionStub(false, { questionType: "single" });
    const ui = makeUiStub();

    createKeyboardHandler(session, ui)(mkEvent({ code: "Digit2", key: "2" }));

    expect(session.selectedAnswers).toEqual([1]);
    expect(session.submit).toHaveBeenCalledOnce();
  });

  it("多选题按 2 → 切换第 2 个选项", () => {
    const session = makeSessionStub(false, {
      questionType: "multiple",
      selectedAnswers: [0],
    });
    const ui = makeUiStub();

    createKeyboardHandler(session, ui)(mkEvent({ code: "Digit2", key: "2" }));

    expect(session.selectedAnswers).toEqual([0, 1]);
    expect(session.submit).not.toHaveBeenCalled();
  });

  it("判断题按 B → 选中错误并提交", () => {
    const session = makeSessionStub(false, { questionType: "judgment" });
    const ui = makeUiStub();

    createKeyboardHandler(session, ui)(mkEvent({ code: "KeyB", key: "b" }));

    expect(session.selectedAnswers).toEqual([1]);
    expect(session.submit).toHaveBeenCalledOnce();
  });

  it("判断题按 1 / 2 → 分别对应正确 / 错误", () => {
    const session = makeSessionStub(false, { questionType: "judgment" });
    const ui = makeUiStub();
    const handler = createKeyboardHandler(session, ui);

    handler(mkEvent({ code: "Digit1", key: "1" }));
    expect(session.selectedAnswers).toEqual([0]);

    handler(mkEvent({ code: "Digit2", key: "2" }));
    expect(session.selectedAnswers).toEqual([1]);
  });

  it("在普通输入框里按 A → 不触发题型快捷键", () => {
    const session = makeSessionStub(false, { questionType: "single" });
    const ui = makeUiStub();
    const input = document.createElement("input");

    createKeyboardHandler(session, ui)(
      mkEvent({ code: "KeyA", key: "a", target: input }),
    );

    expect(session.selectedAnswers).toEqual([]);
    expect(session.submit).not.toHaveBeenCalled();
  });

  it("填空输入框里关闭选择自动提交后按 Enter → 仍提交", () => {
    const session = makeSessionStub(false, {
      questionType: "blank",
      autoSubmitOnSelection: false,
    });
    const ui = makeUiStub();
    const input = document.createElement("input");
    input.classList.add("blank-input");

    createKeyboardHandler(session, ui)(
      mkEvent({ code: "Enter", key: "Enter", target: input }),
    );

    expect(session.submit).toHaveBeenCalledOnce();
    expect(session.selectNext).not.toHaveBeenCalled();
  });

  it("填空输入框里按 Space → 不提交", () => {
    const session = makeSessionStub(false, {
      questionType: "blank",
    });
    const ui = makeUiStub();
    const input = document.createElement("input");
    input.classList.add("blank-input");

    createKeyboardHandler(session, ui)(
      mkEvent({ code: "Space", key: " ", target: input }),
    );

    expect(session.submit).not.toHaveBeenCalled();
    expect(session.selectNext).not.toHaveBeenCalled();
  });
});
