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
// 两个纯叶子（`hash.ts` 没有任何依赖，`same.ts` 只依赖它），不会和
// `sync/model/merge.ts` 形成环——那边反过来 import 本文件。
import { canonicalJson } from "@/features/sync/hash";
import { same } from "@/features/sync/model/same";

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

/**
 * 「这一侧相对基准改过没有」——会话合并的**第一道裁决**。
 *
 * 返回：
 *   `undefined` 两边都没记录 / 都没动 → 该删的删（会话结束会删记录）
 *   `"local"`   只有本地动了（云端还是基准那份）→ 合并结果就是本地
 *   `"remote"`  只有云端动了 → 用云端
 *   `"both"`    两边都动过，或没有基准 → 才需要逐字段合
 *
 * 为什么必须先问这一句：会话里一半字段会**变小**（`targets` 递减、`streaks`
 * 清零、`queue` 收缩），逐字段「取大 / 并集」会把旧值拉回来，于是单设备推进
 * 也会被算成"两边各有一份"（详见 `mergeReviewSession` 的说明）。
 */
function resolveSide<T>(
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
): "local" | "remote" | "both" | undefined {
  const localChanged =
    local !== undefined && (base === undefined || !same(base, local));
  const remoteChanged =
    remote !== undefined && (base === undefined || !same(base, remote));
  if (!localChanged && !remoteChanged) return undefined;
  if (!localChanged) return "remote";
  if (!remoteChanged) return "local";
  return "both";
}

/**
 * 两份记录里"更晚"的那份（`rev` 大；同戳按规范化 JSON 裁决，保证可交换）。
 *
 * 给 `targets` / `streaks` 这类**非计数**字段用：它们描述"现在还差几次"，
 * 只有最新那份是事实，不能取大。
 */
function newerRecord<T extends { rev: number }>(local: T, remote: T): T {
  if (local.rev !== remote.rev) return local.rev > remote.rev ? local : remote;
  return canonicalJson(local) >= canonicalJson(remote) ? local : remote;
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
  base?: MemoryLearningSession,
): MemoryLearningSession | undefined {
  const resolution = resolveSide(base, local, remote);
  if (resolution === undefined) return undefined;
  if (resolution === "local") return local ? combineLearningSessions(local, local) : undefined;
  if (resolution === "remote") return remote ? combineLearningSessions(remote, remote) : undefined;
  return local && remote ? combineLearningSessions(local, remote) : undefined;
}

/** 两侧都在时的那套逐字段合并（单侧也走它，保证形状一致）。 */
function combineLearningSessions(
  local: MemoryLearningSession,
  remote: MemoryLearningSession,
): MemoryLearningSession | undefined {
  // 两台设备各开了一轮：只能留一份。取更新的一轮；同一时刻按「学得更多」
  // 与 id 排序裁决，保证交换后结果一致。
  if (local.id !== remote.id) {
    const localScore = [local.rev, local.round.masteredIds.length, local.round.cardIds.length];
    const remoteScore = [remote.rev, remote.round.masteredIds.length, remote.round.cardIds.length];
    for (let index = 0; index < localScore.length; index++) {
      if (localScore[index] !== remoteScore[index]) {
        return localScore[index] > remoteScore[index]
          ? combineLearningSessions(local, local)
          : combineLearningSessions(remote, remote);
      }
    }
    return local.id < remote.id
      ? combineLearningSessions(local, local)
      : combineLearningSessions(remote, remote);
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
 * ── 先做三方裁决，再谈"合" ──────────────────────────────────────────────────
 *
 * 这份记录里有一半字段是**会变小**的：
 *
 *   `targets`  答对一次就 -1（还差几次才过关）
 *   `streaks`  答错清零
 *   `queue`    过关后收缩
 *   `currentId` / `answered` 往前推进
 *
 * 早先的实现对两侧都有的记录直接「集合取并集、数值取大」，等于假设这些字段
 * 只涨不落。于是只要本地在往前推、云端还是上次同步的旧快照，合并结果就必然
 * **既不是本地也不是云端**：`planProgressMerge` 据此判成「两边各有一份」→
 * `reconcile` → 弹「云端也有新进度」并把结果写回本地。更糟的是写回去的
 * `targets` 是旧的大值，用户下一题就发现「明明答对了，要求反而变多」。
 *
 * 所以先问一句**谁相对基准改过**（和 `pickScalar` 同一套因果）：
 *
 *   云端 == 基准          → 云端没动，合并结果就是本地那份
 *   本地 == 基准          → 本地没动，用云端
 *   两边都改了 / 没有基准 → 才逐字段合（真并发，保守合并）
 *
 * 没有基准（第一次接上这个云端）时两边都算"改过"，退回逐字段合——这时没有
 * 比"取并集"更安全的答案。
 *
 * ── 逐字段合（真并发）的规矩 ──
 *
 * 同一天：`doneIds` / `touchedIds` / `failed` 取并集（只增）；
 * `targets` / `streaks` **整组取 `rev` 较大那侧**——它们描述"这张卡现在还差
 * 几次"，只有最新那份才是事实，取大会把已经答对的要求又提回去。
 *
 * 不同天：**新的一天赢计数**（`doneIds` / `touchedIds` 只认新的那天），
 * 但旧那天的**未完成部分**（`queue` / `targets` / `failed` / `streaks`）
 * 并进新的一天——这就是「第二天打开，把昨天的进度合并到今天」。
 */
export function mergeReviewSession(
  local: MemoryReviewSession | undefined,
  remote: MemoryReviewSession | undefined,
  base?: MemoryReviewSession,
): MemoryReviewSession | undefined {
  const resolution = resolveSide(base, local, remote);
  if (resolution === undefined) return undefined;
  if (resolution === "local") return local ? combineReviewSessions(local, local) : undefined;
  if (resolution === "remote") return remote ? combineReviewSessions(remote, remote) : undefined;
  return local && remote ? combineReviewSessions(local, remote) : undefined;
}

/** 两侧都在时的那套逐字段合并（单侧也走它，保证形状一致）。 */
function combineReviewSessions(
  local: MemoryReviewSession,
  remote: MemoryReviewSession,
): MemoryReviewSession {
  const day = Math.max(local.day, remote.day);
  const newerDay = local.day >= remote.day ? local : remote;
  const sameDay = local.day === remote.day;

  // 不同天：旧的 `doneIds` / `touchedIds` 属于昨天，不能算进今天。
  const doneIds = sameDay
    ? sortedUnique([...local.doneIds, ...remote.doneIds])
    : sortedUnique(newerDay.doneIds);
  const done = new Set(doneIds);
  const touchedIds = sameDay
    ? sortedUnique([...local.touchedIds, ...remote.touchedIds])
    : sortedUnique(newerDay.touchedIds);

  const queue = sortedUnique([...local.queue, ...remote.queue]).filter(
    (id) => !done.has(id),
  );

  // 不同天时，旧那天的 targets / streaks 只对「还在队列里」的卡有意义。
  const keepOld = (id: string) =>
    sameDay || queue.includes(id);
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

  // `targets` / `streaks` 取"最新那次作答"的整份。
  // 它们不是计数器，是"现在还需要几次"：取大 = 把已经答对的要求提回去。
  const latest = newerRecord(local, remote);
  const latestNumbers = (
    field: "targets" | "streaks",
    min: number,
  ): Record<string, number> => {
    const result: Record<string, number> = {};
    for (const [id, value] of Object.entries(filteredRecord(latest[field], min, keepOld))) {
      if (done.has(id)) continue;
      if (value >= min) result[id] = value;
    }
    return result;
  };

  return {
    day,
    queue,
    currentId,
    answered,
    doneIds,
    touchedIds,
    targets: latestNumbers("targets", 1),
    failed,
    streaks: latestNumbers("streaks", 0),
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
 * 合并两份会话记录（**没有基准**的两方合并，用于本机重读盘上那份）。
 *
 * 没有基准就分不清"谁改过"，只能逐字段合；同步链路一律走
 * `mergeSessionsWithBase`（它带上次同步的基准，能先做因果裁决）。
 */
export function mergeSessions(
  local: MemorySessionsState | undefined,
  remote: MemorySessionsState | undefined,
): MemorySessionsState | undefined {
  return mergeSessionsWithBase(undefined, local, remote);
}

/**
 * 三方合并（同步层用）：先按基准裁决「谁改过」，再决定要不要逐字段合。
 *
 * 会话是**会结束**的：学完一轮 / 今天复习完就把记录删掉。如果只看 local /
 * remote 两边，已经结束的一方（`undefined`）会让另一台设备上的旧记录**复活**——
 * 这正是「复习完又变回待复习」那一族的翻版。
 *
 * 规则：
 *   - 两边都没有 → 删掉（不管 base）
 *   - 一边没有 → 另一侧**就是基准那一份**（没动过）→ 说明它只是还没拉到删除，
 *     删除赢；另一侧还有新改动 → 保留它
 *   - 两边都有 → 交给 `mergeLearningSession` / `mergeReviewSession`，
 *     它们内部同样先做基准裁决（云端没动就不"合"）
 */
export function mergeSessionsWithBase(
  base: MemorySessionsState | undefined,
  local: MemorySessionsState | undefined,
  remote: MemorySessionsState | undefined,
): MemorySessionsState | undefined {
  const learning = mergeLearningSession(local?.learning, remote?.learning, base?.learning);
  const review = mergeReviewSession(local?.review, remote?.review, base?.review);
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
