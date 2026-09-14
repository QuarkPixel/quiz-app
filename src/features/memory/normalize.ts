/**
 * 记忆模式进度的净化：把任意来源（localStorage / 导入的进度备份 / 旧版本）
 * 的数据收窄成合法的 `MemoryProgress`。
 *
 * 单独一个文件是为了避免 `store.ts` ↔ `MemorySession.svelte.ts` 的循环依赖：
 * 前者加载状态时要净化，后者要用 `store` 落盘。
 */

import type {
  MemoryProgress,
  MemoryProgressMap,
  MemoryRetryState,
  MemoryStoredState,
} from "@/types";
import { sanitizeMemorySettings } from "./settings";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toInt(value: unknown, fallback: number, min: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.round(numberValue));
}

/**
 * `nextDue` 的合法上界：`Date` 能表示的最大毫秒时间戳。
 * 超出这个范围（例如被篡改成 `1e30`）会让 `startOfDay` 变成 Invalid Date，
 * 卡片永远不到期、总览还会显示「NaN 天后复习」。
 */
export const MAX_DUE_TIMESTAMP = 8.64e15;

/** 净化一条记忆进度；非法返回 null。 */
export function normalizeMemoryProgress(
  value: unknown,
): MemoryProgress | null {
  if (!isRecord(value)) return null;

  const state =
    value.state === "reviewing" || value.state === "mastered"
      ? value.state
      : "learning";
  const level = toInt(value.level, 0, 0);
  const streak = toInt(value.streak, 0, 0);
  const lapses = toInt(value.lapses, 0, 0);
  const rawNextDue = toInt(value.nextDue, 0, 0);
  const nextDue = rawNextDue > MAX_DUE_TIMESTAMP ? 0 : rawNextDue;

  if (state === "learning") {
    return { state, level: 0, streak, nextDue: 0, lapses };
  }
  if (state === "mastered") {
    // 已掌握是终态：阶梯与到期日一起清零（和 advanceReview 写出的形状一致）
    return { state, level: 0, streak: 0, nextDue: 0, lapses };
  }
  return {
    state,
    level: Math.max(1, level),
    // 复习中不保留历史连对：level > 1 说明这一轮早就完成了，
    // 残留的 streak 会让「明天从几次开始数」变得有歧义
    streak: 0,
    nextDue,
    lapses,
  };
}

/** 非负整数；非法返回 null（不做兜底，免得把垃圾数据洗成看似合法的值）。 */
function toNonNegativeIntOrNull(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return null;
  const floored = Math.floor(numberValue);
  return floored < 0 ? null : floored;
}

/**
 * 净化「本轮还要重新连对几次」的待办。
 *
 * `today` 是当前学习日（`studyDay(now)`）：传了就只保留当天写下的待办，
 * 过期的直接丢掉——昨天的要求不该带到今天（那时卡片本来就已经到期，
 * 按「明天重来」的常规路径走即可）。不传则只做结构净化（`store.ts` 那层
 * 还不知道「今天」是哪天）。
 *
 * 没有有效条目时返回 undefined，免得在存储里留下空壳。
 */
export function normalizeMemoryRetry(
  raw: unknown,
  today?: number,
): MemoryRetryState | undefined {
  if (!isRecord(raw)) return undefined;

  const day = toNonNegativeIntOrNull(raw.day);
  if (day === null) return undefined;
  if (
    today !== undefined &&
    Number.isFinite(today) &&
    Math.floor(today) !== day
  ) {
    return undefined;
  }
  if (!isRecord(raw.targets)) return undefined;

  const targets: Record<string, number> = {};
  for (const [id, value] of Object.entries(raw.targets)) {
    if (id.length === 0) continue;
    const target = toNonNegativeIntOrNull(value);
    if (target !== null && target >= 1) targets[id] = target;
  }
  if (Object.keys(targets).length === 0) return undefined;

  return { day, targets };
}

/**
 * 净化整个 `StoredState.memory` 段。没有这个段时返回 undefined，
 * 这样刷题模式题库的状态里不会多出一个空段。
 */
export function normalizeMemoryState(
  raw: unknown,
  today?: number,
): MemoryStoredState | undefined {
  if (!isRecord(raw)) return undefined;
  const retry = normalizeMemoryRetry(raw.retry, today);
  const learnedDay = toNonNegativeIntOrNull(raw.learnedDay);
  return {
    progress: normalizeMemoryProgressMap(raw.progress),
    settings: sanitizeMemorySettings(raw.settings),
    ...(retry === undefined ? {} : { retry }),
    ...(learnedDay === null ? {} : { learnedDay }),
  };
}

/** 净化进度表；丢弃结构非法的条目。 */
export function normalizeMemoryProgressMap(raw: unknown): MemoryProgressMap {
  const progress: MemoryProgressMap = {};
  if (!isRecord(raw)) return progress;

  for (const [id, value] of Object.entries(raw)) {
    const item = normalizeMemoryProgress(value);
    if (item) progress[id] = item;
  }
  return progress;
}
