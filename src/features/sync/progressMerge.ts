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
  // （`model/merge.ts` 里刷题那一支的合并算子本身是对的，只是从来没人调用。）
  //
  // 但也不能拿"合并结果 vs 本地那份"直接比：`mergeBankState` 会把缺省字段补齐
  // （`settings: {}` 之类），那样比会把"其实没从云端取到东西"误判成一次合并。
  // 所以拿**本地与自己合并**的结果当基线：补齐的默认值两边一样，只有云端真的带来
  // 了不一样的东西才会不相等。
  const mergedWithRemote = mergeBankState({
    base: stateOf(params.base),
    local: stateOf(params.local),
    remote: stateOf(params.remote),
    mode: modeOf(params.local),
  });
  const mergedAlone = mergeBankState({
    base: stateOf(params.base),
    local: stateOf(params.local),
    remote: stateOf(params.local),
    mode: modeOf(params.local),
  });
  if (same(mergedWithRemote ?? null, mergedAlone ?? null)) return { kind: "skip" };

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
