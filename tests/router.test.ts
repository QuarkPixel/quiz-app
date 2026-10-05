/**
 * 路由器的一层壳：URL ↔ 题库仓库。
 *
 * 用假的 `history` / `location` / 窗口，所以能直接断言「写出去的是哪个地址、
 * 用的是 push 还是 replace、有没有多写一条历史记录」——这几件事在真浏览器里
 * 只能靠手点后退键试，正是最容易悄悄坏掉的地方。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { Router, type RouterEnv } from "@/features/routing/router.svelte";
import type { Bank, BankSummary, QuizSource } from "@/source/types";

const HASH_A = "aaaabbbbccccdddd";
const HASH_B = "eeeeffff00001111";

/** 只实现路由真正用到的那几个方法（`QuizSource` 的其余部分是空实现）。 */
class FakeSource implements QuizSource {
  private active: string | null;
  readonly calls: string[] = [];

  constructor(
    private banks: string[],
    active: string | null = null,
  ) {
    this.active = active;
  }

  subscribe(): () => void {
    return () => {};
  }

  listBanks(): BankSummary[] {
    return this.banks.map((hash) => ({ hash, name: hash, mode: "memory", count: 1 }));
  }

  getActiveBank(): Bank | null {
    if (this.active === null) return null;
    return {
      hash: this.active,
      name: this.active,
      mode: "memory",
      questions: [],
    } as unknown as Bank;
  }

  setActiveBank(hash: string): void {
    this.active = hash;
    this.calls.push(hash);
  }

  /** 测试用：模拟侧边栏 / 云端同步把题库集合换掉 */
  setBanks(banks: string[], active: string | null = this.active): void {
    this.banks = banks;
    this.active = active;
  }
}

interface FakeEnv extends RouterEnv {
  /** 地址栏当前的样子（pushState / replaceState 会改它） */
  url: { pathname: string; hash: string; search: string };
  /** 写 URL 的调用记录：`push` / `replace` + 目标地址 */
  writes: Array<{ kind: "push" | "replace"; url: string }>;
  popstate(): void;
}

function createEnv(pathname = "/", hash = ""): FakeEnv {
  const url = { pathname, hash, search: "" };
  const writes: FakeEnv["writes"] = [];
  const listeners = new Set<() => void>();

  const apply = (kind: "push" | "replace", next: string) => {
    writes.push({ kind, url: next });
    const parsed = new URL(next, "https://quiz.test");
    url.pathname = parsed.pathname;
    url.search = parsed.search;
    url.hash = "";
  };

  return {
    url,
    writes,
    history: {
      pushState: (_state, _title, next) => apply("push", String(next)),
      replaceState: (_state, _title, next) => apply("replace", String(next)),
    },
    location: url,
    window: {
      addEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
        if (type === "popstate") listeners.add(cb as () => void);
      },
      removeEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
        if (type === "popstate") listeners.delete(cb as () => void);
      },
    },
    popstate: () => {
      for (const listener of listeners) listener();
    },
  };
}

/** 装一台设备：造源、造路由、启动，返回三方句柄。 */
function setup(options: {
  pathname?: string;
  hash?: string;
  banks?: string[];
  active?: string | null;
}) {
  const banks = options.banks ?? [HASH_A, HASH_B];
  // 默认「本地记着的当前题库」就是第一个：真实仓库（`BankStore`）在 `activeBank`
  // 缺失 / 失效时也是这么收场的，否则这套用例里会有一步凭空多出来的写盘
  const source = new FakeSource(banks, options.active ?? banks[0] ?? null);
  const env = createEnv(options.pathname ?? "/", options.hash ?? "");
  const router = new Router();
  router.start(source, { env, mountPath: "/" });
  return { source, env, router };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("打开页面：URL 与本地记录对账", () => {
  it("没写参数 → 跳到本地记着的那个题库（仓库本来就是它，不必再写一次）", () => {
    const { env, router, source } = setup({ active: HASH_B });

    expect(router.route).toEqual({ bank: HASH_B, mode: "home" });
    expect(env.url.pathname).toBe(`/${HASH_B}`);
    // 这一次跳转不算用户走了一步：不留历史记录
    expect(env.writes).toEqual([{ kind: "replace", url: `/${HASH_B}` }]);
    expect(source.calls).toEqual([]);
  });

  it("URL 指名了题库 → 听 URL 的（本地记着的那个让位）", () => {
    const { env, router, source } = setup({
      pathname: `/${HASH_A}`,
      active: HASH_B,
    });

    expect(router.route).toEqual({ bank: HASH_A, mode: "home" });
    expect(source.calls).toEqual([HASH_A]);
    // 用户是冲着这个题库来的：这一条算一步，后退能回去
    expect(env.writes).toEqual([{ kind: "push", url: `/${HASH_A}` }]);
  });

  it("URL 里的题库已经删了 → 退回本地记着的那个", () => {
    const { env, router } = setup({
      pathname: "/0123456789abcdef/learn",
      active: HASH_A,
    });

    expect(router.route).toEqual({ bank: HASH_A, mode: "home" });
    // 顺手把那个死地址写回规范形状
    expect(env.writes).toEqual([{ kind: "replace", url: `/${HASH_A}` }]);
  });

  it("一个题库都没有 → 留在根路径", () => {
    const { env, router } = setup({ banks: [] });

    expect(router.route).toEqual({ bank: null, mode: "home" });
    expect(env.url.pathname).toBe("/");
  });

  it("刷新在 /learn 上 → 子模式跟着回来（这就是「刷新后别把我踢回首页」）", () => {
    const { router, source } = setup({
      pathname: `/${HASH_A}/learn`,
      active: HASH_A,
    });

    expect(router.route).toEqual({ bank: HASH_A, mode: "learn" });
    expect(source.calls).toEqual([]);
  });
});

describe("侧边栏切题库", () => {
  it("写 URL，并且是 push（后退能回上一个题库）", () => {
    const { env, router } = setup({ active: HASH_A });
    env.writes.length = 0;

    router.setActiveBank(HASH_B);

    expect(router.route).toEqual({ bank: HASH_B, mode: "home" });
    expect(env.writes).toEqual([{ kind: "push", url: `/${HASH_B}` }]);
  });

  it("切到同一个题库：一个字节都不写（白写一次会重建会话）", () => {
    const { env, router, source } = setup({ active: HASH_A });
    env.writes.length = 0;

    router.setActiveBank(HASH_A);

    expect(env.writes).toEqual([]);
    expect(source.calls).toEqual([]);
  });
});

describe("记忆模式的子路径", () => {
  it("进学习 / 复习写进 URL，用的是 replace（不是两个地方）", () => {
    const { env, router } = setup({ active: HASH_A });
    env.writes.length = 0;

    router.setMode("learn");
    expect(router.route).toEqual({ bank: HASH_A, mode: "learn" });
    expect(env.writes).toEqual([{ kind: "replace", url: `/${HASH_A}/learn` }]);

    router.setMode("review");
    expect(env.writes[1]).toEqual({ kind: "replace", url: `/${HASH_A}/review` });

    router.setMode("home");
    expect(env.writes[2]).toEqual({ kind: "replace", url: `/${HASH_A}` });
  });

  it("没有题库时子模式无处可去", () => {
    const { env, router } = setup({ banks: [] });
    env.writes.length = 0;

    router.setMode("learn");

    expect(router.route).toEqual({ bank: null, mode: "home" });
    expect(env.writes).toEqual([]);
  });

  it("已经有子模式时，仓库变动不会把它抹平", () => {
    const { env, router, source } = setup({ active: HASH_A });
    router.setMode("learn");
    env.writes.length = 0;

    // 同步 / 改名都会走这条路：题库没换就不该动 URL
    source.subscribe(() => {});
    router.syncFromSource();

    expect(router.route).toEqual({ bank: HASH_A, mode: "learn" });
    expect(env.writes).toEqual([]);
  });
});

describe("前进 / 后退", () => {
  it("后退到题库首页：跟着走，并且不写 URL", () => {
    const { env, router } = setup({ active: HASH_A });
    router.setMode("learn");
    env.writes.length = 0;

    // 浏览器把地址栏改回 /<hash> 之后发 popstate
    env.url.pathname = `/${HASH_A}`;
    env.popstate();

    expect(router.route).toEqual({ bank: HASH_A, mode: "home" });
    expect(env.writes).toEqual([]);
  });

  it("后退到上一个题库：仓库跟着换", () => {
    const { env, router, source } = setup({ active: HASH_A });
    router.setActiveBank(HASH_B);
    env.writes.length = 0;

    env.url.pathname = `/${HASH_A}`;
    env.popstate();

    expect(router.route).toEqual({ bank: HASH_A, mode: "home" });
    expect(source.getActiveBank()?.hash).toBe(HASH_A);
    expect(env.writes).toEqual([]);
  });

  it("后退到一个已经不存在的题库：退回一个还能用的", () => {
    const { env, router } = setup({ active: HASH_A });
    router.setMode("learn");
    env.writes.length = 0;

    // 地址栏里是个死地址（题库被删了，或者别人发来的链接）
    env.url.pathname = "/0123456789abcdef";
    env.popstate();

    expect(router.route).toEqual({ bank: HASH_A, mode: "home" });
    expect(env.writes).toEqual([{ kind: "replace", url: `/${HASH_A}` }]);
  });

  it("stop() 之后不再听（测试隔离用）", () => {
    const { env, router } = setup({ active: HASH_A });
    router.stop();
    env.writes.length = 0;

    env.url.pathname = `/${HASH_B}`;
    env.popstate();

    expect(router.route).toEqual({ bank: HASH_A, mode: "home" });
    expect(env.writes).toEqual([]);
  });
});

describe("仓库自己变了", () => {
  it("当前题库被删掉、仓库自动换了一个 → URL 跟着换，且不留历史", () => {
    const { env, router, source } = setup({ active: HASH_A });
    env.writes.length = 0;

    source.setBanks([HASH_B], HASH_B);
    router.syncFromSource();

    expect(router.route).toEqual({ bank: HASH_B, mode: "home" });
    expect(env.writes).toEqual([{ kind: "replace", url: `/${HASH_B}` }]);
  });

  it("题库一个都不剩 → 回到根路径", () => {
    const { env, router, source } = setup({ active: HASH_A });
    env.writes.length = 0;

    source.setBanks([], null);
    router.syncFromSource();

    expect(router.route).toEqual({ bank: null, mode: "home" });
    expect(env.writes).toEqual([{ kind: "replace", url: "/" }]);
  });
});

describe("挂载在子路径下", () => {
  it("读写都带着前缀", () => {
    const source = new FakeSource([HASH_A, HASH_B], HASH_A);
    const env = createEnv("/quiz/", "");
    const router = new Router();
    router.start(source, { env, mountPath: "/quiz/" });

    // 地址栏停在 /quiz/（没写题库）→ 补上规范的子路径，前缀原样保留
    expect(router.route).toEqual({ bank: HASH_A, mode: "home" });
    expect(env.writes).toEqual([
      { kind: "replace", url: `/quiz/${HASH_A}` },
    ]);

    // 切题库时那一层前缀也不能丢（丢了就跳到站点的根上了）
    env.writes.length = 0;
    router.setActiveBank(HASH_B);
    expect(env.writes).toEqual([{ kind: "push", url: `/quiz/${HASH_B}` }]);

    // 子模式同样带着前缀
    env.writes.length = 0;
    router.setMode("learn");
    expect(env.writes).toEqual([
      { kind: "replace", url: `/quiz/${HASH_B}/learn` },
    ]);
  });
});
