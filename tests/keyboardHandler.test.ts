import { describe, it, expect, vi } from "vitest";
import {
  createKeyboardHandler,
  type KeyboardUiActions,
} from "../src/quiz/session/keyboardHandler";
import { SHORTCUTS } from "../src/config";
import type { QuizSession } from "../src/quiz/session/QuizSession.svelte";

// QuizSession 是 class，但 keyboardHandler 只用其上的几个方法 + showResult 字段。
// 用最小 stub 模拟，避免引入 svelte 运行时。
function makeSessionStub(showResult = false) {
  return {
    showResult,
    submit: vi.fn(),
    selectNext: vi.fn(),
    copyCurrentQuestion: vi.fn(),
    togglePool: vi.fn(),
    toggleAutoNext: vi.fn(),
    startImport: vi.fn(),
    exportProgress: vi.fn(),
  } as unknown as QuizSession & {
    submit: ReturnType<typeof vi.fn>;
    selectNext: ReturnType<typeof vi.fn>;
    copyCurrentQuestion: ReturnType<typeof vi.fn>;
    togglePool: ReturnType<typeof vi.fn>;
    toggleAutoNext: ReturnType<typeof vi.fn>;
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

  it("Space (showResult=true) → selectNext", () => {
    const session = makeSessionStub(true);
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ code: "Space", key: " " }),
    );
    expect(session.selectNext).toHaveBeenCalledOnce();
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
    expect(session.selectNext).not.toHaveBeenCalled();
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
    expect(session.selectNext).not.toHaveBeenCalled();
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
    expect(session.selectNext).not.toHaveBeenCalled();
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
