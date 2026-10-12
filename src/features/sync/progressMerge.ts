/**
 * 进度合并的对外门面。**真正的规矩在 `model/` 里**：
 * `model/policy.ts` 是字段归属表，`model/merge.ts` 是三方合并，`model/card.ts` 是卡片全序。
 *
 * 这个文件保留下来是因为调用方（`merge.ts` 的计划器、以及一大批护栏用例）
 * 用的是这套名字；实现已经不再自己写合并逻辑——以前那套「按 `rank` 挑赢家」
 * 就是三个线上 bug 的根因，见 `model/card.ts` 的文件头。
 */

import type { MemoryProgress } from "@/types";
import { mergeBankSnapshot, mergeProgressMap, sameProgress } from "./model/merge";
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

function asCardMap(value: unknown): Record<string, MemoryProgress> | undefined {
  return asRecord(value) as Record<string, MemoryProgress> | undefined;
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

  // 「要不要合」**只看每张卡**，不拿整段 `state` 去比。
  //
  // `mergeBankState` 会顺手补齐几个缺省字段（`masteredIds` / `masteredMistakes` /
  // `settings`…），拿整段 state 去比会把「其实一张卡都没从云端取到」误判成一次合并
  // ——用户只在一台设备上做过题，却看到「合并进度 1」。这条边界以前是对的，
  // 重写时一度丢掉过。
  const localProgress = asRecord(asRecord(stateOf(params.local)?.memory)?.progress) ?? {};
  const mergedProgress = mergeProgressMap(
    asCardMap(asRecord(stateOf(params.base)?.memory)?.progress),
    asCardMap(localProgress),
    asCardMap(asRecord(stateOf(params.remote)?.memory)?.progress),
  );
  if (same(mergedProgress, localProgress)) return { kind: "skip" };

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
