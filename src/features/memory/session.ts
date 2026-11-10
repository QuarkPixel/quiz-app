/**
 * 记忆模式的两份「当日会话」——**纯函数，不碰 Svelte、不碰存储**。
 *
 * 会话记录回答的是 `memory.progress` 回答不了的问题：
 *
 *   - 学习：这一轮是哪一批、队列里还剩谁、现在停在哪一张、这张答过没有
 *   - 复习：今天这一轮还剩谁、真正过关了几张、每张还要连对几次 / 已经连对几次
 *
 * `progress` 仍然是**长期进度**的唯一真相（level / nextDue / lapses）；
 * 会话只是它上面的一层「今天 / 本轮」的脚手架，结束就删。两份记录都按需创建，
 * 没有进行中的会话时 `memory.sessions` 整个字段不存在。
 *
 * ── 三条硬规矩 ──────────────────────────────────────────────────────────────
 *
 * 1. **队列是卡片的顺序，不是集合**：`queue[0]` 永远是下一张；`currentId`
 *    要么在队列里，要么是 `null`。
 * 2. **`doneIds` 是墓碑**：一张卡一旦过关，任何旧 `targets` 都不能把它复活
 *    （这正是以前「复习完又变回待复习」的根因）。
 * 3. **合并必须可交换**：同一份数据无论从哪台设备合起，结果一致。集合类字段
 *    排序后合并，单值字段按 `rev` / `day` 裁决，不做「谁在本地谁赢」。
 */

import type {
  DayKey,
  MemoryLearningSession,
  MemoryReviewSession,
  MemorySessionsState,
  MemoryRoundState,
} from "@/types";
import { normalizeDayKey } from "./day";
import {
  memoryRoundRemaining,
  normalizeMemoryRound,
} from "./round";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.floor(numberValue));
}

export function uniqueIds(
  value: unknown,
  validIds?: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (seen.has(item)) continue;
    if (validIds !== undefined && !validIds.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function sortedUnique(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function filteredRecord(
  value: unknown,
  min: number,
  keep: (id: string) => boolean,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (!isRecord(value)) return result;
  for (const [id, raw] of Object.entries(value)) {
    if (!keep(id)) continue;
    const numberValue = toNonNegativeInt(raw, min);
    if (numberValue < min) continue;
    result[id] = numberValue;
  }
  return result;
}

/** 会话 id：只用于「两台设备是不是同一轮」，不需要密码学强度。 */
export function createSessionId(): string {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── 学习会话 ────────────────────────────────────────────────────────────────

export function createLearningSession(params: {
  round: MemoryRoundState;
  queue: readonly string[];
  day: DayKey;
  currentId?: string | null;
  answered?: boolean;
  id?: string;
  rev?: number;
}): MemoryLearningSession {
  const round = normalizeMemoryRound(params.round) ?? params.round;
  const remaining = new Set(memoryRoundRemaining(round));
  const queue = uniqueIds(params.queue).filter((id) => remaining.has(id));
  for (const id of memoryRoundRemaining(round)) {
    if (!queue.includes(id)) queue.push(id);
  }
  const currentId =
    params.currentId && queue.includes(params.currentId) ? params.currentId : null;
  return {
    id: params.id?.trim() || createSessionId(),
    day: normalizeDayKey(params.day) ?? 0,
    round,
    queue,
    currentId,
    answered: currentId !== null && params.answered === true,
    rev: toNonNegativeInt(params.rev),
  };
}

export function normalizeLearningSession(
  raw: unknown,
  validIds?: ReadonlySet<string>,
): MemoryLearningSession | undefined {
  if (!isRecord(raw)) return undefined;

  const round = normalizeMemoryRound(raw.round, validIds);
  if (!round) return undefined;

  const remaining = new Set(memoryRoundRemaining(round));
  const queue = uniqueIds(raw.queue, validIds).filter((id) => remaining.has(id));
  for (const id of memoryRoundRemaining(round)) {
    if (!queue.includes(id)) queue.push(id);
  }

  const currentId =
    typeof raw.currentId === "string" && queue.includes(raw.currentId)
      ? raw.currentId
      : null;
  // 没有 id 的老数据（只可能是手工改过的）用这一批卡拼一个稳定身份：
  // 两台设备读到同一批卡时必须算出同一个 id，才不会被当成两轮。
  const rawId = typeof raw.id === "string" ? raw.id.trim() : "";
  const id = rawId.length > 0 ? rawId : `legacy:${round.cardIds.join(",")}`;

  return {
    id,
    day: normalizeDayKey(raw.day) ?? 0,
    round,
    queue,
    currentId,
    answered: currentId !== null && raw.answered === true,
    rev: toNonNegativeInt(raw.rev),
  };
}

/**
 * 合并同一轮的两份记录（同 `id`）。
 *
 * - `cardIds` / `masteredIds` 取并集并排序：集合没有顺序语义，排序是为了
 *   两台设备算出同一份结果（否则哈希不同，同步会来回推）。
 * - `queue` 也排序：它是「还剩谁」，顺序只影响出题先后；为了可交换，
 *   合并时按 id 排序（本机自己的队列顺序在没有合并时仍然保留）。
 * - 当前题取 `rev` 大的那一侧；`rev` 相同就取 id 字典序小的，保证可交换。
 */
export function mergeLearningSession(
  local: MemoryLearningSession | undefined,
  remote: MemoryLearningSession | undefined,
): MemoryLearningSession | undefined {
  if (!local) return remote;
  if (!remote) return local;

  // 两台设备各开了一轮：只能留一份。取更新的一轮；同一时刻按「学得更多」
  // 与 id 排序裁决，保证交换后结果一致。
  if (local.id !== remote.id) {
    const localScore = [local.rev, local.round.masteredIds.length, local.round.cardIds.length];
    const remoteScore = [remote.rev, remote.round.masteredIds.length, remote.round.cardIds.length];
    for (let index = 0; index < localScore.length; index++) {
      if (localScore[index] !== remoteScore[index]) {
        return localScore[index] > remoteScore[index] ? local : remote;
      }
    }
    return local.id < remote.id ? local : remote;
  }

  const cardIds = sortedUnique([
    ...local.round.cardIds,
    ...remote.round.cardIds,
  ]);
  const masteredIds = sortedUnique([
    ...local.round.masteredIds,
    ...remote.round.masteredIds,
  ]).filter((id) => cardIds.includes(id));
  const round = normalizeMemoryRound({
    goal: Math.max(local.round.goal, remote.round.goal),
    cardIds,
    masteredIds,
  });
  if (!round) return undefined;

  const mastered = new Set(round.masteredIds);
  const queue = sortedUnique([...local.queue, ...remote.queue]).filter(
    (id) => cardIds.includes(id) && !mastered.has(id),
  );
  for (const id of memoryRoundRemaining(round)) {
    if (!queue.includes(id)) queue.push(id);
  }

  let currentId: string | null = null;
  let answered = false;
  if (local.currentId && queue.includes(local.currentId)) {
    currentId = local.currentId;
    answered = local.answered;
  }
  if (remote.currentId && queue.includes(remote.currentId)) {
    if (currentId === null || remote.rev > local.rev) {
      currentId = remote.currentId;
      answered = remote.answered;
    }
  }

  return {
    id: local.id,
    day: local.day > 0 && remote.day > 0 ? Math.min(local.day, remote.day) : local.day || remote.day,
    round,
    queue,
    currentId,
    answered: currentId !== null && answered,
    rev: Math.max(local.rev, remote.rev),
  };
}

// ── 复习会话 ────────────────────────────────────────────────────────────────

export function createReviewSession(params: {
  day: DayKey;
  queue: readonly string[];
  currentId?: string | null;
  answered?: boolean;
  doneIds?: readonly string[];
  touchedIds?: readonly string[];
  targets?: Record<string, number>;
  failed?: readonly string[];
  streaks?: Record<string, number>;
  rev?: number;
}): MemoryReviewSession {
  // 保序（不排序）：`doneIds` 的顺序就是「今天过关的先后」，UI 与测试都按它
  // 展示；只有**合并**时为了可交换才排序（见 `mergeReviewSession`）。
  const doneIds = uniqueIds(params.doneIds ?? []);
  const done = new Set(doneIds);
  const queue = uniqueIds(params.queue).filter((id) => !done.has(id));
  const currentId =
    params.currentId && queue.includes(params.currentId) ? params.currentId : null;
  return {
    day: normalizeDayKey(params.day) ?? 0,
    queue,
    currentId,
    answered: currentId !== null && params.answered === true,
    doneIds,
    touchedIds: uniqueIds(params.touchedIds ?? []),
    targets: filteredRecord(params.targets, 1, (id) => !done.has(id)),
    failed: uniqueIds(params.failed ?? []).filter((id) => !done.has(id)),
    streaks: filteredRecord(params.streaks, 0, (id) => !done.has(id)),
    rev: toNonNegativeInt(params.rev),
  };
}

export function normalizeReviewSession(
  raw: unknown,
  validIds?: ReadonlySet<string>,
): MemoryReviewSession | undefined {
  if (!isRecord(raw)) return undefined;
  const day = normalizeDayKey(raw.day);
  if (day === undefined) return undefined;

  const doneIds = uniqueIds(raw.doneIds, validIds);
  const done = new Set(doneIds);
  const queue = uniqueIds(raw.queue, validIds).filter((id) => !done.has(id));
  const currentId =
    typeof raw.currentId === "string" && queue.includes(raw.currentId)
      ? raw.currentId
      : null;

  return {
    day,
    queue,
    currentId,
    answered: currentId !== null && raw.answered === true,
    doneIds,
    touchedIds: uniqueIds(raw.touchedIds, validIds),
    targets: filteredRecord(raw.targets, 1, (id) => !done.has(id)),
    failed: uniqueIds(raw.failed, validIds).filter((id) => !done.has(id)),
    streaks: filteredRecord(raw.streaks, 0, (id) => !done.has(id)),
    rev: toNonNegativeInt(raw.rev),
  };
}

/** 今天这一轮的进度条分母：过关 + 还在队列里的。 */
export function reviewSessionTotal(session: MemoryReviewSession): number {
  return session.doneIds.length + session.queue.length;
}

/** 这一轮复习完了没有（队列空了，且没有未补完的连对）。 */
export function isReviewSessionComplete(session: MemoryReviewSession): boolean {
  return session.queue.length === 0 && Object.keys(session.targets).length === 0;
}

/**
 * 合并两份复习记录。
 *
 * 同一天：集合取并集，`targets` / `streaks` 逐卡取大（连对要求只会被提到 N，
 * 已经过的卡由 `doneIds` 兜底，不会再被旧 `targets` 复活）。
 *
 * 不同天：**新的一天赢计数**（`doneIds` / `touchedIds` 只认新的那天），
 * 但旧那天的**未完成部分**（`queue` / `targets` / `failed` / `streaks`）
 * 并进新的一天——这就是「第二天打开，把昨天的进度合并到今天」。
 */
export function mergeReviewSession(
  local: MemoryReviewSession | undefined,
  remote: MemoryReviewSession | undefined,
): MemoryReviewSession | undefined {
  if (!local) return remote;
  if (!remote) return local;

  const day = Math.max(local.day, remote.day);
  const newer = local.day >= remote.day ? local : remote;
  const sameDay = local.day === remote.day;

  // 不同天：旧的 `doneIds` / `touchedIds` 属于昨天，不能算进今天。
  const doneIds = sameDay
    ? sortedUnique([...local.doneIds, ...remote.doneIds])
    : sortedUnique(newer.doneIds);
  const done = new Set(doneIds);
  const touchedIds = sameDay
    ? sortedUnique([...local.touchedIds, ...remote.touchedIds])
    : sortedUnique(newer.touchedIds);

  const queue = sortedUnique([...local.queue, ...remote.queue]).filter(
    (id) => !done.has(id),
  );

  const mergeNumbers = (
    left: Record<string, number>,
    right: Record<string, number>,
    min: number,
  ): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (done.has(id)) continue;
      const value = Math.max(left[id] ?? min, right[id] ?? min);
      if (value >= min) result[id] = value;
    }
    return result;
  };

  // 不同天时，旧那天的 targets / streaks 只对「还在队列里」的卡有意义。
  const keepOld = (id: string) =>
    sameDay || queue.includes(id);
  const targets = mergeNumbers(
    filteredRecord(local.targets, 1, keepOld),
    filteredRecord(remote.targets, 1, keepOld),
    1,
  );
  const streaks = mergeNumbers(
    filteredRecord(local.streaks, 0, keepOld),
    filteredRecord(remote.streaks, 0, keepOld),
    0,
  );
  const failed = sortedUnique([...local.failed, ...remote.failed]).filter(
    (id) => !done.has(id) && keepOld(id),
  );

  let currentId: string | null = null;
  let answered = false;
  if (local.currentId && queue.includes(local.currentId)) {
    currentId = local.currentId;
    answered = local.answered;
  }
  if (remote.currentId && queue.includes(remote.currentId)) {
    if (currentId === null || remote.rev > local.rev) {
      currentId = remote.currentId;
      answered = remote.answered;
    }
  }
  if (currentId === null) answered = false;

  return {
    day,
    queue,
    currentId,
    answered,
    doneIds,
    touchedIds,
    targets,
    failed,
    streaks,
    rev: Math.max(local.rev, remote.rev),
  };
}

/**
 * 跨天：把昨天没用完的**队列**并进今天的新一轮。
 *
 * - 昨天已经过关的卡不进来（它们已经排到未来）
 * - 昨天没过的卡保留顺序，追加今天新到期的卡
 * - 计数归零：今天是从 0 / N 开始的新一轮
 * - **连对要求 / 降级记录 / 轮内连对一律作废**：今天是一轮新的，卡片按常规
 *   到期重来（答对一次即过）。把它们带过来等于让「昨天差一次没补完」
 *   变成今天的包袱，也和「学习日一切归零」的约定冲突
 */
export function rolloverReviewSession(
  previous: MemoryReviewSession,
  todayKey: DayKey,
  todayQueue: readonly string[],
): MemoryReviewSession {
  const done = new Set(previous.doneIds);
  const queue: string[] = [];
  for (const id of [...previous.queue, ...todayQueue]) {
    if (done.has(id)) continue;
    if (!queue.includes(id)) queue.push(id);
  }
  const inQueue = new Set(queue);
  return {
    day: todayKey,
    queue,
    currentId: previous.currentId && inQueue.has(previous.currentId) ? previous.currentId : null,
    answered: false,
    doneIds: [],
    touchedIds: [],
    targets: {},
    failed: [],
    streaks: {},
    rev: previous.rev,
  };
}

/** 丢掉题库里已不存在的卡（题被删 / id 改了）。 */
export function pruneReviewSession(
  session: MemoryReviewSession,
  validIds: ReadonlySet<string>,
): MemoryReviewSession | undefined {
  const doneIds = session.doneIds.filter((id) => validIds.has(id));
  const done = new Set(doneIds);
  const queue = session.queue.filter((id) => validIds.has(id) && !done.has(id));
  const inQueue = new Set(queue);
  const currentId =
    session.currentId && inQueue.has(session.currentId) ? session.currentId : null;
  return {
    ...session,
    queue,
    currentId,
    answered: currentId !== null && session.answered,
    doneIds,
    touchedIds: session.touchedIds.filter((id) => validIds.has(id)),
    targets: filteredRecord(session.targets, 1, (id) => inQueue.has(id)),
    failed: session.failed.filter((id) => validIds.has(id) && !done.has(id)),
    streaks: filteredRecord(session.streaks, 0, (id) => inQueue.has(id)),
  };
}

/** 丢掉题库里已不存在的卡（学习轮那一侧）。 */
export function pruneLearningSession(
  session: MemoryLearningSession | undefined,
  validIds: ReadonlySet<string>,
): MemoryLearningSession | undefined {
  if (!session) return undefined;
  const normalized = normalizeLearningSession(session, validIds);
  if (!normalized) return undefined;
  return normalized;
}

// ── 两份记录一起 ────────────────────────────────────────────────────────────

export function normalizeSessions(
  raw: unknown,
  validIds?: ReadonlySet<string>,
): MemorySessionsState | undefined {
  if (!isRecord(raw)) return undefined;
  const learning = normalizeLearningSession(raw.learning, validIds);
  const review = normalizeReviewSession(raw.review, validIds);
  if (!learning && !review) return undefined;
  return {
    ...(learning ? { learning } : {}),
    ...(review ? { review } : {}),
  };
}

/**
 * 合并两份会话记录（同步用）。两边都没有时返回 `undefined`，
 * 不留下 `sessions: {}` 空壳。
 */
export function mergeSessions(
  local: MemorySessionsState | undefined,
  remote: MemorySessionsState | undefined,
): MemorySessionsState | undefined {
  if (!local && !remote) return undefined;
  const learning = mergeLearningSession(local?.learning, remote?.learning);
  const review = mergeReviewSession(local?.review, remote?.review);
  if (!learning && !review) return undefined;
  return {
    ...(learning ? { learning } : {}),
    ...(review ? { review } : {}),
  };
}

/**
 * 三方合并（同步层用）：在两边合并之上，处理「一边删了、另一边还留着」。
 *
 * 会话是**会结束**的：学完一轮 / 今天复习完就把记录删掉。如果只看 local /
 * remote 两边，已经结束的一方（`undefined`）会让另一台设备上的旧记录**复活**——
 * 这正是「复习完又变回待复习」那一族的翻版。
 *
 * 规则：
 *   - 两边都没有 → 删掉（不管 base）
 *   - 一边没有 → 如果另一边就是 base 那一份（`rev` 没变），说明它只是还没拉到
 *     删除，删除赢；如果另一边 `rev` 更大，说明它在那之后还有新进度，保留它
 *   - 两边都有 → 交给 `mergeLearningSession` / `mergeReviewSession`
 */
export function mergeSessionsWithBase(
  base: MemorySessionsState | undefined,
  local: MemorySessionsState | undefined,
  remote: MemorySessionsState | undefined,
): MemorySessionsState | undefined {
  const mergeRecord = <T extends { rev: number }>(
    baseRecord: T | undefined,
    localRecord: T | undefined,
    remoteRecord: T | undefined,
    merge: (left: T | undefined, right: T | undefined) => T | undefined,
  ): T | undefined => {
    if (!localRecord && !remoteRecord) return undefined;
    if (!localRecord && remoteRecord) {
      if (baseRecord && remoteRecord.rev <= baseRecord.rev) return undefined;
      return remoteRecord;
    }
    if (localRecord && !remoteRecord) {
      if (baseRecord && localRecord.rev <= baseRecord.rev) return undefined;
      return localRecord;
    }
    return merge(localRecord, remoteRecord);
  };

  const learning = mergeRecord(
    base?.learning,
    local?.learning,
    remote?.learning,
    mergeLearningSession,
  );
  const review = mergeRecord(
    base?.review,
    local?.review,
    remote?.review,
    mergeReviewSession,
  );
  if (!learning && !review) return undefined;
  return {
    ...(learning ? { learning } : {}),
    ...(review ? { review } : {}),
  };
}

/** 队列（供会话层恢复出题顺序）。 */
export function learningQueueOf(session: MemoryLearningSession): string[] {
  return [...session.queue];
}

export function reviewQueueOf(session: MemoryReviewSession): string[] {
  return [...session.queue];
}
