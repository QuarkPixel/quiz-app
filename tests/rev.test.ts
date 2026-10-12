/**
 * 修订戳：让「两台设备并发改同一张卡」可排序的那个原语。
 *
 * 没有它的时候，代码拿 `level` 当"谁更晚"的替身，于是「本地刚复习完、云端档位更高」
 * 会判云端赢，把云端那条**过期的 `nextDue`** 一起带回来 → 刚复习完的卡又变成待复习。
 * 这一族 bug 反复出现（本地复习 / 云端复习 / 答模糊 三个方向都复现过），
 * 根因就是缺这个原语。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { flushSync } from "svelte";
import { NO_REV, nextRev, revOf } from "../src/lib/rev";
import { normalizeMemoryProgress } from "../src/features/memory/normalize";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import { loadStoredState } from "../src/store";
import { globalSettingsStore } from "../src/features/globalSettings.svelte";
import { MEMORY_ANSWER_CODE } from "../src/quiz/types/memory/logic";
import type { MemoryBank } from "../src/source/types";
import type { StoredState } from "../src/types";

const BASE_TIME = new Date(2025, 0, 1, 10, 30, 0).getTime();

function makeBank(ids: string[]): MemoryBank {
  return {
    hash: "rev_test_hash",
    name: "记忆题库",
    mode: "memory",
    questions: ids.map((id) => ({
      id,
      type: "memory" as const,
      question: `题-${id}`,
      answer: `答-${id}`,
    })),
  };
}

function makeSession(ids: string[], now = BASE_TIME): MemorySession {
  return new MemorySession(
    makeBank(ids),
    { flash: () => {}, toast: () => {}, sound: { play: () => {} } as never },
    globalSettingsStore,
    { now: () => now },
  );
}

function answerKind(session: MemorySession, kind: "know" | "fuzzy" | "forget"): void {
  session.selectedAnswers = [MEMORY_ANSWER_CODE[kind]];
  session.submit();
  flushSync();
  session.advanceQuestionFlow();
  flushSync();
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("修订戳：纯函数", () => {
  it("没有戳 = NO_REV = 0（老数据靠这条平滑迁移）", () => {
    expect(revOf(undefined)).toBe(NO_REV);
    expect(revOf(null)).toBe(NO_REV);
    expect(revOf({})).toBe(NO_REV);
    expect(revOf({ rev: 0 })).toBe(NO_REV);
    expect(revOf({ rev: -5 })).toBe(NO_REV);
    expect(revOf({ rev: Number.NaN })).toBe(NO_REV);
    expect(revOf({ rev: "123" })).toBe(NO_REV);
  });

  it("正常情况就用当前毫秒", () => {
    expect(nextRev(1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it("同一毫秒内连写也严格递增（否则两条改动分不出先后）", () => {
    const t = 1_700_000_000_000;
    const a = nextRev(t);
    const b = nextRev(t, a);
    const c = nextRev(t, b);
    expect(a).toBe(t);
    expect(b).toBe(t + 1);
    expect(c).toBe(t + 2);
  });

  it("本机钟慢于对端时不会盖出更旧的戳", () => {
    // 对端（钟快）那条是 t+9999；本机现在只有 t
    const previous = 1_700_000_009_999;
    expect(nextRev(1_700_000_000_000, previous)).toBe(previous + 1);
  });
});

describe("修订戳：净化时原样带过去", () => {
  it("带戳的进度读完还带同一个戳（净化时丢掉就永远合并不对）", () => {
    const item = normalizeMemoryProgress({
      state: "reviewing",
      level: 3,
      nextDue: 1_700_000_000_000,
      lapses: 1,
      rev: 1_700_000_123_456,
    });
    expect(item?.rev).toBe(1_700_000_123_456);
  });

  it("老数据没有 rev → 0", () => {
    const item = normalizeMemoryProgress({ state: "reviewing", level: 3 });
    expect(item?.rev).toBe(0);
  });
});

describe("修订戳：写入时盖章（唯一收口）", () => {
  it("每次落盘的进度都带戳", () => {
    const session = makeSession(["a"]);
    session.startLearning();
    answerKind(session, "know");

    const stored = loadStoredState("rev_test_hash") as StoredState;
    const rev = stored.memory?.progress.a?.rev;
    expect(typeof rev, "进度没盖章，同步时就没法判断谁更晚").toBe("number");
    expect(rev).toBeGreaterThan(0);
  });

  it("同一张卡连写两次 → 戳严格递增", () => {
    const session = makeSession(["a"]);
    session.startLearning();
    answerKind(session, "know");
    const first = session.progress.a.rev ?? 0;
    answerKind(session, "know");
    const second = session.progress.a.rev ?? 0;
    expect(first).toBeGreaterThan(0);
    expect(second, "同一次答题会话里的两次改动不能撞成同一个戳").toBeGreaterThan(first);
  });

  it("不同卡各自有戳，互不影响", () => {
    const session = makeSession(["a", "b"]);
    session.startLearning();
    answerKind(session, "know");
    answerKind(session, "know");
    const a = session.progress.a.rev ?? 0;
    const b = session.progress.b.rev ?? 0;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  it("答「忘记」/「模糊」同样盖戳（它们是最需要排序的改动）", () => {
    const session = makeSession(["a"]);
    session.startLearning();
    answerKind(session, "forget");
    expect(session.progress.a.rev ?? 0).toBeGreaterThan(0);
  });
});
