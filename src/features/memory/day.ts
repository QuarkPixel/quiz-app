/**
 * 记忆模式的「学习日」——**与时区无关的日期键**。
 *
 * 以前 `memory.review.day` / `memory.retry.day` / `memory.learnedDay` 存的是
 * 「本地 0 点的绝对毫秒戳」。它有两个问题：
 *
 *   1. 换时区（或者夏令时）之后，同一个日期在另一台设备上不是 0 点，
 *      拿它和 `studyDay(now)` 做 `===` 永远对不上——记录会被当成「昨天」丢掉；
 *   2. 它没法直接比较大小：`Math.max` 只能挑出「更晚的绝对时刻」，
 *      而不是「更晚的日期」。一台时钟偏快的设备写下一个未来日期，
 *      其他设备在那天之前都不会显示「今天学过」。
 *
 * 现在统一成 `YYYYMMDD` 的整数（例如 `20261110`）：它只由**本地日历**决定，
 * 跟时区偏移无关，比较大小就是比较日期，存起来也短。真正的「到期时间戳」
 * `nextDue` 仍然留在 `algorithm.ts`，两者分工明确：
 *
 *   - `DayKey`：回答「这是哪一天」（学习日、今日进度、连续天数）
 *   - `nextDue`：回答「什么时候到期」（0 点的绝对毫秒戳，给 `isDue` 用）
 */

import type { DayKey } from "@/types";

/** 一个学习日：`YYYYMMDD` 整数。 */
export type { DayKey };

/** 一天从凌晨 5 点开始算：5 点前都算前一天，5 点后才算次日。 */
export const MEMORY_DAY_START_HOUR = 5;

const MIN_DAY_KEY = 19000101;
const MAX_DAY_KEY = 99991231;

function isDayKeyValue(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (value < MIN_DAY_KEY || value > MAX_DAY_KEY) return false;
  const month = Math.floor((value % 10000) / 100);
  const day = value % 100;
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

/**
 * 这个时刻属于哪个学习日。
 *
 * 先把时钟拨回 5 小时，再取本地日历日：凌晨 3 点 → 前一天；早上 6 点 → 当天。
 * 非法时间戳返回 `0`（调用方按「没有这一天」处理）。
 */
export function dayKeyOf(timestamp: number): DayKey {
  if (!Number.isFinite(timestamp)) return 0;
  return calendarKeyOf(timestamp - MEMORY_DAY_START_HOUR * 60 * 60 * 1000);
}

/**
 * 这个时刻在**本地日历**上是哪一天（不按 5 点换日）。
 *
 * 只给「已经是学习日锚点」的值用：旧版 `memory.review.day` / `memory.retry.day` /
 * `memory.learnedDay` 存的是 `studyDay(t)`，也就是**学习日 0 点的时间戳**。
 * 拿它再走一遍 `dayKeyOf`（又减 5 小时）会把日期整体前移一天——
 * 例如 `2025-01-01 00:00` 会变成 `20241231`，记录被当成「昨天」丢掉。
 */
export function calendarKeyOf(timestamp: number): DayKey {
  if (!Number.isFinite(timestamp)) return 0;
  const date = new Date(timestamp);
  return (
    date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate()
  );
}

/**
 * 把任意来源的 `day` 收成 `DayKey`。
 *
 * 认两种形状：
 *   - 新的 `YYYYMMDD`（8 位，19000101–99991231）
 *   - 老的「本地 0 点绝对毫秒戳」（>= 1e11）→ 按 `dayKeyOf` 换算
 *
 * 其它一律 `undefined`，交给调用方按「没有这一天」处理。
 */
export function normalizeDayKey(value: unknown): DayKey | undefined {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  const floored = Math.floor(numberValue);
  if (isDayKeyValue(floored)) return floored;
  // 旧版存的是「学习日 0 点的时间戳」——它本身已经是锚点，按日历日取即可
  // （再走 `dayKeyOf` 会多减 5 小时，日期前移一天）。
  if (floored >= 1e11) return calendarKeyOf(floored);
  return undefined;
}

/** 这个学习日 0 点的绝对时间戳（本地时区）；非法 key 返回 0。 */
export function dayAnchor(key: DayKey): number {
  if (!isDayKeyValue(key)) return 0;
  const year = Math.floor(key / 10000);
  const month = Math.floor((key % 10000) / 100);
  const day = key % 100;
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

/** 在这个学习日上加减天数（按本地日历推进，跨月 / 跨年都安全）。 */
export function addDayKeys(key: DayKey, days: number): DayKey {
  if (!isDayKeyValue(key) || !Number.isFinite(days)) return key;
  const date = new Date(dayAnchor(key));
  date.setDate(date.getDate() + Math.trunc(days));
  return (
    date.getFullYear() * 10000 +
    (date.getMonth() + 1) * 100 +
    date.getDate()
  );
}

/** 两个学习日相差几天（`to - from`）。 */
export function diffDayKeys(from: DayKey, to: DayKey): number {
  if (!isDayKeyValue(from) || !isDayKeyValue(to)) return 0;
  return Math.round((dayAnchor(to) - dayAnchor(from)) / 86_400_000);
}

/** 给日志 / 调试看的 `2026-11-10`。 */
export function formatDayKey(key: DayKey): string {
  if (!isDayKeyValue(key)) return "—";
  const year = Math.floor(key / 10000);
  const month = String(Math.floor((key % 10000) / 100)).padStart(2, "0");
  const day = String(key % 100).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
