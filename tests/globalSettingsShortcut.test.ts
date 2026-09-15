import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import {
  handleGlobalSettingsShortcut,
  isGlobalSettingsShortcut,
} from "../src/features/globalSettingsShortcut";
import { globalSettingsDialog } from "../src/features/globalSettingsDialog.svelte";
import { syncConfigStore } from "../src/features/sync/config.svelte";
import { syncEngine } from "../src/features/sync/engine.svelte";
import { installStorageHook } from "../src/features/sync/storage";
import { SHORTCUTS } from "../src/config";
import SidebarHarness from "./SidebarHarness.svelte";
// 全局设置对话框是按需加载的（首屏不为它买单）。vitest 的 SSR 运行器里，
// 动态 import 一个「图里有 bits-ui 根入口」的模块会一直挂着（`import("bits-ui")`
// 直接超时），所以这里先静态引一次把它塞进模块缓存——生产构建里仍然是懒加载
// （构建产物里它是独立 chunk，见 GlobalSettings-*.js）。
import "./../src/components/settings/GlobalSettings.svelte";

/**
 * 全局设置的应用级快捷键（⌘⇧I / Ctrl+Shift+I）。
 *
 * 它和 `SHORTCUTS.toggleSettings`（⌘I = 当前题库设置）同键不同修饰键。
 * 两个模态视图必须先放行它：刷题模式那边的回归在
 * `tests/keyboardHandler.test.ts`，记忆模式是 `MemoryView.svelte` 里的一行早退；
 * 这个文件只管「键位识别 + 打开对话框 + 侧边栏真的接上了线」。
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

/** 真按下 ⇧ 时 `key` 是大写 "I"；两种写法都要认。 */
const COMBO: KeyboardEventInit = { key: "I", metaKey: true, shiftKey: true };

describe("全局设置快捷键：键位识别", () => {
  it("⌘⇧I / Ctrl+Shift+I 命中（大小写都认）", () => {
    expect(
      isGlobalSettingsShortcut(keydownOn(document.body, COMBO)),
    ).toBe(true);
    expect(
      isGlobalSettingsShortcut(
        keydownOn(document.body, { ...COMBO, key: "i" }),
      ),
    ).toBe(true);
    expect(
      isGlobalSettingsShortcut(
        keydownOn(document.body, {
          key: "I",
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(true);
  });

  it("少一个修饰键就不是它（⌘I 归当前题库设置）", () => {
    expect(
      isGlobalSettingsShortcut(
        keydownOn(document.body, { key: "i", metaKey: true }),
      ),
    ).toBe(false);
    expect(
      isGlobalSettingsShortcut(
        keydownOn(document.body, { key: "I", shiftKey: true }),
      ),
    ).toBe(false);
    expect(
      isGlobalSettingsShortcut(
        keydownOn(document.body, {
          key: "I",
          metaKey: true,
          shiftKey: true,
          altKey: true,
        }),
      ),
    ).toBe(false);
  });

  it("别的字母不算", () => {
    expect(
      isGlobalSettingsShortcut(
        keydownOn(document.body, {
          key: SHORTCUTS.togglePool.toUpperCase(),
          metaKey: true,
          shiftKey: true,
        }),
      ),
    ).toBe(false);
  });
});

describe("全局设置快捷键：打开对话框", () => {
  beforeEach(() => {
    globalSettingsDialog.close();
  });

  it("窗口收到 ⌘⇧I → 打开全局设置并吃掉这次按键", () => {
    const event = keydownOn(document.body, COMBO);
    expect(handleGlobalSettingsShortcut(event)).toBe(true);
    expect(globalSettingsDialog.open).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("已经打开时不重复开（只认「打开」这一个动作）", () => {
    globalSettingsDialog.show();
    const event = keydownOn(document.body, COMBO);
    expect(handleGlobalSettingsShortcut(event)).toBe(true);
    expect(globalSettingsDialog.open).toBe(true);
  });

  it("不是这个键位就完全不碰", () => {
    const event = keydownOn(document.body, { key: "i", metaKey: true });
    expect(handleGlobalSettingsShortcut(event)).toBe(false);
    expect(globalSettingsDialog.open).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("对话框里的按键不穿透（别在题库设置上再叠一个全局设置）", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const input = document.createElement("input");
    dialog.appendChild(input);

    const event = keydownOn(input, COMBO);
    expect(handleGlobalSettingsShortcut(event)).toBe(false);
    expect(globalSettingsDialog.open).toBe(false);
  });

  it("输入法组词中 / 已被别人处理的按键不碰", () => {
    const composing = keydownOn(document.body, {
      ...COMBO,
      isComposing: true,
    });
    expect(handleGlobalSettingsShortcut(composing)).toBe(false);
    expect(globalSettingsDialog.open).toBe(false);

    const prevented = keydownOn(document.body, COMBO);
    prevented.preventDefault();
    expect(handleGlobalSettingsShortcut(prevented)).toBe(false);
    expect(globalSettingsDialog.open).toBe(false);
  });
});

describe("接线：窗口监听挂在侧边栏上", () => {
  let app: ReturnType<typeof mount> | null = null;
  let target: HTMLElement;

  beforeEach(() => {
    installStorageHook();
    localStorage.clear();
    syncConfigStore.reload();
    syncEngine.init();
    globalSettingsDialog.open = false;
    target = document.createElement("div");
    document.body.appendChild(target);
  });

  afterEach(() => {
    syncEngine.dispose();
    // 先把对话框关掉再卸载，免得 bits-ui 的 portal / $derived 在拆卸后再算一次
    globalSettingsDialog.close();
    if (app) {
      flushSync();
      unmount(app);
    }
    app = null;
    target.remove();
    localStorage.clear();
  });

  it("窗口上按 ⌘⇧I → 全局设置对话框真的开出来了", async () => {
    app = mount(SidebarHarness, { target });
    flushSync();

    // 侧边栏是对话框的宿主，也是这个快捷键的窗口监听所在
    const event = new KeyboardEvent("keydown", {
      ...COMBO,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    flushSync();

    expect(globalSettingsDialog.open).toBe(true);

    // 对话框是按需加载的（首屏不为它买单）：开关先置上，chunk 到位后才挂载
    await vi.waitFor(
      () => {
        const dialog = document.querySelector('[role="dialog"]');
        expect(dialog?.textContent).toContain("全局设置");
      },
      { timeout: 4000 },
    );
  });
});
