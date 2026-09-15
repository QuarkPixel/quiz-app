import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import MemoryOverviewHarness from "./MemoryOverviewHarness.svelte";
import { BankStore } from "../src/source/bankStore";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import { globalSettingsStore } from "../src/features/globalSettings.svelte";
import { startOfDay } from "../src/features/memory/algorithm";
import { createDefaultMemorySettings } from "../src/features/memory/settings";
import {
  createDefaultSettings,
  createDefaultUiPreferences,
  saveState,
} from "../src/store";
import { STORAGE_PREFIX_QUESTIONS } from "../src/config/storage";
import type { MemoryBank } from "../src/source/types";
import type {
  MemoryProgress,
  MemoryProgressMap,
  StoredState,
} from "../src/types";

/**
 * 记忆模式总览（`MemoryOverview.svelte`）的组件测试。
 *
 * 这个文件只守这轮改动过的三件事，别的不重复：
 *   - 「导出为新题库」：筛选后的结果能另存成一份新题库，名字带筛选描述、
 *     内容就是筛出来的那批卡。它是**唯一**能把筛选结果带出应用的出口，
 *     坏了用户只能一张张抄。
 *   - 关闭总览会重置搜索与筛选：关掉再打开要是还留着上次的条件，用户看到的是一份
 *     「少了半题库」的列表，而搜索框 / 勾选项都在看不见的地方，根本找不出原因。
 *   - 列表是真的按筛选结果渲染的（这轮换成了虚拟滚动）：只断言数字的话，
 *     「数字对了但列表还画着全部卡片」这种回归能溜过去。
 *
 * 时间全部固定（`BASE_TIME` + 传 `now` 给 session），不依赖系统时钟与动画帧：
 * 之前踩过「题库选项会打乱 → 按 a 一定答对」那种看运气的断言。
 */

const BASE_TIME = new Date(2025, 0, 1, 10, 30, 0).getTime();

/**
 * 6 张卡：两张已掌握（m1 / m2）、一张学习中（m3）、两张今天到期（m4 / m5）、
 * 一张没学过（m6）。
 *
 * 断言用「今天复习」而不是「已掌握 / 未学习」收窄：`matchesMemoryFilter` 里
 * 复习中的卡片**不参与**「学习进度」筛选（它们归复习进度管），所以点「已掌握」
 * 会连 m4 / m5 一起留下，数出来的不是「已掌握的张数」。到期筛选没有这个歧义，
 * 数和名字都一眼可读。
 */
const MEMORY_BANK_JSON = JSON.stringify({
  mode: "memory",
  title: "记忆题库",
  questions: ["m1", "m2", "m3", "m4", "m5", "m6"].map((id) => ({
    id,
    type: "memory",
    question: `题-${id}`,
    answer: `答-${id}`,
  })),
});

function mastered(): MemoryProgress {
  return { state: "mastered", level: 0, streak: 0, nextDue: 0, lapses: 0 };
}

function dueToday(): MemoryProgress {
  return {
    state: "reviewing",
    level: 1,
    streak: 0,
    nextDue: startOfDay(BASE_TIME),
    lapses: 0,
  };
}

const PROGRESS: MemoryProgressMap = {
  m1: mastered(),
  m2: mastered(),
  m3: { state: "learning", level: 0, streak: 1, nextDue: 0, lapses: 0 },
  m4: dueToday(),
  m5: dueToday(),
};

function emptyState(): StoredState {
  return {
    masteredIds: [],
    masteredMistakes: {},
    activePool: [],
    currentRound: 0,
    filterType: "all",
    settings: createDefaultSettings(),
    ui: createDefaultUiPreferences(),
  };
}

interface Mounted {
  source: BankStore;
  session: MemorySession;
  bank: MemoryBank;
  /** 开关总览：真实应用里是底部工具栏那颗「总览」按钮 */
  setOpen: (value: boolean) => void;
  destroy: () => void;
}

async function mountOverview(progress: MemoryProgressMap): Promise<Mounted> {
  localStorage.clear();
  const source = new BankStore();
  const result = await source.importBank("记忆题库", MEMORY_BANK_JSON);
  expect(result.kind, "题库没导进去，后面的断言没意义").toBe("ok");

  const bank = source.getActiveBank();
  if (!bank || bank.mode !== "memory") {
    throw new Error("导入成功但拿不到记忆题库");
  }

  // 进度必须先落盘：MemorySession 是在构造函数里读 localStorage 的
  saveState(bank.hash, {
    ...emptyState(),
    memory: { progress, settings: createDefaultMemorySettings() },
  });

  const session = new MemorySession(
    bank,
    { flash: () => {}, toast: () => {}, sound: { play: () => {} } as never },
    globalSettingsStore,
    { now: () => BASE_TIME },
  );

  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(MemoryOverviewHarness, {
    target: host,
    props: { session, source },
  });
  flushSync();

  return {
    source,
    session,
    bank,
    setOpen: (value) => {
      app.setOpen(value);
      flushSync();
    },
    destroy: () => {
      void unmount(app);
      host.remove();
    },
  };
}

// ── DOM 查询：总览走 portal 挂在 body 上，一律在整页里找 ────────────────────

function exportButton(): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes("导出为新题库"),
  );
  if (!button) throw new Error("总览里找不到「导出为新题库」按钮");
  return button;
}

/**
 * 导出按钮是不是被藏起来了。
 *
 * 按 `classList` 逐个 token 判，不能用 `className.includes`：Button 的基础类里
 * 本来就有 `disabled:pointer-events-none` 与 `[&_svg]:pointer-events-none`
 * 两条**别的**类，字符串包含判定永远为真。
 */
function exportHidden(): boolean {
  const classes = exportButton().classList;
  return classes.contains("opacity-0") && classes.contains("pointer-events-none");
}

/** 「筛选结果 N 道」里那个 N；它直接来自 filteredRows，是列表收窄与否的判据 */
function resultCountText(): string {
  const span = [...document.querySelectorAll<HTMLElement>("span")].find(
    (candidate) => /^\d+ 道$/.test(candidate.textContent?.trim() ?? ""),
  );
  if (!span) throw new Error("找不到结果数");
  return span.textContent!.trim();
}

/** 虚拟列表真正渲染出来的行（`data-review-question-id` 由自定义行自己打上） */
function renderedRowIds(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>("[data-review-question-id]"),
  ]
    .map((node) => node.dataset.reviewQuestionId ?? "")
    .sort();
}

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    'input[aria-label="搜索卡片"]',
  );
  if (!input) throw new Error("总览里找不到搜索框");
  return input;
}

function setSearch(value: string): void {
  const input = searchInput();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function openFilterPanel(): void {
  const button = document.querySelector<HTMLButtonElement>(
    'button[aria-label="筛选"]',
  );
  if (!button) throw new Error("总览里找不到筛选按钮");
  button.click();
  flushSync();
}

/** 筛选面板里的一个多选项（aria-label 就是它的中文标签） */
function toggleButton(label: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`找不到筛选项：${label}`);
  return button;
}

/** 弹窗右上角的关闭按钮（走的是 Dialog → onOpenChange 这条真实关闭路径） */
function closeButton(): HTMLButtonElement {
  const button =
    document.querySelector<HTMLButtonElement>('button[data-slot="dialog-close"]') ??
    [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent?.trim() === "Close",
    );
  if (!button) throw new Error("总览里找不到关闭按钮");
  return button;
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function storedQuestionIds(hash: string): string[] {
  const raw = localStorage.getItem(STORAGE_PREFIX_QUESTIONS + hash);
  if (raw === null) throw new Error(`题库内容没落盘：${hash}`);
  return (JSON.parse(raw) as { id: string }[]).map((q) => q.id).sort();
}

describe("记忆模式：总览导出为新题库", () => {
  let view: Mounted | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    localStorage.clear();
    // Dialog 的 portal 挂在 body 上：不清干净会污染后面的用例
    document.body.innerHTML = "";
  });

  it("收窄筛选后导出：多出一份题库，名字带筛选描述、题目数就是筛选结果数", async () => {
    const mounted = await mountOverview(PROGRESS);
    view = mounted;

    // 未收窄时导出按钮只是被藏起来（`opacity-0 pointer-events-none`），
    // 元素仍在 DOM 里。显隐规则被删掉的话它会一直亮着，用户随手就能把
    // 整库另存一份——这条守的就是那个刻意的显隐规则
    expect(exportHidden()).toBe(true);

    openFilterPanel();
    toggleButton("今天复习").click();
    flushSync();

    expect(resultCountText()).toBe("2 道");
    expect(exportHidden()).toBe(false);

    exportButton().click();
    await vi.waitFor(() =>
      expect(mounted.source.listBanks(), "导出没有新增题库").toHaveLength(2),
    );

    const exported = mounted.source
      .listBanks()
      .find((summary) => summary.hash !== mounted.bank.hash);
    expect(exported).toBeDefined();
    // 题库名 = 原题库名 + 筛选描述（描述口径见 memoryFilters.test.ts）
    expect(exported!.name).toBe("记忆题库 今天复习");
    expect(exported!.mode).toBe("memory");
    expect(exported!.count).toBe(2);
    // 内容确实只是筛出来的那两张，不是整库 6 张
    expect(storedQuestionIds(exported!.hash)).toEqual(["m4", "m5"]);
  });
});

describe("记忆模式：总览关闭后不留下上一次的搜索与筛选", () => {
  let view: Mounted | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("关掉再打开：搜索框清空、筛选回到默认、列表恢复完整", async () => {
    const mounted = await mountOverview(PROGRESS);
    view = mounted;

    expect(resultCountText()).toBe("6 道");
    // 列表真的把卡片渲染出来了（虚拟列表要等布局收敛，不要拍脑袋 setTimeout）
    await vi.waitFor(() => expect(renderedRowIds()).toContain("m1"));

    // 收窄：勾「今天复习」（只剩 m4 / m5 两张）+ 输入搜索词 m4
    openFilterPanel();
    toggleButton("今天复习").click();
    flushSync();
    expect(resultCountText()).toBe("2 道");

    setSearch("m4");
    expect(resultCountText()).toBe("1 道");
    // 虚拟列表是异步收敛的（布局 → 渲染窗口），等它把行渲染成筛出来的那一张
    await vi.waitFor(() => expect(renderedRowIds()).toEqual(["m4"]));

    // 走真实的关闭路径：点弹窗右上角的关闭按钮
    closeButton().click();
    flushSync();
    await vi.waitFor(() => expect(dialog(), "总览没关掉").toBeNull());

    // 再打开（对应工具栏那颗「总览」）
    mounted.setOpen(true);
    await vi.waitFor(() => expect(dialog()).not.toBeNull());

    // 搜索框已清空、结果回到全库。留着上次的条件，用户会看到一份「少了半题库」
    // 的列表，而搜索框 / 勾选项都在看不见的地方，根本找不出原因
    expect(searchInput().value).toBe("");
    expect(resultCountText()).toBe("6 道");

    // 结构化筛选也回到默认：展开面板，没有一项是选中态
    openFilterPanel();
    expect(toggleButton("今天复习").getAttribute("data-state")).toBe("off");
    expect(toggleButton("已掌握").getAttribute("data-state")).toBe("off");
  });
});
