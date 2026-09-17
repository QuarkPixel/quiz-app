/**
 * ⌘Y（Ctrl+Y）：手动同步一次——**等价于点击页头那颗同步指示点**。
 *
 * 这个文件守三件事：
 *   1. 键位识别（与 ⌘⇧Y / ⌘⌥Y / 裸 y 区分）；
 *   2. **只有开着云同步才有这个快捷键**——关着时连按键都不碰
 *      （留给浏览器的历史记录），这是需求里明确的一条；
 *   3. 接线：窗口监听真的挂在页头（`AppShell`）上，红点状态下打开全局设置
 *      而不是又同步一遍（跟点击指示点同一套规矩）。
 *
 * 指示点本身的三种状态在 `tests/syncIndicator.test.ts`，这里只管快捷键这条路。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import AppShell from "@/components/layout/AppShell.svelte";
import { SHORTCUTS } from "@/config";
import { globalSettingsDialog } from "@/features/globalSettingsDialog.svelte";
import { syncConfigStore } from "@/features/sync/config.svelte";
import { syncEngine } from "@/features/sync/engine.svelte";
import {
  handleSyncNowShortcut,
  isSyncNowShortcut,
} from "@/features/sync/shortcut";

function keydownOn(
  target: EventTarget,
  init: KeyboardEventInit = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: SHORTCUTS.syncNow,
    metaKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

/** 最小宿主：只关心「按键被不被吃掉」和「run 跑没跑」。 */
function makeHost(enabled = true) {
  const run = vi.fn();
  return { host: { enabled, run }, run };
}

describe("同步快捷键：键位识别", () => {
  it("⌘Y / Ctrl+Y 命中（大小写都认）", () => {
    expect(isSyncNowShortcut(keydownOn(document.body))).toBe(true);
    expect(
      isSyncNowShortcut(keydownOn(document.body, { ctrlKey: true, metaKey: false })),
    ).toBe(true);
    expect(
      isSyncNowShortcut(keydownOn(document.body, { key: "Y" })),
    ).toBe(true);
  });

  it("少一个修饰键就不是它", () => {
    // 裸 y 是题目级快捷键的字母，不归这里
    expect(
      isSyncNowShortcut(keydownOn(document.body, { metaKey: false })),
    ).toBe(false);
    expect(
      isSyncNowShortcut(keydownOn(document.body, { shiftKey: true })),
    ).toBe(false);
    expect(
      isSyncNowShortcut(keydownOn(document.body, { altKey: true })),
    ).toBe(false);
  });

  it("别的字母不算", () => {
    expect(
      isSyncNowShortcut(
        keydownOn(document.body, {
          key: SHORTCUTS.exportProgress,
        }),
      ),
    ).toBe(false);
  });
});

describe("同步快捷键：等价于点击指示点", () => {
  it("开了云同步 → 吃掉这次按键并跑一遍指示点的动作", () => {
    const { host, run } = makeHost();
    const event = keydownOn(document.body);

    expect(handleSyncNowShortcut(event, host)).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it("关掉云同步 → 完全不碰这次按键（⌘Y 还给浏览器）", () => {
    const { host, run } = makeHost(false);
    const event = keydownOn(document.body);

    expect(handleSyncNowShortcut(event, host)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("不是这个键位 → 不碰", () => {
    const { host, run } = makeHost();
    const event = keydownOn(document.body, { key: "u" });

    expect(handleSyncNowShortcut(event, host)).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("对话框里的按键不穿透（与 ⌘I / ⌘⇧I 同一个口径）", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const input = document.createElement("input");
    dialog.appendChild(input);

    const { host, run } = makeHost();
    const event = keydownOn(input);

    expect(handleSyncNowShortcut(event, host)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("输入法组词中 / 已被别人处理的按键不碰", () => {
    const { host, run } = makeHost();

    expect(
      handleSyncNowShortcut(
        keydownOn(document.body, { isComposing: true }),
        host,
      ),
    ).toBe(false);

    const prevented = keydownOn(document.body);
    prevented.preventDefault();
    expect(handleSyncNowShortcut(prevented, host)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("接线：窗口监听挂在页头上", () => {
  let app: ReturnType<typeof mount> | null = null;
  let target: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    syncConfigStore.reload();
    globalSettingsDialog.open = false;
    // 引擎是模块级单例，会跨用例留着状态：按「刚打开页面」重置一次
    syncEngine.status = {
      phase: "idle",
      message: "还没同步过",
      at: 0,
      remoteCount: 0,
      remoteBanks: 0,
      conflicts: [],
    };
    target = document.createElement("div");
    document.body.appendChild(target);
  });

  afterEach(() => {
    if (app) unmount(app);
    app = null;
    target.remove();
    globalSettingsDialog.open = false;
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function render(): void {
    app = mount(AppShell, { target });
    flushSync();
  }

  function enableSync(patch: Record<string, unknown> = {}): void {
    syncConfigStore.update({
      enabled: true,
      token: "tok",
      gistId: "g1",
      autoSync: false,
      ...patch,
    });
    flushSync();
  }

  it("窗口上按 ⌘Y → 同步一次（跟点指示点同一个动作）", () => {
    enableSync();
    render();
    const spy = vi.spyOn(syncEngine, "sync").mockResolvedValue(undefined);

    const event = keydownOn(window);
    flushSync();

    expect(spy).toHaveBeenCalledOnce();
    expect(event.defaultPrevented, "开着同步时 ⌘Y 是这个应用的键").toBe(true);
  });

  it("云同步关着 → 快捷键不存在（不碰按键、也不同步）", () => {
    syncConfigStore.update({ enabled: false, token: "tok", gistId: "" });
    render();
    const spy = vi.spyOn(syncEngine, "sync").mockResolvedValue(undefined);

    const event = keydownOn(window);
    flushSync();

    expect(spy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("红色（有冲突 / 报错）时按 ⌘Y → 打开全局设置，而不是又同步一遍", () => {
    enableSync();
    syncEngine.status = {
      ...syncEngine.status,
      phase: "error",
      message: "Gitee 令牌无效或过期",
    };
    render();
    const spy = vi.spyOn(syncEngine, "sync").mockResolvedValue(undefined);

    keydownOn(window);
    flushSync();

    expect(globalSettingsDialog.open, "红色是去设置里处理").toBe(true);
    expect(spy, "报错时不该只是再同步一遍").not.toHaveBeenCalled();
  });

  it("正在同步中按 ⌘Y → 空操作（跟不可点的指示点一致），按键仍然吃掉", () => {
    enableSync();
    render();
    const spy = vi.spyOn(syncEngine, "sync").mockResolvedValue(undefined);
    syncEngine.status = { ...syncEngine.status, phase: "syncing" };

    const event = keydownOn(window);
    flushSync();

    expect(spy).not.toHaveBeenCalled();
    expect(event.defaultPrevented, "别顺手弹出浏览器的历史记录").toBe(true);
  });

  it("指示点的标题带上快捷键（真的按得动时才挂）", () => {
    enableSync();
    render();
    const label = target
      .querySelector<HTMLElement>('button[aria-label^="云同步"]')
      ?.getAttribute("title");
    expect(label).toContain("Y");

    syncEngine.status = { ...syncEngine.status, phase: "syncing" };
    flushSync();
    expect(
      target
        .querySelector<HTMLElement>('button[aria-label^="云同步"]')
        ?.getAttribute("title"),
      "跑着的时候提示 ⌘Y 是骗人",
    ).not.toContain("Y");
  });
});
