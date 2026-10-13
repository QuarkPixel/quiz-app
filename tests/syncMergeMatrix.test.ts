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
 * **"今天 / 本轮"的会话状态根本不参与同步。**
 *
 * `memory.retry`（答错后还要重新连对几次）与 `memory.review`（今天复习到哪了）
 * 都是**当天、本轮**的状态：本来就"跨过凌晨 5 点自动作废"，也**不进进度备份**。
 * 它们却曾经在同步白名单里——于是这条路径会真的丢东西：
 *
 *   在 A 上把待办补完（`retry.targets` 清空）→ 同步 → 云端那份旧记录还在
 *   → 合并（取并集）把它**复活** → 那道卡因为"待重新连对"重新进入今天的复习队列
 *   → 首页显示「今天有一道待复习」，而它的 `nextDue` 明明在将来。
 *
 * 所以它们现在是**设备本地字段**（`policy.ts` 的 `DEVICE_LOCAL_BANK_FIELDS`）：
 * 不剥出去、不合并、写回时贴回本机那份。
 */
describe("会话状态（retry / review）不参与同步", () => {
  const memorySection = (patch: Record<string, unknown>) => ({ memory: patch });

  const mergeMemory = (local: unknown, remote: unknown) =>
    (mergeBankState({ local, remote, mode: "memory" }) as { memory?: Record<string, unknown> })
      .memory ?? {};

  it("本机已经补完的待办，不会被云端那份旧的复活", () => {
    const local = memorySection({ progress: {}, retry: { day: 100, targets: {} } });
    const remote = memorySection({
      progress: {},
      retry: { day: 100, targets: { q7: 2 } },
    });
    const merged = mergeMemory(local, remote);
    expect(
      merged.retry,
      "云端那条旧待办被合并结果带回来了——那道卡会重新冒出来「待复习」",
    ).toBeUndefined();
  });

  it("反过来也一样（云端补完了、本机还留着也不许带出来）", () => {
    const local = memorySection({ progress: {}, retry: { day: 100, targets: { q7: 2 } } });
    const remote = memorySection({ progress: {}, retry: { day: 100, targets: {} } });
    expect(mergeMemory(local, remote).retry).toBeUndefined();
  });

  it("今天复习到哪了（review）同样不进合并结果", () => {
    const local = memorySection({
      progress: {},
      review: { day: 100, reviewedIds: ["q1"], total: 5 },
    });
    const remote = memorySection({
      progress: {},
      review: { day: 100, reviewedIds: ["q2", "q3"], total: 6 },
    });
    const merged = mergeMemory(local, remote);
    expect(merged.review).toBeUndefined();
  });

  it("但**进度本身**照常合并（别把孩子跟洗澡水一起倒了）", () => {
    const card = { state: "reviewing", level: 3, streak: 0, nextDue: 111, lapses: 0, rev: 5000 };
    const local = memorySection({ progress: { q1: card }, retry: { day: 100, targets: {} } });
    const remote = memorySection({ progress: { q2: card }, retry: { day: 100, targets: { q7: 2 } } });
    const merged = mergeMemory(local, remote);
    expect(Object.keys(merged.progress as object).sort()).toEqual(["q1", "q2"]);
    expect(merged.retry).toBeUndefined();
  });
});
