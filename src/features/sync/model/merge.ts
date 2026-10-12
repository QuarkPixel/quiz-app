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
import { mergeDayScoped, num, pickScalar, strArray } from "./operators";
import { stripDeviceLocal, SYNCED_BANK_FIELDS } from "./policy";
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
  // **键要排序**：不然输出顺序随参数顺序变，两台设备算出不同的 `bankProgressHash`
  // ⇒ 互相认为对方"改过" ⇒ 来回推。（顺序不是语义，但对哈希是。）
  for (const id of [...ids].sort()) {
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
  // 键排序：理由同上（对象键序会进哈希）
  for (const key of [...keys].sort()) {
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
  // **必须排序**：这些数组会进 `bankProgressHash` / `bankFullHash`，顺序随参数顺序变
  // 就意味着两台设备算出不同的哈希 → 互相认为对方"改过" → 来回推。
  // 集合本身没有顺序语义（只用来判成员），排序是安全的。
  return [...new Set([...localIds, ...remoteIds, ...baseIds])]
    .filter((id) => !removed.has(id))
    .sort();
}

/** 记忆模式的 `masteredIds` 是 `progress[].state === "mastered"` 的**投影**，别当第二份真相。 */
function masteredFromProgress(progress: Record<string, MemoryProgress>): string[] {
  return Object.keys(progress)
    .filter((id) => progress[id]?.state === "mastered")
    .sort();
}


/**
 * 同一天的「还要重新连对几次」：**逐题取大**（要求只会更严，不会更松）。
 *
 * 整条取一份是不行的：两台设备各答错不同的题时，取哪一份都会把另一边的待办
 * 丢掉，而且两边**收敛到同一个错值**，所以特别难发现。
 */
function mergeRetrySameDay(a: unknown, b: unknown): unknown {
  const left = asRecord(a);
  const right = asRecord(b);
  if (left === undefined) return b;
  if (right === undefined) return a;
  const targets: Json = {};
  const ids = new Set([
    ...Object.keys(asRecord(left.targets) ?? {}),
    ...Object.keys(asRecord(right.targets) ?? {}),
  ]);
  for (const id of [...ids].sort()) {
    targets[id] = Math.max(
      num(asRecord(left.targets)?.[id]),
      num(asRecord(right.targets)?.[id]),
    );
  }
  return { ...left, targets };
}

/**
 * 同一天的复习进度：`reviewedIds` **取并集**、`total` **取大**。
 *
 * 整条取一份会让进度条的分子凭空中掉一道（"今天复习了 3 道"变成 2 道）。
 */
function mergeReviewSameDay(a: unknown, b: unknown): unknown {
  const left = asRecord(a);
  const right = asRecord(b);
  if (left === undefined) return b;
  if (right === undefined) return a;
  return {
    ...left,
    reviewedIds: [
      ...new Set([...strArray(left.reviewedIds), ...strArray(right.reviewedIds)]),
    ].sort(),
    total: Math.max(num(left.total), num(right.total)),
  };
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

  // retry / review 是**当天**状态：跨天不合（合了会把昨天的待办搬到今天）；
  // 同一天则**逐项**合，不能整条取一份——那会把另一边整个丢掉（审计复现：
  // 「还要重新连对 2 次」和「今天已复习的那道」都能凭空消失，而且两台设备
  // 会收敛到同一个错值，特别安静）。
  const retry = mergeDayScoped(local?.retry, remote?.retry, mergeRetrySameDay);
  if (retry !== undefined) merged.retry = retry;
  const review = mergeDayScoped(local?.review, remote?.review, mergeReviewSameDay);
  if (review !== undefined) merged.review = review;

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

  // **按登记过的字段逐条构造**，不是"拷一份本地再改几个"。
  //
  // 以前是 `{...local}` 打底、只覆写 4 个硬编码字段，于是**没登记**的字段原样
  // 来自本地 ⇒ 合并**不满足交换律**（`merge(l,r)` 与 `merge(r,l)` 得到不同的值，
  // 也就是"A 算出 X、B 算出 Y"）。改成显式构造之后，没登记的字段既不会被同步，
  // 也不会影响结果。
  const hasMemory =
    asRecord(local?.memory) !== undefined ||
    asRecord(remote?.memory) !== undefined ||
    asRecord(base?.memory) !== undefined;
  const mergedMemory = mergeMemorySection(
    asRecord(base?.memory),
    asRecord(local?.memory),
    asRecord(remote?.memory),
    params.mode,
  );

  const merged: Json = {};
  merged.masteredIds =
    params.mode === "memory" && hasMemory
      ? ((mergedMemory.masteredIds as string[] | undefined) ?? [])
      : // 记忆模式**但两边都没有 `memory` 段**时不能走上面那条：投影会得到 `[]`，
        // 把掌握的题抹掉。这种形状只在"题库模式变了"之类的边界上出现，退回集合合并。
        mergeHighWaterSet(base?.masteredIds, local?.masteredIds, remote?.masteredIds);
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
  if (hasMemory) merged.memory = mergedMemory;

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

/**
 * 两份快照的**可同步状态**一样吗（跳过写入 / 不报「合并进度」用）。
 *
 * 比的是 `state` 那一层，不是整个快照：拿整份快照进来会把 `mode` / `name` /
 * `questions` 也比进去（改个名就判成"进度变了"），而且 `state` 里的设备本地字段
 * 也得按同一套口径剥掉。以前这里剥错了层，只是当时没有调用方才没炸。
 */
export function sameProgress(a: unknown, b: unknown): boolean {
  return same(
    stripDeviceLocal(asRecord(a)?.state) ?? null,
    stripDeviceLocal(asRecord(b)?.state) ?? null,
  );
}

export { SYNCED_BANK_FIELDS };
