/**
 * 「云同步要刷新，但用户正在做事」这一条规矩（`src/features/userActivity.svelte.ts`）。
 *
 * 这是线上踩过的那个 bug 的护栏：答题答到一半，同步从云端拉到当前题库的新内容
 * 就整页刷新一次，页面自己跳回首页、刚答的题也不知去向。
 *
 * 三条「现在不能打断」的理由各一个用例，外加一条「空闲时该刷还是刷」——
 * 少了最后这条，一个永久挂起的实现也能过前面三条。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";

import { toastStore } from "@/features/toast.svelte";
import {
  OVERLAY_KEYS,
  UserActivityStore,
  attachReloadGuard,
  disposeReloadGuard,
} from "@/features/userActivity.svelte";

/**
 * 每个用例都用**自己的** store + guard，而不是应用级那两个单例：
 * 模块级 `$effect.root` 是在 import 时就跑过一次的，测试里再碰它就分不清
 * 「谁把 pendingReload 置上的」。这里先把它拆掉，再装一份能数的。
 */
let activity: UserActivityStore;
let detach: () => void;
let reloads: number;

beforeEach(() => {
  activity = new UserActivityStore();
  reloads = 0;
  disposeReloadGuard();
  toastStore.dismiss();
  detach = attachReloadGuard(() => {
    reloads += 1;
  }, activity);
});

afterEach(() => {
  detach();
  toastStore.dismiss();
});

/**
 * 走一遍调用方（同步引擎）那两行，并把响应式副作用结算掉（等价于一个 tick）：
 *
 *   if (userActivity.requestReload("synced")) window.location.reload();
 */
function requestReload(): boolean {
  // 参数用真的 `location.reload` 替身：测试里数的是「刷新发生了几次」
  const spy = vi.spyOn(window.location, "reload").mockImplementation(() => {
    reloads += 1;
  });
  const immediate = activity.requestReload("synced");
  if (immediate) window.location.reload();
  flushSync();
  spy.mockRestore();
  return immediate;
}

describe("能不能打断", () => {
  it("什么都不占：立刻就能刷", () => {
    expect(activity.canReload).toBe(true);
    expect(requestReload()).toBe(true);
    expect(reloads).toBe(1);
  });

  it("正在答题：挂起，等答完自己补上", () => {
    activity.setAnswering(true);

    expect(requestReload()).toBe(false);
    expect(reloads, "答题期间绝不允许整页刷新").toBe(0);
    expect(activity.pendingReload).toBe("synced");

    activity.setAnswering(false);
    flushSync();

    expect(reloads, "停手之后那一笔要自己补上").toBe(1);
    expect(activity.pendingReload).toBeNull();
  });

  it("弹窗开着：挂起，关掉再刷", () => {
    activity.setOverlay(OVERLAY_KEYS.settings, true);

    expect(requestReload()).toBe(false);
    expect(reloads).toBe(0);

    // 关掉另一个弹窗不算关掉这个（按名字记账）
    activity.setOverlay(OVERLAY_KEYS.overview, false);
    flushSync();
    expect(reloads).toBe(0);

    activity.setOverlay(OVERLAY_KEYS.settings, false);
    flushSync();
    expect(reloads).toBe(1);
  });

  it("页面在后台：挂起，回到前台再刷", () => {
    activity.setHidden(true);

    expect(requestReload()).toBe(false);
    expect(reloads).toBe(0);

    activity.setHidden(false);
    flushSync();

    expect(reloads).toBe(1);
  });

  it("挂起之后连请求好几次：只刷一次", () => {
    activity.setAnswering(true);
    activity.requestReload("synced");
    activity.requestReload("synced");
    activity.requestReload("synced");

    activity.setAnswering(false);
    flushSync();
    expect(reloads).toBe(1);

    // 补完之后没有残留：再来一次空闲的请求仍然照常
    flushSync();
    expect(reloads).toBe(1);
    expect(requestReload()).toBe(true);
    expect(reloads).toBe(2);
  });

  it("真刷新之前弹一条提示（不然用户只看到页面自己跳了）", () => {
    activity.setAnswering(true);
    requestReload();
    expect(toastStore.current, "挂起时不打扰用户").toBeNull();

    activity.setAnswering(false);
    flushSync();

    expect(reloads).toBe(1);
    expect(toastStore.current?.title).toBe("已拉取云端更新");
  });

  it("三条理由叠在一起：全放开才刷", () => {
    activity.setAnswering(true);
    activity.setOverlay(OVERLAY_KEYS.overview, true);
    activity.setHidden(true);
    activity.requestReload("synced");

    activity.setAnswering(false);
    flushSync();
    expect(reloads).toBe(0);

    activity.setOverlay(OVERLAY_KEYS.overview, false);
    flushSync();
    expect(reloads).toBe(0);

    activity.setHidden(false);
    flushSync();
    expect(reloads).toBe(1);
  });
});

describe("按名字记账的弹窗占位", () => {
  it("同名重复占位不会叠加，关一次就干净", () => {
    activity.setOverlay(OVERLAY_KEYS.settings, true);
    activity.setOverlay(OVERLAY_KEYS.settings, true);
    activity.setOverlay(OVERLAY_KEYS.settings, false);

    expect(activity.overlayOpen).toBe(false);
  });

  it("关掉不存在的占位不会把别人的一起关掉", () => {
    activity.setOverlay(OVERLAY_KEYS.settings, true);
    activity.setOverlay(OVERLAY_KEYS.importProgress, false);

    expect(activity.overlayOpen).toBe(true);
  });
});

describe("reset（测试隔离）", () => {
  it("把三条理由与挂起状态一起清掉", () => {
    activity.setAnswering(true);
    activity.setOverlay(OVERLAY_KEYS.settings, true);
    activity.setHidden(true);
    activity.requestReload("synced");

    activity.reset();

    expect(activity.canReload).toBe(true);
    expect(activity.pendingReload).toBeNull();
  });
});

describe("页面可见性接线", () => {
  it("根据 document.visibilityState 设置 hidden", async () => {
    const { watchPageVisibility } = await import(
      "@/features/userActivity.svelte"
    );
    // happy-dom 里默认是 "visible"
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const off = watchPageVisibility();

    // 接线用的是应用级单例（`userActivity`），这里只验它真的被改到了
    const { userActivity } = await import("@/features/userActivity.svelte");
    expect(userActivity.hidden).toBe(true);

    off();
    userActivity.reset();
  });
});
