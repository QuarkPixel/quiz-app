/**
 * 「(基准, 本地, 云端) 的各种形状」矩阵 —— 每个线上复现过的 bug 都在这里留下一条永久用例。
 *
 * 这一族 bug 的教训：**只测一个方向是不够的**。以前那条「两边都改过 → 取更靠前的
 * 档位」的用例里，"改过的那边"恰好也是"档位更高的那边"，于是两种实现给出同一个答案，
 * 它一直是绿的——直到用户报「换个设备复习完又变回待复习」。
 *
 * 所以这里把三个方向（本地复习 / 云端复习 / 答模糊）+ 两边都改 + 老数据没戳
 * 都列出来，并逐条钉住不变量：
 *
 *   I1 不撤销复习：今天复习过的卡，合并后不得变成「今天到期」
 *   I2 已掌握是终态：不能被拽回 learning / reviewing
 *   I3 计数不倒退：`lapses` 取两边最大值
 *   I4 交换律：`merge(l, r) === merge(r, l)`（两台设备必须算出同一个结果）
 */

import { describe, it, expect } from "vitest";
import { mergeProgressMap } from "@/features/sync/progressMerge";
import { mergeBankState } from "@/features/sync/model/merge";
import { fuzzyReview, isDue, resetReview, studyDay, advanceReview } from "@/features/memory/algorithm";
import type { MemoryProgress } from "@/types";

const NOW = new Date("2026-10-07T10:00:00").getTime();
const TODAY = studyDay(NOW);
const LATER = TODAY + 8 * 86_400_000; // 第 4 级的间隔 = 2^(4-1) = 8 天

const card = (patch: Partial<MemoryProgress> = {}): MemoryProgress => ({
  state: "reviewing",
  level: 5,
  streak: 0,
  nextDue: TODAY,
  lapses: 0,
  ...patch,
});

const merge = (local: MemoryProgress, remote: MemoryProgress, base?: MemoryProgress) =>
  mergeProgressMap(
    base === undefined ? undefined : { q1: base },
    { q1: local },
    { q1: remote },
  ).q1!;

/** 赢家那条 + `lapses` 取大 —— 合并结果唯一可能的形状。 */
const winBy = (winner: MemoryProgress, loser: MemoryProgress): MemoryProgress => ({
  ...winner,
  lapses: Math.max(winner.lapses ?? 0, loser.lapses ?? 0),
});

/** 每个形状都顺带验一次交换律：两台设备必须得到同一个结果。 */
function expectShape(name: string, local: MemoryProgress, remote: MemoryProgress, expected: Partial<MemoryProgress>) {
  const merged = merge(local, remote);
  const mirrored = merge(remote, local);
  expect(merged, `${name}（交换律）`).toEqual(mirrored);
  expect(merged, name).toMatchObject(expected);
}

describe("形状矩阵：复习过的卡不许被拽回到期", () => {
  it("A 本地复习过、云端档位更高（线上报的那个）", () => {
    // 本地：升到第 4 级、推到 8 天后（戳更新）
    const local = { ...advanceReview(card({ level: 3 }), 7, NOW), rev: 2000 };
    // 云端：第 5 级、今天到期（戳更旧）
    const remote = card({ level: 5, rev: 1000 });
    // 精确断言：**整条**取本地那份（`level` 与 `nextDue` 同源，不会错配）
    expect(merge(local, remote), "本地复习过 → 整条听本地的").toEqual(
      winBy(local, remote),
    );
    expect(merge(remote, local), "交换律").toEqual(winBy(local, remote));
    expect(isDue(merge(local, remote), NOW), "刚复习完不该又到期").toBe(false);
  });

  it("B 镜像：云端复习过、本地档位更高", () => {
    const local = card({ level: 5, rev: 1000 });
    const remote = { ...advanceReview(card({ level: 3 }), 7, NOW), rev: 2000 };
    expect(merge(local, remote), "云端复习过 → 整条听云端的").toEqual(
      winBy(remote, local),
    );
    expect(merge(remote, local), "交换律").toEqual(winBy(remote, local));
    expect(isDue(merge(local, remote), NOW)).toBe(false);
  });

  it("C 本地答「模糊」（退一级 + 推到将来）、云端档位更高", () => {
    const local = { ...fuzzyReview(card({ level: 6 }), NOW), rev: 2000 };
    const remote = card({ level: 7, rev: 1000 });
    expect(local.level, "模糊退一级").toBe(5);
    expect(merge(local, remote), "答模糊 → 整条听本地的").toEqual(winBy(local, remote));
    expect(isDue(merge(local, remote), NOW)).toBe(false);
  });

  it("C' 本地答「忘记」（归零 + 推到明天）", () => {
    const local = { ...resetReview(card({ level: 6 }), NOW), rev: 2000 };
    const remote = card({ level: 7, rev: 1000 });
    expect(local.level, "忘记归零").toBe(1);
    expect(merge(local, remote), "答忘记 → 整条听本地的").toEqual(winBy(local, remote));
    expect(merge(local, remote).lapses, "lapses 记下了这次忘记").toBe(1);
    expect(isDue(merge(local, remote), NOW)).toBe(false);
  });

  it("D 档位相同、只有一边复习过 → 同样不该到期", () => {
    const local = card({ nextDue: LATER, rev: 2000 });
    const remote = card({ nextDue: TODAY, rev: 1000 });
    expectShape("档位相同", local, remote, { nextDue: LATER });
    expect(isDue(merge(local, remote), NOW)).toBe(false);
  });

  it("戳更新但确实该早点复习（答「忘记」）→ 尊重更晚的那次操作", () => {
    // 云端复习到很远的将来；本地刚刚答「忘记」→ 明天就该复习（戳更新）
    const local = { ...resetReview(card({ level: 8 }), NOW), rev: 9000 };
    const remote = card({ level: 8, nextDue: TODAY + 64 * 86_400_000, rev: 1000 });
    const merged = merge(local, remote);
    expect(merged.level, "更晚的那次操作是「忘记」，就该归零").toBe(1);
    expect(isDue(merged, NOW), "推到明天，不是今天").toBe(false);
  });

  it("老数据两边都没有戳 → 靠 nextDue 兜住（复习过的不许被拽回）", () => {
    const local = card({ level: 4, nextDue: LATER });
    const remote = card({ level: 5, nextDue: TODAY });
    expectShape("没戳时看 nextDue", local, remote, { nextDue: LATER });
    expect(isDue(merge(local, remote), NOW)).toBe(false);
  });
});

describe("形状矩阵：已掌握是终态（I2）", () => {
  it("一边已掌握、另一边戳更新且退回学习中 → 已掌握赢", () => {
    const local = card({ state: "mastered", level: 0, nextDue: 0, rev: 1000 });
    const remote = card({ state: "learning", level: 0, nextDue: 0, rev: 9999 });
    expectShape("掌握赢过更新的学习中", local, remote, { state: "mastered" });
  });

  it("两边都已掌握 → 听戳更新的那份（内容一样，无所谓，但要确定）", () => {
    const local = card({ state: "mastered", level: 0, nextDue: 0, rev: 1000, lapses: 3 });
    const remote = card({ state: "mastered", level: 0, nextDue: 0, rev: 2000, lapses: 1 });
    expectShape("都已掌握", local, remote, { state: "mastered", lapses: 3 });
  });
});

describe("形状矩阵：计数与集合（I3）", () => {
  it("lapses 取两边最大值，不管谁赢", () => {
    const local = card({ rev: 1000, lapses: 1 });
    const remote = card({ rev: 2000, lapses: 7 });
    expect(merge(local, remote).lapses, "累计答错只涨不落").toBe(7);
    expect(merge(remote, local).lapses).toBe(7);
  });

  it("一边删过这张卡 → 留着还在的那份（进度不会因为一次合并消失）", () => {
    const kept = mergeProgressMap({}, {}, { q1: card({ level: 4 }) }).q1;
    expect(kept?.level).toBe(4);
    const keptLocal = mergeProgressMap({}, { q1: card({ level: 4 }) }, {}).q1;
    expect(keptLocal?.level).toBe(4);
  });
});

/**
 * **同一天的当天状态要逐项合，不能整条取一份。**
 *
 * `retry`（还要重新连对几次）与 `review`（今天复习了哪些）都带 `day`：
 * 跨天不合是对的（合了会把昨天的待办搬到今天），但**同一天**必须逐项合——
 * 整条取一份会把另一边整个丢掉，而且两台设备会**收敛到同一个错值**，
 * 所以特别安静（审计复现）。旧实现的注释写着「并集 / 取大」，代码却是 canonicalMax。
 */
describe("同一天的 retry / review：逐项合", () => {
  const memorySection = (patch: Record<string, unknown>) => ({ memory: patch });

  const mergeMemory = (local: unknown, remote: unknown) =>
    mergeBankState({ local, remote, mode: "memory" }) as {
      memory: { retry?: unknown; review?: unknown };
    };

  it("retry：两边的待办都留着，同一道题取更大的要求", () => {
    const local = memorySection({
      progress: {},
      retry: { day: 100, targets: { q1: 2 } },
    });
    const remote = memorySection({
      progress: {},
      retry: { day: 100, targets: { q9: 3, q1: 1 } },
    });
    const merged = mergeMemory(local, remote);
    expect(merged.memory.retry, "另一边的待办被整条丢掉了").toEqual({
      day: 100,
      targets: { q1: 2, q9: 3 },
    });
  });

  it("review：已复习的题取并集、总数取大", () => {
    const local = memorySection({
      progress: {},
      review: { day: 100, reviewedIds: ["q1"], total: 5 },
    });
    const remote = memorySection({
      progress: {},
      review: { day: 100, reviewedIds: ["q2", "q3"], total: 6 },
    });
    const merged = mergeMemory(local, remote);
    expect(merged.memory.review).toEqual({
      day: 100,
      reviewedIds: ["q1", "q2", "q3"],
      total: 6,
    });
  });

  it("跨天仍然不合（免得把昨天的待办搬到今天）", () => {
    const local = memorySection({
      progress: {},
      retry: { day: 100, targets: { q1: 2 } },
    });
    const remote = memorySection({
      progress: {},
      retry: { day: 101, targets: { q9: 3 } },
    });
    expect(mergeMemory(local, remote).memory.retry, "day 大的整条赢").toEqual({
      day: 101,
      targets: { q9: 3 },
    });
  });

  it("交换律：两边顺序无关", () => {
    const a = memorySection({ progress: {}, review: { day: 5, reviewedIds: ["x"], total: 2 } });
    const b = memorySection({ progress: {}, review: { day: 5, reviewedIds: ["y"], total: 9 } });
    expect(mergeMemory(a, b)).toEqual(mergeMemory(b, a));
  });
});
