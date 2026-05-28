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
    togglePool: vi.fn(),
    toggleAutoNext: vi.fn(),
    startImport: vi.fn(),
    exportProgress: vi.fn(),
  } as unknown as QuizSession & {
    submit: ReturnType<typeof vi.fn>;
    selectNext: ReturnType<typeof vi.fn>;
    togglePool: ReturnType<typeof vi.fn>;
    toggleAutoNext: ReturnType<typeof vi.fn>;
    startImport: ReturnType<typeof vi.fn>;
    exportProgress: ReturnType<typeof vi.fn>;
  };
}

function makeUiStub(): KeyboardUiActions & {
  toggleReview: ReturnType<typeof vi.fn>;
  toggleSettings: ReturnType<typeof vi.fn>;
} {
  return {
    toggleReview: vi.fn(),
    toggleSettings: vi.fn(),
  };
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

  it("Cmd+C → toggleSettings", () => {
    const session = makeSessionStub();
    const ui = makeUiStub();
    createKeyboardHandler(session, ui)(
      mkEvent({ metaKey: true, key: SHORTCUTS.toggleSettings }),
    );
    expect(ui.toggleSettings).toHaveBeenCalledOnce();
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
