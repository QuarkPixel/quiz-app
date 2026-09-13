/**
 * 记忆模式（memory）的纯算法层。
 *
 * 生词的生命周期：
 *
 *   未学习 ──「学习新的题目」──▶ 学习中 ──连续 N 次「知道」──▶ 复习中 ──走完 1/2/4/8… 间隔──▶ 已掌握
 *                                  ▲                              │
 *                                  └──── 复习时「忘记 / 记错了」，间隔归零 ────┘
 *
 * 关键约定：
 *   - 复习曲线是「按次数」的阶梯：第 k 次复习的间隔 = 2^(k-1) 天（1、2、4、8、16…）。
 *     阈值（掌握前要复习的次数）按次数设置，天数由 `memoryIntervalDays` 直接算出来。
 *   - 复习失败不回到「学习中」，只把「复习阶梯」清零重来（level 1，nextDue = 明天）。
 *     学习中失败（「记错了」）只把连续答对清零。
 *   - 复习答错后，本轮目标提升为连续 N 次答对；没有固定的重试次数。
 */

import type { MemoryProgress } from "@/types";

/** 默认掌握阈值：走完第 7 次复习（间隔 64 天）后算已掌握。 */
export const MEMORY_DEFAULT_GRADUATE_LEVEL = 7;

/** 掌握阈值允许的范围（按复习次数算）。 */
export const MEMORY_GRADUATE_LEVEL_BOUNDS = { min: 3, max: 10 } as const;

/** 一轮学习默认要掌握几题。 */
export const MEMORY_DEFAULT_ROUND_TARGET = 5;

/** 一轮掌握题数的边界。 */
export const MEMORY_ROUND_TARGET_BOUNDS = { min: 1, max: 50 } as const;

/** 间隔天数上限：阈值拉到 10 次时 2^9=512 天，封顶在一年，避免出现离谱日期。 */
export const MEMORY_MAX_INTERVAL_DAYS = 365;

export type MemoryState = "new" | "learning" | "reviewing" | "mastered";

/**
 * 第 `level` 次复习时安排的间隔（天）。level 从 1 开始。
 *   1 → 1 天，2 → 2 天，3 → 4 天，4 → 8 天，5 → 16 天，6 → 32 天，7 → 64 天 …
 */
export function memoryIntervalDays(level: number): number {
  // 非法输入（NaN / 负数）统一按第 1 级处理，避免算出 Invalid Date
  const safeLevel = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
  // 先封顶指数再取幂，避免 2 ** 1000 变成 Infinity
  const exponent = Math.min(safeLevel - 1, 30);
  return Math.min(MEMORY_MAX_INTERVAL_DAYS, 2 ** exponent);
}

/** 走完第 `threshold` 次复习（并答对）之后算已掌握时，整条曲线累计的天数。 */
export function cumulativeIntervalDays(threshold: number): number {
  if (!Number.isFinite(threshold)) return memoryIntervalDays(1);
  const safeThreshold = Math.max(1, Math.floor(threshold));
  let total = 0;
  for (let level = 1; level <= safeThreshold; level++) {
    total += memoryIntervalDays(level);
  }
  return total;
}

// ── 日期工具（全部以「本地日」为单位，避免时区/夏令时把差一天算错） ──────────────

/**
 * 「一天」从凌晨 5 点开始算：凌晨 5 点前都算前一天，5 点后才算次日。
 * 所以凌晨 3 点打开应用，看到仍然是「昨天」的复习进度。
 */
export const MEMORY_DAY_START_HOUR = 5;

/** 把毫秒时间戳截断到本地当天 0 点。 */
export function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 「今天」是哪一天的锚点：返回值仍是当天 0 点的毫秒时间戳，
 * 只是「算哪一天」按凌晨 5 点切换。
 *   凌晨 3 点 → 前一天的 0 点；早上 6 点 → 当天的 0 点。
 *
 * 返回值故意留在 0 点而不是 5 点：`nextDue` 存的一直是「到期日期」，
 * 这样老数据（同样存在 0 点）不需要任何迁移。
 */
export function studyDay(timestamp: number): number {
  return startOfDay(timestamp - MEMORY_DAY_START_HOUR * 60 * 60 * 1000);
}

/** 在某个时间戳上加 `days` 天（按本地日历天推进）。 */
export function addDays(timestamp: number, days: number): number {
  const date = new Date(timestamp);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 两个时间戳之间相差的整天数（按本地日历天算）。 */
export function diffDays(from: number, to: number): number {
  return Math.round(
    (startOfDay(to) - startOfDay(from)) / (24 * 60 * 60 * 1000),
  );
}

/** 该条目是否到期（nextDue 那个学习日已经到了）。 */
export function isDue(progress: MemoryProgress, now: number): boolean {
  if (progress.state !== "reviewing") return false;
  return startOfDay(progress.nextDue) <= studyDay(now);
}

/** 已逾期多少天（未到期返回 0）。 */
export function overdueDays(progress: MemoryProgress, now: number): number {
  if (!isDue(progress, now)) return 0;
  return Math.max(0, diffDays(progress.nextDue, studyDay(now)));
}

/** 归类一条进度属于哪个状态。 */
export function stateOf(progress: MemoryProgress): MemoryState {
  if (progress.state === "mastered") return "mastered";
  if (progress.state === "reviewing") return "reviewing";
  return "learning";
}

/** 创建一条「刚学出来的」进度：进入复习中，第 1 次复习安排在明天。 */
export function createReviewProgress(
  now: number,
  lapses = 0,
): MemoryProgress {
  return {
    state: "reviewing",
    level: 1,
    streak: 0,
    nextDue: addDays(studyDay(now), memoryIntervalDays(1)),
    lapses,
  };
}

/** 创建一条「学习中」的进度。 */
export function createLearningProgress(
  streak = 0,
  lapses = 0,
): MemoryProgress {
  return {
    state: "learning",
    level: 0,
    streak,
    nextDue: 0,
    lapses,
  };
}

/**
 * 复习中答对：推进一级。
 * 走完 `threshold` 级后进入已掌握（`level` / `streak` / `nextDue` 一起清零）。
 */
export function advanceReview(
  progress: MemoryProgress,
  threshold: number,
  now: number,
): MemoryProgress {
  const nextLevel = progress.level + 1;
  if (nextLevel > threshold) {
    return {
      ...progress,
      state: "mastered",
      level: 0,
      streak: 0,
      nextDue: 0,
    };
  }
  return {
    ...progress,
    state: "reviewing",
    level: nextLevel,
    streak: 0,
    nextDue: addDays(studyDay(now), memoryIntervalDays(nextLevel)),
  };
}

/**
 * 复习失败（「忘记 / 记错了」）：复习阶梯归零，从第 1 级重来。
 * 用户口径：不会回到「学习中」，而是继续留在复习中，明天重新开始 1/2/4/8…
 */
export function resetReview(
  progress: MemoryProgress,
  now: number,
  lapsesDelta = 1,
): MemoryProgress {
  return {
    ...progress,
    state: "reviewing",
    level: 1,
    streak: 0,
    nextDue: addDays(studyDay(now), memoryIntervalDays(1)),
    lapses: progress.lapses + lapsesDelta,
  };
}

/**
 * 复习进度（0–1）：越接近掌握阈值越接近 1。
 * 已掌握恒为 1，刚进入复习中为 0。
 */
export function reviewProgress(
  progress: MemoryProgress,
  threshold: number,
): number {
  if (progress.state === "mastered") return 1;
  if (progress.state !== "reviewing") return 0;
  const safeThreshold = Math.max(1, Math.floor(threshold));
  // level 表示「已经安排到第几级」，走过 level-1 级
  return Math.min(1, Math.max(0, (progress.level - 1) / safeThreshold));
}
