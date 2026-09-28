import { afterEach, describe, expect, it } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ViewHarness from "./ViewHarness.svelte";
import { BankStore } from "../src/source/bankStore";
import {
  createDefaultSettings,
  createDefaultUiPreferences,
  saveState,
} from "../src/store";
import { createDefaultMemorySettings } from "../src/features/memory/settings";
import {
  addDays,
  createReviewProgress,
  startOfDay,
} from "../src/features/memory/algorithm";
import type { Bank } from "../src/source/types";
import type { StoredState } from "../src/types";

/**
 * 记忆模式：复习轮进度条跨会话（曾经退出 / 刷新后从 0 / N 重来）。
 *
 * 视图级的回归测试：进度条的那两个数（分子分母）以前只活在会话里，
 * 中途退出或刷新页面就没了，表现成「进度明明保留了，进度条却重置」。
 * 这里全程走真实 DOM（点入口、点自评、点退出），最后直接读 `[role=progressbar]`
 * 的两个 aria 值。
 */

const IDS = "abcdefghij".split("");
const BASE_TIME = new Date(2025, 0, 1, 10, 30, 0).getTime();
/** 「今天」= 次日 06:00（一天从凌晨 5 点开始算） */
const DAY_AFTER_BASE = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;

const MEMORY_BANK = JSON.stringify({
  mode: "memory",
  title: "记忆题库",
  questions: IDS.map((id) => ({
    id,
    question: `题-${id}`,
    answer: `答-${id}`,
  })),
});

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

async function mountView(): Promise<{
  bank: Bank;
  destroy: () => void;
}> {
  const source = new BankStore();
  const result = await source.importBank("测试", MEMORY_BANK);
  expect(["ok", "duplicate"]).toContain(result.kind);
  const bank = source.getActiveBank();
  if (!bank) throw new Error("导入成功但拿不到当前题库");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(ViewHarness, { target: host, props: { bank, source } });
  flushSync();
  return {
    bank,
    destroy: () => {
      void unmount(app);
      host.remove();
    },
  };
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`找不到按钮：${text}`);
  return button;
}

/** 进度条的两个数（`aria-valuenow` = 已完成 / `aria-valuemax` = 总数） */
function bar(): { done: string | null; total: string | null } {
  const node = document.querySelector<HTMLElement>('[role="progressbar"]');
  if (!node) throw new Error("进度条没渲染出来");
  return {
    done: node.getAttribute("aria-valuenow"),
    total: node.getAttribute("aria-valuemax"),
  };
}

/** 答一道（走「知道」按钮 + 「下一题」按钮，和用户点的一样） */
function answerOnce(): void {
  buttonWithText("知道").click();
  flushSync();
  if (document.querySelector('[role="progressbar"]')) {
    buttonWithText("下一题").click();
    flushSync();
  }
}

function exitRound(): void {
  const trigger = document.querySelector<HTMLElement>(
    'button[aria-label="退出本轮"]',
  )!;
  trigger.dispatchEvent(new MouseEvent("mouseenter"));
  flushSync();
  trigger.click();
  flushSync();
}

function seedDue(hash: string, count: number): void {
  saveState(hash, {
    ...emptyState(),
    memory: {
      progress: Object.fromEntries(
        IDS.slice(0, count).map((id) => [
          id,
          createReviewProgress(BASE_TIME),
        ]),
      ),
      settings: createDefaultMemorySettings(),
    },
  });
}

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
});

describe("记忆模式：复习轮的进度条（跨会话）", () => {
  it("复习 5 / 10 后退出再进来：进度条仍是 5 / 10，接着把剩下的 5 道做完", async () => {
    const first = await mountView();
    seedDue(first.bank.hash, 10);
    // 进度是挂载后才铺的，重挂一次让会话读到它（相当于刷新页面）
    first.destroy();
    document.body.innerHTML = "";

    const view = await mountView();
    buttonWithText("复习").click();
    flushSync();
    expect(bar()).toEqual({ done: "0", total: "10" });

    for (let i = 0; i < 5; i++) answerOnce();
    expect(bar()).toEqual({ done: "5", total: "10" });

    // 「退出本轮」→ 回首页（进度条消失）
    exitRound();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();
    expect(() => buttonWithText("复习")).not.toThrow();

    // 刷新页面后重新进来：接着 5 / 10 数，剩下 5 道继续排着
    view.destroy();
    document.body.innerHTML = "";
    const resumed = await mountView();
    buttonWithText("复习").click();
    flushSync();
    expect(bar()).toEqual({ done: "5", total: "10" });

    // 做完剩下的：进度条走满
    let guard = 0;
    while (document.querySelector('[role="progressbar"]') && guard++ < 20) {
      answerOnce();
    }
    expect(guard).toBeLessThan(20);
    // 队列走完 → 本轮复习完成 → 回首页
    expect(() => buttonWithText("复习")).not.toThrow();
    resumed.destroy();
  });

  it("答错一道后退出再进来：分母还是 10（不因为补连对又长出来）", async () => {
    const seed = await mountView();
    seedDue(seed.bank.hash, 3);
    seed.destroy();
    document.body.innerHTML = "";

    const view = await mountView();
    buttonWithText("复习").click();
    flushSync();
    expect(bar()).toEqual({ done: "0", total: "3" });

    buttonWithText("忘记").click();
    flushSync();
    expect(bar()).toEqual({ done: "1", total: "3" });
    expect(document.body.textContent).toContain("答-");

    view.destroy();
    document.body.innerHTML = "";
    const resumed = await mountView();
    buttonWithText("复习").click();
    flushSync();
    // 答错那道今天已经算过，但还要连对 3 次才能过；分母不跟着涨
    expect(bar()).toEqual({ done: "1", total: "3" });
    resumed.destroy();
  });
});
