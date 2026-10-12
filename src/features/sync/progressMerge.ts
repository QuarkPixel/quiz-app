/**
 * 进度合并的对外门面。**真正的规矩在 `model/` 里**：
 * `model/policy.ts` 是字段归属表，`model/merge.ts` 是三方合并，`model/card.ts` 是卡片全序。
 *
 * 这个文件保留下来是因为调用方（`merge.ts` 的计划器、以及一大批护栏用例）
 * 用的是这套名字；实现已经不再自己写合并逻辑——以前那套「按 `rank` 挑赢家」
 * 就是三个线上 bug 的根因，见 `model/card.ts` 的文件头。
 */

import { mergeBankSnapshot, mergeBankState, mergeProgressMap, sameProgress } from "./model/merge";
import { same } from "./model/same";

export { mergeProgressMap, sameProgress };

export type ProgressMergePlan =
  | { kind: "skip" }
  | { kind: "push"; snapshot: unknown }
  /** 云端那份**已经够了**（本地没有它没有的东西）→ 照常下载 */
  | { kind: "pull" }
  | { kind: "merge"; snapshot: unknown };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function modeOf(snapshot: unknown): "quiz" | "memory" {
  return asRecord(snapshot)?.mode === "memory" ? "memory" : "quiz";
}

/** 快照里的 `state` 段。 */
function stateOf(snapshot: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(snapshot)?.state);
}

/**
 * 这份快照在**记忆模式**下是不是「一张卡都没做过」。
 *
 * 只看记忆模式：`state.memory` 存在才谈得上空不空。刷题模式没有这个字段，
 * 走不到这里（那边的进度是掌握集合，空集合会被下面的比较正确判成一样）。
 */
function isProgressEmpty(snapshot: unknown): boolean {
  const memory = asRecord(stateOf(snapshot)?.memory);
  if (memory === undefined) return false;
  const progress = asRecord(memory.progress);
  return progress === undefined || Object.keys(progress).length === 0;
}

/** 合并一份题库快照（题目 + 可同步状态）。 */
export function mergeBankSnapshots(params: {
  base?: unknown;
  local: unknown;
  remote: unknown;
}): unknown {
  const local = asRecord(params.local);
  if (local === undefined) return params.local;
  return mergeBankSnapshot({
    base: params.base,
    local,
    remote: params.remote,
    mode: modeOf(params.local),
  });
}

/**
 * 这一轮该不该把合并结果写回本地、要不要报「合并进度」。
 *
 * 注意它回答的**只是"本地要不要改写"**，与"要不要上传"是两件事——
 * 以前把两者混成一件（`merge.kind === "skip"` 直接把 `push` 降级成 `skip`），
 * 结果是本地改动永远传不上去，见 `plan.ts` 里 `upload` 字段的说明。
 */
export function planProgressMerge(params: {
  /** 上次同步成功的那份快照（三方参照；旧记账里可能没有） */
  base?: unknown;
  local: unknown;
  remote: unknown;
}): ProgressMergePlan {
  // 云端那份压根没有进度 → 这就是一次普通的「上传自己的进度」。
  // **不要走合并**：合并会把缺失的字段补成默认值，于是「只是上传」也变成一次改写。
  if (stateOf(params.remote) === undefined) {
    return { kind: "push", snapshot: params.local };
  }
  // 云端有 `state`、但记忆模式的进度表是空的（题库刚同步过去、还没人做过题）：
  // 同样是「上传自己的进度」。这一档不能省——空进度表算不出「合进了新东西」，
  // 落到下面就会被判成 skip，于是本地那份进度永远推不上去。
  if (isProgressEmpty(params.remote)) {
    return { kind: "push", snapshot: params.local };
  }

  // 「要不要合」要**看整段可同步状态**，不能只看每张卡。
  //
  // 以前只看 `state.memory.progress`，于是两个方向都会静默丢数据（审计复现）：
  //   - **刷题模式**的进度在 `masteredIds` / `masteredMistakes` / `currentRound` 里，
  //     永远算不出"有新东西" ⇒ 永远 skip ⇒ 本地那份整份盖上去，云端的改动没了；
  //   - **记忆模式**只要分叉落在非卡片字段（`settings` / `retry` / `review` /
  //     `learnedDay`），同样 skip。
  //
  // 判据是**三方比较**：把「只有本地」「只有云端」各自跟自己合一遍当基线，
  // 再看真合并的结果是不是两边都超不过 ——
  //
  //   合并结果 == 只有本地   → 云端没给出新东西 → 本地够用（skip：只上传）
  //   合并结果 == 只有云端   → 本地没给出新东西 → 云端够用（pull：照常下载）
  //   两边都不是             → **各有一份对方没有的** → merge（写回本地并上传）
  //
  // 拿"跟自己合"当基线是为了抵消 `mergeBankState` 补齐缺省字段的影响
  // （`settings: {}` 之类），否则「其实没从云端取到东西」会被误判成一次合并，
  // 用户只在一台设备上做过题却看到「合并进度 1」。
  //
  // 第三条正是 blob 竞态（`docs/sync-redesign.md` §4）的恢复路径：
  // A 的改动被 B 基于旧副本的写入盖掉之后，A 本地那份就是"云端没有的东西"，
  // 于是这里判成 merge 并把结果推回去，改动不会**本地与云端一起消失**。
  const merged = mergeBankState({
    base: stateOf(params.base),
    local: stateOf(params.local),
    remote: stateOf(params.remote),
    mode: modeOf(params.local),
  });
  const localOnly = mergeBankState({
    base: stateOf(params.base),
    local: stateOf(params.local),
    remote: stateOf(params.local),
    mode: modeOf(params.local),
  });
  if (same(merged ?? null, localOnly ?? null)) return { kind: "skip" };

  const remoteOnly = mergeBankState({
    base: stateOf(params.base),
    local: stateOf(params.remote),
    remote: stateOf(params.remote),
    mode: modeOf(params.local),
  });
  if (same(merged ?? null, remoteOnly ?? null)) return { kind: "pull" };

  return {
    kind: "merge",
    snapshot: mergeBankSnapshot({
      base: params.base,
      local: asRecord(params.local) ?? {},
      remote: params.remote,
      mode: modeOf(params.local),
    }),
  };
}
