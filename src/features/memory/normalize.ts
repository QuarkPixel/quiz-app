/**
 * 记忆模式进度的净化：把任意来源（localStorage / 导入的进度备份 / 旧版本）
 * 的数据收窄成合法的 `MemoryStoredState`。
 *
 * 单独一个文件是为了避免 `store.ts` ↔ `MemorySession.svelte.ts` 的循环依赖：
 * 前者加载状态时要净化，后者要用 `store` 落盘。
 */

import type {
  DayKey,
  MemoryProgress,
  MemoryProgressMap,
  MemoryStoredState,
} from "@/types";
import { sanitizeMemorySettings } from "./settings";
import { normalizeDayKey } from "./day";
import {
  createReviewSession,
  normalizeSessions,
  uniqueIds,
} from "./session";

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
  // 修订戳必须**原样带过去**（只做非负取整）：它在同步时是并发更新的排序依据，
  // 净化时丢掉的话拉回来的那份就退化成「老数据」，永远合并不对。
  const rev = toInt(value.rev, 0, 0);

  if (state === "learning") {
    return { state, level: 0, streak, nextDue: 0, lapses, rev };
  }
  if (state === "mastered") {
    // 已掌握是终态：阶梯与到期日一起清零（和 advanceReview 写出的形状一致）
    return { state, level: 0, streak: 0, nextDue: 0, lapses, rev };
  }
  return {
    state,
    level: Math.max(1, level),
    // 复习中不保留历史连对：level > 1 说明这一轮早就完成了，
    // 残留的 streak 会让「明天从几次开始数」变得有歧义。
    // 复习轮的连对现在存在 `sessions.review.streaks` 里，不再借用这个字段。
    streak: 0,
    nextDue,
    lapses,
    rev,
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

/**
 * 把旧版的 `memory.retry` / `memory.review` 迁成一份复习会话。
 *
 * 旧版只存了「今天碰过哪些卡」和「总分母」，没存队列。迁移时把碰过的卡当作
 * 已过关（进度条至少不会从 3 / 5 掉回 0 / 5），队列留给 `startReview` 按今天
 * 到期的卡重新补。`retry.targets` 原样带过来，和 `failed` 一起恢复。
 */
function migrateLegacyReviewSession(
  raw: Record<string, unknown>,
): ReturnType<typeof createReviewSession> | undefined {
  const legacyReview = isRecord(raw.review) ? raw.review : undefined;
  const legacyRetry = isRecord(raw.retry) ? raw.retry : undefined;
  if (!legacyReview && !legacyRetry) return undefined;

  const day =
    normalizeDayKey(legacyReview?.day) ?? normalizeDayKey(legacyRetry?.day);
  if (day === undefined) return undefined;

  const reviewedIds = uniqueIds(
    legacyReview ? legacyReview.reviewedIds : [],
  );
  const targets = isRecord(legacyRetry?.targets)
    ? Object.fromEntries(
        Object.entries(legacyRetry.targets)
          .map(([id, value]) => [id, toInt(value, 0, 0)] as const)
          .filter(([, value]) => value >= 1),
      )
    : {};

  return createReviewSession({
    day,
    queue: [],
    doneIds: reviewedIds,
    touchedIds: reviewedIds,
    targets,
    failed: Object.keys(targets),
  });
}

/**
 * 净化整个 `StoredState.memory` 段。没有这个段时返回 undefined，
 * 这样刷题模式题库的状态里不会多出一个空段。
 *
 * `today` 传了就把 `learnedDay` 收敛到今天：
 * 一台时钟偏快的设备可能写出一个未来日期，不收敛的话其他设备在到达那天
 * 之前都不会显示「今天学过一轮」（`max` 合并还会把这个未来值一直留着）。
 */
export function normalizeMemoryState(
  raw: unknown,
  today?: DayKey,
): MemoryStoredState | undefined {
  if (!isRecord(raw)) return undefined;

  const sessions =
    normalizeSessions(raw.sessions) ??
    (() => {
      const migrated = migrateLegacyReviewSession(raw);
      return migrated ? { review: migrated } : undefined;
    })();

  const learnedDay = normalizeDayKey(raw.learnedDay);
  const clampedLearnedDay =
    learnedDay !== undefined && today !== undefined && learnedDay > today
      ? today
      : learnedDay;

  return {
    progress: normalizeMemoryProgressMap(raw.progress),
    settings: sanitizeMemorySettings(raw.settings),
    ...(sessions === undefined ? {} : { sessions }),
    ...(clampedLearnedDay === undefined ? {} : { learnedDay: clampedLearnedDay }),
  };
}
