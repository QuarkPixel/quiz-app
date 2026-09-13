import { describe, it, expect } from "vitest";
import {
  hasSelectedTextToCopy,
  isInsideDialog,
  isMemoryShortcutIgnored,
  shouldDeferMemoryAction,
} from "../src/features/memory/keyboard";

/**
 * 记忆模式的窗口级快捷键守卫。
 *
 * 回归背景：`MemoryView` 曾经自己写了一套判定，缺了刷题模式里的
 * `isInteractiveTarget` / `defaultPrevented` 守卫，于是焦点落在按钮上时
 * `Space` / `Enter` 会「原生点击 + 全局处理器」各触发一次——答案页会连跳两题，
 * 刚显示的那张卡被静默排到队尾。
 */
function keydownOn(
  target: Element,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

describe("记忆模式：快捷键守卫", () => {
  it("默认放行；已经处理过 / 输入法组词的按键忽略", () => {
    const plain = document.createElement("div");
    expect(isMemoryShortcutIgnored(keydownOn(plain))).toBe(false);

    const composing = keydownOn(plain, { isComposing: true });
    expect(isMemoryShortcutIgnored(composing)).toBe(true);

    const prevented = keydownOn(plain);
    prevented.preventDefault();
    expect(prevented.defaultPrevented).toBe(true);
    expect(isMemoryShortcutIgnored(prevented)).toBe(true);
  });

  it("输入框里的按键交给浏览器（不要在打字时触发知道 / 忘记）", () => {
    const input = document.createElement("input");
    expect(isMemoryShortcutIgnored(keydownOn(input))).toBe(true);

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isMemoryShortcutIgnored(keydownOn(editable))).toBe(true);
  });

  it("对话框内的按键不穿透（设置 / 总览打开时只允许对话框自己的 Esc）", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);

    const event = keydownOn(button);
    expect(isInsideDialog(event)).toBe(true);
    expect(isMemoryShortcutIgnored(event)).toBe(true);
  });

  it("「下一题 / 记错了」落在按钮上时让给原生点击，避免双触发", () => {
    const button = document.createElement("button");
    const plain = document.createElement("div");

    expect(shouldDeferMemoryAction(keydownOn(button), { kind: "next" })).toBe(
      true,
    );
    expect(
      shouldDeferMemoryAction(keydownOn(button), { kind: "mark-wrong" }),
    ).toBe(true);
    // 焦点不在交互目标上时，全局处理器必须自己接管
    expect(shouldDeferMemoryAction(keydownOn(plain), { kind: "next" })).toBe(
      false,
    );
    // 「选择答案」（知道 / 忘记）在记忆模式里没有原生对应物，只能由全局处理器做
    expect(
      shouldDeferMemoryAction(keydownOn(button), {
        kind: "set-selected-answers",
        value: [1],
      }),
    ).toBe(false);
  });

  it("选中了文本时不抢 ⌘C", () => {
    expect(hasSelectedTextToCopy()).toBe(false);

    const text = document.createTextNode("题干文本");
    document.body.appendChild(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(hasSelectedTextToCopy()).toBe(true);

    selection?.removeAllRanges();
    document.body.removeChild(text);
  });
});
