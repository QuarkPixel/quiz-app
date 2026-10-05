/**
 * `MemoryView` 子路径的接线（`/learn`、`/review`）。
 *
 * 这一层是「刷新之后别把我踢回首页」的落点：
 *
 *   URL `/<hash>/learn`  ─► 会话真的开起来了（接着学到一半的那一轮）
 *   URL `/<hash>/review` ─► 会话真的开起来了（今天到期的那批）
 *   会话开始 / 结束        ─► URL 跟着写回去（不留一个指向不存在会话的地址）
 *
 * 单独守它的理由：`route.test.ts` / `router.test.ts` 只证明「地址解析对了」，
 * 证不了「谁去把它变成一次会话」——中间那一跳（effect → session）没有任何类型
 * 检查兜底，写错就是「刷新回来还在首页」这个原始 bug。
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushSync, mount, unmount, type Component } from "svelte";

import MemoryViewHarness from "./MemoryViewHarness.svelte";
import { BankStore } from "@/source/bankStore";
import { Router, type RouterEnv } from "@/features/routing/router.svelte";
import { userActivity } from "@/features/userActivity.svelte";
import { toastStore } from "@/features/toast.svelte";
import { STORAGE_KEY_GENERAL } from "@/config";
import { createDefaultSettings, createDefaultUiPreferences } from "@/store";
import { createDefaultMemorySettings } from "@/features/memory/settings";
import type { MemoryBank } from "@/source/types";
import type { StoredState } from "@/types";

const HASH = "aaaabbbbccccdddd";
const OTHER_HASH = "eeeeffff00001111";

const QUESTIONS = ["m1", "m2", "m3"].map((id) => ({
  id,
  type: "memory" as const,
  question: `题-${id}`,
  answer: `答-${id}`,
}));

/**
 * 一份记忆模式的进度。
 *
 * `pool` 非空 = 「学到一半的一轮」：活动池里还有没学完的卡，`/learn` 应该接着学
 * （判据见 `MemorySession.hasOngoingRound`）。
 */
function memoryState(pool: string[] = []): StoredState {
  return {
    masteredIds: [],
    masteredMistakes: {},
    activePool: pool.map((id) => ({
      id,
      consecutiveCorrect: 0,
      hasEverMistaken: false,
      hasBeenShown: true,
      lastSelectedRound: 0,
    })),
    currentRound: 1,
    filterType: "all",
    settings: { ...createDefaultSettings(), selectionMode: "sequential" },
    ui: createDefaultUiPreferences(),
    roundGoal: 5,
    roundMastered: 0,
    memory: {
      progress: Object.fromEntries(
        pool.map((id) => [
          id,
          { state: "learning" as const, level: 0, streak: 0, nextDue: 0, lapses: 0 },
        ]),
      ),
      settings: createDefaultMemorySettings(),
    },
  };
}

interface TestEnv extends RouterEnv {
  url: { pathname: string; hash: string; search: string };
  writes: Array<{ kind: "push" | "replace"; url: string }>;
}

function createEnv(pathname: string): TestEnv {
  const url = { pathname, hash: "", search: "" };
  const writes: TestEnv["writes"] = [];
  const apply = (kind: "push" | "replace", next: string) => {
    writes.push({ kind, url: next });
    url.pathname = new URL(next, "https://quiz.test").pathname;
  };
  return {
    url,
    writes,
    history: {
      pushState: (_s, _t, next) => apply("push", String(next)),
      replaceState: (_s, _t, next) => apply("replace", String(next)),
    },
    location: url,
    window: { addEventListener: () => {}, removeEventListener: () => {} },
  };
}

/** 装一份进 localStorage：题库 ×2、进度、general 里的列表与当前题库。 */
function seed(state: StoredState): void {
  localStorage.setItem(
    STORAGE_KEY_GENERAL,
    JSON.stringify({
      activeBank: HASH,
      defaultSettings: createDefaultSettings(),
      library: [
        { hash: HASH, name: "记忆题库", mode: "memory", count: 3, addedAt: 1 },
        {
          hash: OTHER_HASH,
          name: "另一个题库",
          mode: "memory",
          count: 3,
          addedAt: 2,
        },
      ],
      globalSettings: {},
    }),
  );
  localStorage.setItem(`quiz_app_questions_${HASH}`, JSON.stringify(QUESTIONS));
  localStorage.setItem(`quiz_app_state_${HASH}`, JSON.stringify(state));
  localStorage.setItem(
    `quiz_app_questions_${OTHER_HASH}`,
    JSON.stringify(QUESTIONS),
  );
}

interface Mounted {
  component: ReturnType<typeof mount>;
  router: Router;
  env: TestEnv;
}

/** 从某个地址挂起来一份 `MemoryView`（相当于在那个地址上刷新一次页面）。 */
function openAt(pathname: string, state = memoryState()): Mounted {
  seed(state);
  const source = new BankStore();
  const bank = source.getActiveBank() as MemoryBank;
  const router = new Router();
  const env = createEnv(pathname);
  router.start(source, { env, mountPath: "/" });

  const component = mount(MemoryViewHarness as Component, {
    target: document.body,
    props: { bank, source, router },
  });
  flushSync();
  return { component, router, env };
}

let mounted: Mounted | null = null;

beforeEach(() => {
  localStorage.clear();
  userActivity.reset();
  toastStore.dismiss();
});

afterEach(() => {
  if (mounted !== null) {
    void unmount(mounted.component);
    mounted.router.stop();
    mounted = null;
  }
  localStorage.clear();
  userActivity.reset();
  toastStore.dismiss();
});

/** 会话是不是开着：屏上有没有题（首页没有）。 */
function questionOnScreen(): boolean {
  return (document.body.textContent ?? "").includes("题-m");
}

/** 按一下某个按钮（按可见文字找）。 */
function clickButton(text: string): void {
  const button = [...document.body.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(text),
  );
  expect(button, `找不到「${text}」按钮`).toBeTruthy();
  button?.click();
  flushSync();
}

describe("地址 → 会话", () => {
  it("/learn：学到一半的那一轮接着学（刷新回来直接落在答题区）", () => {
    mounted = openAt(`/${HASH}/learn`, memoryState(["m1", "m2"]));

    expect(questionOnScreen()).toBe(true);
    expect(
      userActivity.answering,
      "屏上有题 = 正在答题（云同步的刷新要让路）",
    ).toBe(true);
    // 地址不变：这就是「刷新以后还在这儿」
    expect(mounted.env.url.pathname).toBe(`/${HASH}/learn`);
  });

  it("/learn 但没有半轮可续：退回首页，不硬开一轮新的", () => {
    mounted = openAt(`/${HASH}/learn`);

    expect(questionOnScreen()).toBe(false);
    expect(mounted.router.route).toEqual({ bank: HASH, mode: "home" });
    expect(mounted.env.url.pathname).toBe(`/${HASH}`);
  });

  it("/review：今天没有到期的题 → 退回首页（不留下死地址）", () => {
    mounted = openAt(`/${HASH}/review`);

    expect(questionOnScreen()).toBe(false);
    expect(mounted.router.route).toEqual({ bank: HASH, mode: "home" });
    expect(mounted.env.url.pathname).toBe(`/${HASH}`);
  });

  it("子路径上的题库不认识：落到本地记着的那个题库的首页", () => {
    mounted = openAt("/0123456789abcdef/learn");

    expect(mounted.router.route).toEqual({ bank: HASH, mode: "home" });
    expect(mounted.env.writes.at(-1)).toEqual({
      kind: "replace",
      url: `/${HASH}`,
    });
  });
});

describe("会话 → 地址", () => {
  it("首页点「学习新的题目」：地址跟着变成 /learn", () => {
    mounted = openAt(`/${HASH}`);
    expect(mounted.router.route.mode).toBe("home");

    clickButton("学习新的题目");

    expect(questionOnScreen()).toBe(true);
    expect(mounted.router.route).toEqual({ bank: HASH, mode: "learn" });
    expect(mounted.env.url.pathname).toBe(`/${HASH}/learn`);
  });

  it("退出本轮（Esc）：地址跟着回到题库首页", () => {
    mounted = openAt(`/${HASH}/learn`, memoryState(["m1", "m2"]));
    expect(questionOnScreen()).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    flushSync();

    expect(questionOnScreen()).toBe(false);
    expect(mounted.router.route).toEqual({ bank: HASH, mode: "home" });
    expect(mounted.env.url.pathname).toBe(`/${HASH}`);
    expect(userActivity.answering, "回首页之后就不再是「正在答题」").toBe(false);
  });
});
