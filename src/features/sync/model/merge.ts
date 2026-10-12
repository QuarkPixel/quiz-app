/**
 * 三方合并（基准 / 本地 / 云端）——**纯函数**，按 `policy.ts` 登记过的字段逐条合。
 *
 * 与旧实现的区别，一句话：旧的是"给每个字段现编一条规矩，而且有几条违反交换律"，
 * 新的是"字段在 `policy.ts` 里登记过，用登记的那个算子合"。
 *
 * 卡片用 `mergeCard`（全序取大，含修订戳）；其余见 `policy.ts` 的表。
 */

import type { MemoryProgress } from "@/types";
import { mergeCard } from "./card";
import { canonicalMax, mergeDayScoped, num, pickScalar, strArray } from "./operators";
import {
  DEVICE_LOCAL_BANK_FIELDS,
  stripDeviceLocal,
  SYNCED_BANK_FIELDS,
} from "./policy";
import { same } from "./same";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function asCardMap(value: unknown): Record<string, MemoryProgress> | undefined {
  const record = asRecord(value);
  return record as Record<string, MemoryProgress> | undefined;
}

/**
 * 按卡合并进度表。
 *
 * 出现与否取**并集**（一边删过卡、另一边还有 → 留着还在的那份：进度不该因为
 * 一次合并消失，这是有意的取舍）。两边都在时才交给 `mergeCard`。
 */
export function mergeProgressMap(
  base: Record<string, MemoryProgress> | undefined,
  local: Record<string, MemoryProgress> | undefined,
  remote: Record<string, MemoryProgress> | undefined,
): Record<string, MemoryProgress> {
  const ids = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(local ?? {}),
    ...Object.keys(remote ?? {}),
  ]);

  const result: Record<string, MemoryProgress> = {};
  for (const id of ids) {
    const inLocal = local?.[id];
    const inRemote = remote?.[id];
    if (inLocal === undefined || inRemote === undefined) {
      const kept = inLocal ?? inRemote;
      if (kept !== undefined) result[id] = kept;
      continue;
    }
    result[id] = mergeCard(inLocal, inRemote);
  }
  return result;
}

/** 逐键取大（答错次数这类计数器只涨）。 */
function mergeNumberRecord(
  base: unknown,
  local: unknown,
  remote: unknown,
): Json {
  const merged: Json = {};
  const keys = new Set([
    ...Object.keys(asRecord(base) ?? {}),
    ...Object.keys(asRecord(local) ?? {}),
    ...Object.keys(asRecord(remote) ?? {}),
  ]);
  for (const key of keys) {
    merged[key] = Math.max(
      num(asRecord(base)?.[key]),
      num(asRecord(local)?.[key]),
      num(asRecord(remote)?.[key]),
    );
  }
  return merged;
}

/**
 * 只涨不落的字符串集合：并集，减去「基准里有、但两边都不再包含」的
 * （那说明两边都执行过删除）。
 */
function mergeHighWaterSet(base: unknown, local: unknown, remote: unknown): string[] {
  const baseIds = strArray(base);
  const localIds = strArray(local);
  const remoteIds = strArray(remote);
  const removed = new Set(
    baseIds.filter((id) => !localIds.includes(id) && !remoteIds.includes(id)),
  );
  return [...new Set([...localIds, ...remoteIds, ...baseIds])].filter(
    (id) => !removed.has(id),
  );
}

/** 记忆模式的 `masteredIds` 是 `progress[].state === "mastered"` 的**投影**，别当第二份真相。 */
function masteredFromProgress(progress: Record<string, MemoryProgress>): string[] {
  return Object.keys(progress)
    .filter((id) => progress[id]?.state === "mastered")
    .sort();
}

/** 记忆模式那一小段。 */
function mergeMemorySection(
  base: Json | undefined,
  local: Json | undefined,
  remote: Json | undefined,
  mode: "quiz" | "memory",
): Json {
  const progress = mergeProgressMap(
    asCardMap(base?.progress),
    asCardMap(local?.progress),
    asCardMap(remote?.progress),
  );

  const merged: Json = {
    progress,
    settings: pickScalar(base?.settings, local?.settings, remote?.settings) ??
      local?.settings ??
      remote?.settings ??
      {},
  };

  // 「最近一次学完一轮」只前进不后退
  const learnedDay = Math.max(num(base?.learnedDay), num(local?.learnedDay), num(remote?.learnedDay));
  if (learnedDay > 0) merged.learnedDay = learnedDay;

  // retry / review 是**当天**状态：跨天不合（合了会把昨天的待办搬到今天）
  for (const key of ["retry", "review"] as const) {
    const value = mergeDayScoped(local?.[key], remote?.[key], (a, b) =>
      same(a, b) ? a : canonicalMax(a, b),
    );
    if (value !== undefined) merged[key] = value;
  }

  // `masteredIds` 在记忆模式下由 progress 推导，避免两份真相打架
  if (mode === "memory") merged.masteredIds = masteredFromProgress(progress);

  return merged;
}

/**
 * 合并一份题库的可同步状态。三个输入都可能是 `undefined`
 * （老数据没有 `state`、或某一边压根没有进度）。
 */
export function mergeBankState(params: {
  base?: unknown;
  local?: unknown;
  remote?: unknown;
  mode: "quiz" | "memory";
}): Json | undefined {
  const base = asRecord(params.base);
  const local = asRecord(params.local);
  const remote = asRecord(params.remote);
  if (local === undefined && remote === undefined && base === undefined) return undefined;

  const merged: Json = { ...(local ?? {}) };

  const mergedMemory = mergeMemorySection(
    asRecord(base?.memory),
    asRecord(local?.memory),
    asRecord(remote?.memory),
    params.mode,
  );
  if (asRecord(local?.memory) !== undefined || asRecord(remote?.memory) !== undefined) {
    merged.memory = mergedMemory;
  }

  if (params.mode === "memory") {
    merged.masteredIds = (mergedMemory.masteredIds as string[] | undefined) ?? [];
  } else {
    merged.masteredIds = mergeHighWaterSet(
      base?.masteredIds,
      local?.masteredIds,
      remote?.masteredIds,
    );
  }
  merged.masteredMistakes = mergeNumberRecord(
    base?.masteredMistakes,
    local?.masteredMistakes,
    remote?.masteredMistakes,
  );
  merged.currentRound = Math.max(
    num(base?.currentRound),
    num(local?.currentRound),
    num(remote?.currentRound),
  );
  merged.settings = pickScalar(base?.settings, local?.settings, remote?.settings) ??
    local?.settings ??
    remote?.settings ??
    {};

  // 设备本地字段不进合并结果（写回本地时由 `attachDeviceLocal` 贴回本机那份）
  for (const field of DEVICE_LOCAL_BANK_FIELDS) delete merged[field];

  return merged;
}

/** 合并一份题库快照（题目 + 可同步状态）。调用方保证题目一致（内容哈希相同）。 */
export function mergeBankSnapshot(params: {
  base?: unknown;
  local: Json;
  remote: unknown;
  mode: "quiz" | "memory";
}): Json {
  const remote = asRecord(params.remote);
  const state = mergeBankState({
    base: params.base,
    local: params.local.state,
    remote: remote?.state,
    mode: params.mode,
  });
  return {
    ...params.local,
    ...(state === undefined ? {} : { state }),
  };
}

/** 两份快照的**可同步状态**一样吗（跳过写入 / 不报「合并进度」用）。 */
export function sameProgress(a: unknown, b: unknown): boolean {
  return same(stripDeviceLocal(asRecord(a)) ?? null, stripDeviceLocal(asRecord(b)) ?? null);
}

export { SYNCED_BANK_FIELDS };
