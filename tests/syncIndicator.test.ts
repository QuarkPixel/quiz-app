/**
 * 头部那个云同步指示点：黄 = 还没同步、绿 = 已经同步，点一下手动同步。
 *
 * 三种状态都必须跟引擎真实数据一致，不能是「打开页面那一刻的快照」：
 * 关掉同步不显示、没同步时是黄的、同步成功后变绿、本地一改又变黄。
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import AppShell from "@/components/layout/AppShell.svelte";
import SidebarHarness from "./SidebarHarness.svelte";
import { globalSettingsDialog } from "@/features/globalSettingsDialog.svelte";
import { syncConfigStore } from "@/features/sync/config.svelte";
import { syncEngine } from "@/features/sync/engine.svelte";
import { installStorageHook } from "@/features/sync/storage";
import { SyncHarness } from "./syncSupport";

const HASH = "aaaabbbbccccdddd";

let app: ReturnType<typeof mount> | null = null;
let target: HTMLElement;

function render(): void {
  app = mount(AppShell, { target });
  flushSync();
}

/** 指示点里那个彩色圆点（按钮上的 aria-label 是状态说明）。 */
function dot(): HTMLElement | null {
  const button = target.querySelector<HTMLElement>('button[aria-label^="云同步"]');
  return button?.querySelector("span") ?? null;
}

function indicator(): HTMLElement | null {
  return target.querySelector<HTMLElement>('button[aria-label^="云同步"]');
}

beforeEach(() => {
  installStorageHook();
  localStorage.clear();
  syncConfigStore.reload();
  // `dispose()` 会把「配置变更订阅」也摘掉，所以每个用例都重新 init 一次；
  // 对应地在 afterEach 里 dispose，免得轮询定时器漏在用例之间。
  syncEngine.init();
  globalSettingsDialog.open = false;
  // 引擎是模块级单例，会跨用例留着状态：按「刚打开页面」重置一次
  syncEngine.pendingChanges = true;
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
  syncEngine.dispose();
  if (app) unmount(app);
  app = null;
  target.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("头部的云同步指示点", () => {
  test("关掉云同步时不显示", () => {
    syncConfigStore.update({ enabled: false, token: "tok", gistId: "" });
    render();
    expect(indicator()).toBeNull();
  });

  test("开着但还没同步 → 黄；真的同步成功 → 绿", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      h.save("A");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });

      render();
      expect(dot()?.className, "还没同步过应该是黄的").toContain("bg-warning");
      expect(indicator()?.getAttribute("aria-label")).toContain("还没同步");

      await syncEngine.sync();
      flushSync();

      expect(dot()?.className, "同步成功之后应该是绿的").toContain("bg-success");
      expect(indicator()?.getAttribute("aria-label")).toContain("已同步");
    } finally {
      await h.stop();
    }
  });

  test("本地一改动就立刻变黄（不用等下一轮同步）", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      h.save("A");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });

      render();
      await syncEngine.sync();
      flushSync();
      expect(dot()?.className).toContain("bg-success");

      // 本地改动监听在 beforeEach 的 init 里已经装好了（autoSync 关着，不会自己跑同步）
      h.studyBank(HASH, 9);
      flushSync();
      expect(dot()?.className, "本地改了东西就该变黄").toContain("bg-warning");
    } finally {
      await h.stop();
    }
  });

  test("点一下就手动同步一次", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      h.save("A");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });

      render();
      const spy = vi.spyOn(syncEngine, "sync");
      indicator()?.click();

      await vi.waitFor(
        () => {
          expect(spy).toHaveBeenCalled();
        },
        { timeout: 4000 },
      );
      await vi.waitFor(
        () => {
          expect(dot()?.className).toContain("bg-success");
        },
        { timeout: 4000 },
      );

      // 点了不给任何提示：变绿就是反馈，不许弹 toast / alert
      expect(document.body.textContent).not.toContain("同步完成");
      expect(document.body.textContent).not.toContain("已是最新");
      expect(document.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await h.stop();
    }
  });

  test("绿色（已同步）时也能点：点一下手动同步一次（想主动拉云端改动）", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      h.save("A");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });

      render();
      await syncEngine.sync();
      flushSync();
      expect(dot()?.className).toContain("bg-success");

      // 绿色照样可点、照样吃 hover：绿了以后主动同步一次是常见需求
      expect(indicator()?.getAttribute("aria-disabled")).toBe("false");
      expect(dot()?.className).toContain("group-hover:brightness-125");
      expect(dot()?.className).toContain("shadow-[0_0_6px_var(--success)]");
      expect(dot()?.className).toContain("group-hover:shadow-[0_0_12px_var(--success)]");

      const spy = vi.spyOn(syncEngine, "sync").mockResolvedValue(undefined);
      indicator()?.click();
      expect(spy, "绿色时点一下应该触发一次同步").toHaveBeenCalledTimes(1);
      // 绿色点击是同步，不是把人送去设置
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.querySelector('[role="alert"]')).toBeNull();
    } finally {
      await h.stop();
    }
  });

  test("从绿色点一下：跑的过程中不会先闪成黄色（跑完仍是绿的）", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      h.save("A");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });

      render();
      await syncEngine.sync();
      flushSync();
      expect(dot()?.className).toContain("bg-success");

      indicator()?.click();
      // 同步是同步的：`phase` 已经变成 syncing，但颜色必须还是绿的
      // （正在跑用圆点脉冲表示，不该让人以为突然冒出了没传上去的改动）
      expect(syncEngine.status.phase).toBe("syncing");
      flushSync();
      expect(dot()?.className).toContain("bg-success");
      expect(dot()?.className).not.toContain("bg-warning");
      expect(dot()?.className).toContain("animate-pulse");

      await syncEngine.sync();
      flushSync();
      expect(syncEngine.status.phase).toBe("idle");
      expect(dot()?.className).toContain("bg-success");
      expect(dot()?.className).not.toContain("animate-pulse");
    } finally {
      await h.stop();
    }
  });

  test("报错后重试期间一直是红的（不闪绿也不闪黄）", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      h.save("A");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "g1",
        autoSync: false,
      });

      render();
      // 让这一轮失败：Gist 不存在（引擎会记成 error → 红）
      await syncEngine.sync();
      flushSync();
      expect(dot()?.className).toContain("bg-destructive");

      // 再同步一次（后台轮询 / 用户手动都会走到这儿）：跑的过程中还是红的
      void syncEngine.sync();
      flushSync();
      expect(dot()?.className).toContain("bg-destructive");
      expect(dot()?.className).not.toContain("bg-success");
      expect(dot()?.className).not.toContain("bg-warning");

      await syncEngine.sync();
      flushSync();
      expect(dot()?.className).toContain("bg-destructive");
    } finally {
      await h.stop();
    }
  });

  test("有冲突时变红，点一下打开全局设置（而不是又同步一遍）", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });

      // A：建题库 + 推到云端
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      await syncEngine.sync();
      const gistId = syncConfigStore.value.gistId;
      expect(gistId).toBeTruthy();
      h.save("A");

      // B：拉下来
      h.freshDevice("B");
      syncConfigStore.update({ enabled: true, token: "tok", gistId, autoSync: false });
      await syncEngine.sync();
      h.save("B");

      // A 改进度 3、B 改进度 9 → 两边都改过同一个题库
      h.use("A");
      h.studyBank(HASH, 3);
      h.save("A");
      await syncEngine.sync();
      h.save("A");

      h.use("B");
      h.studyBank(HASH, 9);
      h.save("B");
      render();
      await syncEngine.sync();
      flushSync();

      expect(syncEngine.status.conflicts).toHaveLength(1);
      expect(dot()?.className, "有冲突应该是红的").toContain("bg-destructive");
      expect(dot()?.className).toContain(
        "shadow-[0_0_6px_var(--destructive)]",
      );
      expect(indicator()?.getAttribute("aria-label")).toContain("冲突");
      expect(indicator()?.getAttribute("aria-disabled")).toBe("false");

      const spy = vi.spyOn(syncEngine, "sync");
      indicator()?.click();

      expect(globalSettingsDialog.open, "点红色要打开全局设置").toBe(true);
      expect(spy, "有冲突时不该再同步一次").not.toHaveBeenCalled();
    } finally {
      await h.stop();
    }
  });

  test("同步报错时也变红，点一下打开全局设置（而不是盲目重试）", () => {
    syncConfigStore.update({ enabled: true, token: "tok", gistId: "g1" });
    syncEngine.status = {
      ...syncEngine.status,
      phase: "error",
      message: "云端那条 Gist 不见了（被删了，或令牌换了账号）。",
    };
    render();

    expect(dot()?.className, "报错要标红").toContain("bg-destructive");
    expect(indicator()?.getAttribute("aria-label")).toContain("Gist 不见了");
    expect(indicator()?.getAttribute("aria-disabled")).toBe("false");

    const spy = vi.spyOn(syncEngine, "sync");
    indicator()?.click();
    expect(globalSettingsDialog.open, "红色时点击是去设置里处理").toBe(true);
    expect(spy, "报错时不该只是再同步一遍").not.toHaveBeenCalled();
  });

  test("离线仍然是黄的（联网后自己会好，不该标红吓人）", () => {
    syncConfigStore.update({ enabled: true, token: "tok", gistId: "g1" });
    syncEngine.status = {
      ...syncEngine.status,
      phase: "offline",
      message: "当前离线，联网后会自动重试",
    };
    render();

    expect(dot()?.className).toContain("bg-warning");
    expect(indicator()?.getAttribute("aria-label")).toContain("离线");
  });

  test("黄色时可点：提着亮 + 光晕更强都挂在 hover 上", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      h.save("A");
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "",
        autoSync: false,
      });

      render();
      expect(indicator()?.getAttribute("aria-disabled")).toBe("false");
      expect(dot()?.className).toContain("bg-warning");
      expect(dot()?.className).toContain("shadow-[0_0_6px_var(--warning)]");
      expect(dot()?.className).toContain("group-hover:brightness-125");
      expect(dot()?.className).toContain(
        "group-hover:shadow-[0_0_12px_var(--warning)]",
      );
      // hover 不再是背景色
      expect(indicator()?.className).not.toContain("hover:bg-accent");
    } finally {
      await h.stop();
    }
  });
});

describe("侧边栏「全局设置」上的冲突提示点", () => {
  function renderSidebar(): void {
    app = mount(SidebarHarness, { target });
    flushSync();
  }

  /** 「全局设置」那个按钮右上角的红点。 */
  function conflictDot(): HTMLElement | null {
    const button = [...target.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("全局设置"),
    );
    return button?.querySelector("span.bg-destructive") ?? null;
  }

  function withConflicts(): void {
    syncEngine.status = {
      ...syncEngine.status,
      phase: "conflict",
      conflicts: [
        {
          hash: "aaaabbbbccccdddd",
          name: "题库一",
          detail: "两边都改过",
          localAt: 1,
          remoteHash: "h",
        },
      ],
    };
  }

  test("有冲突时点一个红点，关掉云同步之后就不再显示", () => {
    syncConfigStore.update({ enabled: true, token: "tok", gistId: "g1" });
    withConflicts();
    renderSidebar();
    expect(conflictDot(), "开着同步 + 有冲突 → 红点").not.toBeNull();

    syncConfigStore.update({ enabled: false });
    flushSync();
    expect(conflictDot(), "关掉云同步之后不该再提示待处理").toBeNull();

    // 只是关掉显示还不够：引擎那边也把冲突状态清干净了
    expect(syncEngine.status.conflicts).toEqual([]);
    expect(syncEngine.status.phase).toBe("disabled");
  });

  test("同步报错时也点红点（不只是冲突）", () => {
    syncConfigStore.update({ enabled: true, token: "tok", gistId: "g1" });
    syncEngine.status = {
      ...syncEngine.status,
      phase: "error",
      message: "Gitee 令牌无效或过期",
    };
    renderSidebar();

    const button = [...target.querySelectorAll("button")].find((el) =>
      el.textContent?.includes("全局设置"),
    );
    expect(
      button?.querySelector("span.bg-destructive"),
      "报错也要能看到（点开就是设置）",
    ).not.toBeNull();

    syncConfigStore.update({ enabled: false });
    flushSync();
    expect(
      button?.querySelector("span.bg-destructive"),
      "关掉同步之后同样不该留",
    ).toBeNull();
  });

  test("开关打开但引擎还没报冲突时不显示", () => {
    syncConfigStore.update({ enabled: true, token: "tok", gistId: "g1" });
    renderSidebar();
    expect(conflictDot()).toBeNull();

    withConflicts();
    flushSync();
    expect(conflictDot(), "状态一来就要跟着显示").not.toBeNull();
  });
});
