/**
 * 头部那个云同步指示点：黄 = 还没同步、绿 = 已经同步，点一下手动同步。
 *
 * 三种状态都必须跟引擎真实数据一致，不能是「打开页面那一刻的快照」：
 * 关掉同步不显示、没同步时是黄的、同步成功后变绿、本地一改又变黄。
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import AppShellHarness from "./AppShellHarness.svelte";
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
  app = mount(AppShellHarness, { target });
  flushSync();
}

/** `src/app.css` 原文。 */
function cssOfApp(): string {
    return readFileSync(resolve("src/app.css"), "utf8");
}

/** `@keyframes wink` 的正文（手动点击那一下的「亮 + 跳」）。 */
function winkKeyframes(): string {
    const match = cssOfApp().match(/@keyframes wink\s*\{([\s\S]*?)\n\}/);
    expect(match, "找不到 @keyframes wink").not.toBeNull();
    return match![1];
}

/**
 * 指示点本体（那颗圆点就在它里面）。
 *
 * 用 `data-slot` 找而不是拿 `aria-label` 的前缀找：标签本身就是被测的状态文案
 * （「还没同步」/「已同步」…），拿它当选择器等于把「文案怎么写」也钉死了。
 */
function indicator(): HTMLElement | null {
  return target.querySelector<HTMLElement>('[data-slot="sync-indicator"]');
}

/** 那颗圆点（一直是个 `<span>`，同步中也还是它，只是多一个呼吸动画）。 */
function dot(): HTMLElement | null {
  return indicator()?.querySelector("span") ?? null;
}

/**
 * 指示点当前是哪种状态色。
 *
 * 颜色不再写成一堆 `bg-success` / `bg-warning` / `bg-destructive`，而是按钮上
 * 一个 CSS 变量（`--tone-color`）——圆点底色、光晕、「亮一下」的动画颜色全都
 * 从它取值，不会各写一份。「是哪种色」因此要连**变量指向谁**一起断言：
 * happy-dom 不解析 `var()` 级联，所以下面还额外钉住 `bg-(--tone-color)` 这个
 * 实实在在生成了 CSS 的类名（写错了变量名它就什么都不上色）。
 */
function toneColorVar(): string {
  const style = indicator()?.getAttribute("style") ?? "";
  const match = style.match(/--tone-color:\s*var\((--[\w-]+)\)/);
  return match?.[1] ?? "";
}

/** 圆点该带着读变量的底色类 + 那一圈光晕。 */
function expectToneDot(): void {
  expect(dot()?.className, "圆点要从 --tone-color 取色").toContain(
    "bg-(--tone-color)",
  );
  expect(dot()?.className, "光晕还是旧版那种 box-shadow").toContain(
    "shadow-[0_0_6px_var(--tone-color)]",
  );
}

/**
 * 正在跑：圆点自己（不是按钮、也不是别的元素）挂呼吸动画，
 * 而且颜色是「跑之前」那一色。
 */
function expectBreathing(tone: string): void {
  const style = indicator()?.getAttribute("style") ?? "";
  expect(style, "颜色变量要指向状态色").toContain(`var(${tone})`);
  expect(indicator()?.getAttribute("data-syncing")).toBe("true");
  // 圆点还在（呼吸灯就是它自己在明暗），不再换成转圈的图标
  const className = dot()?.className ?? "";
  expect(className, "呼吸动画挂在圆点上").toContain("animate-breathe");
  expect(indicator()?.className, "按钮自己不该被缩放").not.toContain(
    "animate-breathe",
  );
  // 尺寸仍是旧版的 6px——呼吸只是明暗，不能把它撑大
  expect(className).toContain("size-1.5");
  expect(className, "呼吸中也不吃 hover 的放大").not.toContain(
    "group-hover:size-2",
  );
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
      expect(toneColorVar(), "还没同步过应该是黄的").toBe("--warning");
      expectToneDot();
      expect(indicator()?.getAttribute("aria-label")).toContain("还没同步");

      await syncEngine.sync();
      flushSync();

      expect(toneColorVar(), "同步成功之后应该是绿的").toBe("--success");
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
      expect(toneColorVar()).toBe("--success");

      // 本地改动监听在 beforeEach 的 init 里已经装好了（autoSync 关着，不会自己跑同步）
      h.studyBank(HASH, 9);
      flushSync();
      expect(toneColorVar(), "本地改了东西就该变黄").toBe("--warning");
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
          expect(toneColorVar()).toBe("--success");
        },
        { timeout: 4000 },
      );

      // 点了不给任何提示：变绿就是反馈，不许弹 toast / alert
      expect(document.body.textContent).not.toContain("同步完成");
      expect(document.body.textContent).not.toContain("题库没有改动");
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
      expect(toneColorVar()).toBe("--success");
      expectToneDot();

      // 绿色照样可点、照样吃 hover：绿了以后主动同步一次是常见需求
      expect(indicator()?.getAttribute("aria-disabled")).toBe("false");
      // 光晕是旧版那种 box-shadow（6px → hover 12px），颜色走 `--tone-color`
      expectToneDot();
      expect(dot()?.className).toContain(
        "group-hover:shadow-[0_0_12px_var(--tone-color)]",
      );
      // 能点的时候才吃 hover：提亮 + 圆点自己稍微长大一点（按钮不缩放）
      expect(dot()?.className).toContain("group-hover:brightness-125");
      expect(dot()?.className).toContain("group-hover:size-2");
      expect(indicator()?.className).not.toContain("scale-125");

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
      expect(toneColorVar()).toBe("--success");

      indicator()?.click();
      // 同步是同步的：`phase` 已经变成 syncing，但颜色必须还是绿的
      // （正在跑只是让圆点呼吸，不该让人以为突然冒出了没传上去的改动）
      expect(syncEngine.status.phase).toBe("syncing");
      flushSync();
      expectBreathing("--success");

      await syncEngine.sync();
      flushSync();
      expect(syncEngine.status.phase).toBe("idle");
      expect(toneColorVar()).toBe("--success");
      expect(dot()?.className).not.toContain("animate-breathe");
      expect(dot()?.className, "跑完不再转圈/不再挂别的图标").toContain(
        "size-1.5",
      );
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
      expect(toneColorVar()).toBe("--destructive");

      // 再同步一次（后台轮询 / 用户手动都会走到这儿）：跑的过程中还是红的
      void syncEngine.sync();
      flushSync();
      expectBreathing("--destructive");

      await syncEngine.sync();
      flushSync();
      expect(toneColorVar()).toBe("--destructive");
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
      expect(toneColorVar(), "有冲突应该是红的").toBe("--destructive");
      expectToneDot();
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

    expect(toneColorVar(), "报错要标红").toBe("--destructive");
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

    expect(toneColorVar()).toBe("--warning");
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
      expect(toneColorVar()).toBe("--warning");
      expectToneDot();
      // 提亮挂在圆点上、光晕是 box-shadow，颜色统一读变量
      expect(dot()?.className).toContain("group-hover:brightness-125");
      expect(dot()?.className).toContain(
        "group-hover:shadow-[0_0_12px_var(--tone-color)]",
      );
      // hover 不再是背景色
      expect(indicator()?.className).not.toContain("hover:bg-accent");
    } finally {
      await h.stop();
    }
  });

  test("自动同步：呼吸灯自己亮自己灭，跑完直接是那一色（没有额外的「亮一下」）", async () => {
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
      expect(toneColorVar()).toBe("--warning");

      // 引擎自己那一轮（打开页面 / 防抖上传 / 轮询）——不是用户点的
      const run = syncEngine.sync();
      flushSync();
      expectBreathing("--warning");

      await run;
      flushSync();
      expect(toneColorVar(), "跑完直接是绿，和以前一样").toBe("--success");
      expectToneDot();
      // 用户没在等它，就不该再补一下「亮」的回执
      expect(dot()?.className).not.toContain("animate-wink");
    } finally {
      await h.stop();
    }
  });

  test("手动点击：呼吸灯跑完还要「亮一下」（提亮 + 弹一下）", async () => {
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
      const run = syncEngine.sync;
      indicator()?.click();
      flushSync();
      expectBreathing("--warning");

      await run.call(syncEngine);
      flushSync();

      // 亮一下：圆点挂上 `animate-wink`（关键帧在同一色上加 brightness + 放大）
      expect(dot()?.className, "手动点完要亮一下").toContain("animate-wink");
      // 颜色只有一份：不再有「更亮的同色」那种第二变量
      expect(indicator()?.getAttribute("style")).not.toContain(
        "tone-flash-color",
      );
      // 静止尺寸不变：仍是 6px。放大只发生在动画中间那一帧（见下一个用例）
      expect(dot()?.className).toContain("size-1.5");
      expect(dot()?.className, "放大不能写成 class，会被关键帧按住").not.toMatch(
        /(^|\s)scale-\d/,
      );

      // 亮完自己收回来，圆点回到常态的那一色
      await vi.waitFor(
        () => {
          expect(dot()?.className).not.toContain("animate-wink");
        },
        { timeout: 3000 },
      );
      expect(toneColorVar()).toBe("--success");
    } finally {
      await h.stop();
    }
  });

  test("高亮那一下要「跳一下」：关键帧中间放大，且起止都回到 1", () => {
    // 缩放只能写在关键帧里（动画一跑，`transform` 整条归关键帧管，
    // 同一元素上的 `scale-*` class 会被按住不动），所以直接读样式表钉住它。
    //
    // 倍数与配色都还在调（1.2 试过、现在 1.5 + brightness），所以这里**不钉死数值**，
    // 只钉住「跳」这件事的结构：中间那一帧必须比 1 大，起止必须回到 1。
    const body = winkKeyframes();

    const scales = [...body.matchAll(/transform:\s*scale\(([\d.]+)\)/g)].map(
      (m) => Number(m[1]),
    );
    expect(scales.length, "关键帧里要显式写 scale").toBeGreaterThanOrEqual(3);
    expect(scales[0], "起始是常态大小").toBe(1);
    expect(scales[scales.length - 1], "结束要回到常态大小，否则跳完停在大号上").toBe(1);
    expect(Math.max(...scales), "中间得真的放大").toBeGreaterThan(1);

    // 「亮」这件事也不能丢：靠 `filter: brightness()` 提亮。
    // **两端不许写 `brightness(1)`**：cssnano 会把它压成非法的 `brightness()`
    // 并整条丢掉，动画于是完全不亮（踩过）。基线交给元素自己的 `brightness-100`。
    // 只数**声明**（`filter: brightness(N)`），不数注释里提到的写法
    const brightnesses = [
        ...body.matchAll(/filter:\s*brightness\(([\d.]+)\)/g),
    ].map((m) => Number(m[1]));
    expect(brightnesses.length, "只在中间那一帧写 filter: brightness()").toBe(1);
    expect(brightnesses[0], "中间得真的提亮").toBeGreaterThan(1);

    // 底色只有一份：不再为「更亮的同色」维护第二个变量
    expect(body).not.toContain("tone-flash-color");
    expect(cssOfApp(), "tone-flash 相关变量该清干净了").not.toContain(
        "tone-flash",
    );
  });

  test("关键帧别写成 `brightness(1)`：cssnano 会压成非法的 `brightness()`", () => {
    // 这是真踩过的坑：首末帧写 `filter: brightness(1)`，构建后变成
    // `brightness()`（空参数）——整条声明非法、被浏览器丢掉，动画于是完全不亮，
    // 而源码看着一切正常、只有构建产物才看得出来。所以这里直接读 `src/app.css`
    // 的**声明**（注释里提到这个写法没关系），钉住「不许有 brightness(1)」。
    const declarations = [...winkKeyframes().matchAll(/filter:\s*([^;]+);/g)].map(
        (m) => m[1].trim(),
    );
    expect(declarations).not.toContain("brightness(1)");
    expect(
        declarations.some((value) => /brightness\(\d*\.?\d+\)/.test(value)),
        "总得有一帧在提亮",
    ).toBe(true);
  });
  test("手动点击失败：跑完照样给回执（亮的是红/黄那一色，不是绿）", async () => {
    const h = new SyncHarness();
    await h.start();
    try {
      vi.stubEnv("VITE_GITEE_API_BASE", h.apiBase);
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "first");
      h.save("A");
      // 目标 Gist 不存在 → 这一轮必然报错
      syncConfigStore.update({
        enabled: true,
        token: "tok",
        gistId: "g1",
        autoSync: false,
      });

      render();
      const run = syncEngine.sync;
      indicator()?.click();
      flushSync();
      expectBreathing("--warning");

      await run.call(syncEngine);
      flushSync();

      expect(syncEngine.status.phase).toBe("error");
      expect(toneColorVar(), "结果是红就停在红").toBe("--destructive");
      expect(dot()?.className, "失败也是「点过了」的回执").toContain(
        "animate-wink",
      );
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
