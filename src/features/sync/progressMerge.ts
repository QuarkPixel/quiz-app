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
  // 这里原来有两档**提前返回**：「云端压根没有 `state`」与「云端进度表是空的」
  // → 直接 `push`。它们的前提是"只有卡片算进度"，而且当时 `skip` 那一档
  // **不会上传**（`upload` 是从 `judged` 推出来的），所以必须靠 `push` 把本地推上去。
  //
  // 现在两个前提都不成立了：进度还包括 `currentRound` / `masteredIds` / 设置这些
  // 非卡片字段（云端进度表空、但 `currentRound` 变过，正是"普通 pull"的形状，
  // 被它拦成 push 就会跳过下载），而 `skip` 这一档现在**照样上传**
  // （`decideBank` 末尾返回 `upload: true`）。所以交给下面的三方分类统一判。

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
