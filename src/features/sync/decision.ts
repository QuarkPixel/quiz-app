/**
 * 一个题库这一轮该做什么——**唯一的决定处**（纯函数）。
 *
 * ── 旧版错在哪 ──────────────────────────────────────────────────────────────
 *
 * 旧版分两步：`judgeBank` 先按 mtime 猜一个方向（push / pull / skip / conflict），
 * 再由 `decideBank` 用内容哈希去改判，最后 `buildSyncPlan` 还可能再改一次。
 * 三个地方都能"决定"，于是没有任何一处能回答"本地到底会不会被写"。
 * 线上表现就是：单设备（同一份数据、同一路写入）也会被判定成 pull，把云端
 * 那份写回本地；或者在冲突还没裁决时顺手把别的题库改了。
 *
 * ── 现在的规矩 ──────────────────────────────────────────────────────────────
 *
 * **只看内容，不看时钟。** 一条判别联合、一次算清：
 *
 *   | 情况                                   | 决定            | 本地 |
 *   |----------------------------------------|-----------------|------|
 *   | 两边都没有                              | `in-sync`       | 不写 |
 *   | 内容 + 进度都一样                       | `in-sync`       | 不写 |
 *   | 内容一样，本地是云端的超集              | `upload`        | 不写 |
 *   | 内容一样，云端是本地的超集              | `download`      | 写   |
 *   | 内容一样，两边各有一份对方没有的        | `reconcile`     | 写+传|
 *   | 内容分叉，只有一边相对基准改过          | `upload`/`download` | 视方向 |
 *   | 内容分叉，两边都改过 / 没有基准         | `conflict`      | 不写 |
 *   | 只有本地有（云端删了）                  | `remove-local`  | 删   |
 *   | 只有云端有（本地删了）                  | `remove-remote` | 不写 |
 *
 * **云端的进度与基准一致时，这一轮绝不会写本地**：判定里先比「谁相对基准改过」
 * （`sameProgress`，剥掉设备本地字段），云端没动就直接落 `upload` / `in-sync`。
 * 这条不依赖合并算子怎么算——合并结果再怎么"既不像本地也不像云端"，也不能
 * 变成一次写回。它正是"我在同一台设备上做题，云端不该反过来覆盖我"的硬保证。
 *
 * 「本地是云端的超集」由 `planProgressMerge` 的三方比较给出（它回答的是
 * "合并结果 == 只有本地那份吗"）。这一步不依赖 mtime，所以**同一条内容无论
 * 同步多少次，答案都一样**：上传成功之后本地与云端内容相等，下一轮必然落在
 * `in-sync`，不可能再写本地一次。
 *
 * `upload` 这一支是"本地只读"的落点：调用方执行它时**只允许上传**，不许碰
 * localStorage 里的进度（见 `engine` 的 `execute` 与 `BankAction` 的说明）。
 */

import { planProgressMerge, sameProgress } from "./progressMerge";
import type { BankSyncKind } from "./types";

/** 决定要看的那一侧。 */
export interface BankView {
  /** 题目 + 模式的内容哈希（不含进度） */
  contentHash: string;
  /** 进度哈希（`state` 整段）；只用于快速判断"完全一致" */
  progressHash: string;
  /** 完整快照（题目 + state），供三方合并使用 */
  snapshot: unknown;
  /** 这一侧有没有进度（`state != null`）。没有基准时用它判断谁"没什么可丢"。 */
  hasState: boolean;
}

export interface DecideBankParams {
  local?: BankView;
  remote?: BankView;
  /**
   * 上次同步成功时这个题库的快照（三方参照）。
   *
   * 没有它也能合并（退化成"两边各取更靠前的"），但分不清"谁改过"：
   * 内容分叉时只能判冲突。
   */
  baseSnapshot?: unknown;
  /**
   * 上次同步成功时这个题库的**内容**哈希。
   *
   * 只认题库行的 `contentHash`。老记账里没有这个字段（那时的行是按文件记的），
   * 读不到就当"没有可信基准"——宁可问一次，也不拿文件级哈希冒充题库级。
   */
  baseContentHash?: string;
  /**
   * 云端当前分片里这个题库的内容哈希。
   *
   * 只在"只有本地有"时有意义：`remote` 为 `undefined` 只能说明云端题库表里没有它，
   * 分不清"云端删了"还是"云端改了题目所以按 hash 对不上"。查得到且与基准不同
   * = 云端改过（删除不能压过编辑）；查不到 = 云端确实没有它 = 真删除。
   */
  cloudContentHash?: string;
  /** 记账里有没有这个题库的行 = 上一次同步时它在不在云端。 */
  hadBaseline: boolean;
}

export interface BankDecision {
  kind: BankSyncKind;
  /** `reconcile` 时合并出来的快照（写回本地，随后从本地重建上传）。 */
  merged?: unknown;
  /** 这次合并是不是真的从云端取到了新东西（给用户报"已合并进度"）。 */
  progressMerged?: boolean;
  /** 给人看 / 排查用的理由，UI 的冲突说明直接用它。 */
  reason: string;
}

export function decideBankSync(params: DecideBankParams): BankDecision {
  const { local, remote } = params;

  // ── 两边都有 ──
  if (local !== undefined && remote !== undefined) {
    if (local.contentHash === remote.contentHash) {
      // 题目是同一份，只有进度可能分叉。完全一致时直接收工——
      // 不这么判的话，下面 `planProgressMerge` 的 "skip" 会被读成 `upload`，
      // 每一轮都报一次"上传 1"（内容没变、实际也没传）。
      if (local.progressHash === remote.progressHash) {
        return { kind: "in-sync", reason: "内容与进度都一致" };
      }

      // ── 先问「云端相对基准改过没有」 ──
      //
      // 这不是可选优化，是**唯一能保证「单设备不被云端覆盖」的地方**：
      // 后面 `planProgressMerge` 是靠「合并结果是否等于只有本地那份」**反推**
      // 方向的，只要三方合并里任何一处对「同一份数据出现在几侧」敏感（形状归一、
      // 排序、缺省字段补齐……），就会得出"两边各有一份" ⇒ `reconcile` ⇒
      // 弹「云端也有新进度」并把结果写回本地。也就是说：**推断错了就会写用户
      // 正在做的那份**。云端的快照与基准一致时，它根本没有新东西可给，此时
      // 写本地在语义上就是错的——所以在这里直接掐死，不依赖推断。
      //
      // 比较用 `sameProgress`：只比 `state` 且剥掉设备本地字段，与 `progressHash`
      // 同一套口径；基准里没有 `state`（老记账）时它自然判"变了"，退回下面的
      // 三方推断。
      //
      // **只做这一半。**「本地 == 基准 ⇒ download」看着对称，其实是错的：
      // 远端是个哑 blob，B 可以拿着旧副本把云端**覆盖**掉（设计说明 §4 的竞态），
      // 那时 A 本地虽然没动，云端那份却不包含 A 的内容，判 download 就把 A
      // 仅存的改动永久盖掉。本地没动 ≠ 云端装着本地的东西。"本地落后"只能由
      // 三方合并去证明（`merged == remoteOnly`），不能由"我没动"直接推。
      const hasBaseState =
        params.baseSnapshot !== undefined && params.baseSnapshot !== null;
      if (hasBaseState && sameProgress(params.baseSnapshot, remote.snapshot)) {
        // 云端没动：写本地在语义上就是错的，只能是上传或什么都不做
        const localChanged = !sameProgress(params.baseSnapshot, local.snapshot);
        return localChanged
          ? { kind: "upload", reason: "云端没动，本地有云端没有的进度" }
          : { kind: "in-sync", reason: "云端与上次同步一致" };
      }

      const plan = planProgressMerge({
        base: params.baseSnapshot,
        local: local.snapshot,
        remote: remote.snapshot,
      });

      switch (plan.kind) {
        case "merge":
          return {
            kind: "reconcile",
            merged: plan.snapshot,
            progressMerged: true,
            reason: "两边各有一份对方没有的进度",
          };
        case "pull":
          // 云端那份已经包含本地全部内容 → 本地是"落后"的一侧。
          // 这是**唯一**允许被云端覆盖的进度分支。
          return { kind: "download", reason: "云端有本地没有的进度" };
        case "skip":
        case "push":
          // 本地是云端的超集（或云端压根没有进度）→ 只上传，本地一个字都不改。
          return { kind: "upload", reason: "本地有云端没有的进度" };
      }
    }

    // 内容分叉（题目 / 模式不一样）。按"相对上次同步谁改过"判。
    const hasBase = params.baseContentHash !== undefined;
    const localChanged =
      !hasBase || local.contentHash !== params.baseContentHash;
    const remoteChanged =
      !hasBase || remote.contentHash !== params.baseContentHash;

    if (localChanged && remoteChanged) {
      // 没有基准时只能比"谁手里有进度"：一边完全没做过这个题库，让路是安全的
      // （不会丢任何学习记录）；两边都做过才需要人来裁决。
      if (!hasBase) {
        if (!local.hasState && remote.hasState) {
          return { kind: "download", reason: "题目不一致，本机这边没有进度" };
        }
        if (local.hasState && !remote.hasState) {
          return { kind: "upload", reason: "题目不一致，云端那份没有进度" };
        }
      }
      return {
        kind: "conflict",
        reason: hasBase ? "题目两边都改过" : "题目不一致，且没有上次同步的基准",
      };
    }
    if (localChanged) {
      return { kind: "upload", reason: "题目本地改过、云端没动" };
    }
    return { kind: "download", reason: "题目云端改过、本地没动" };
  }

  // ── 只有本地有 ──
  if (local !== undefined) {
    // 没有基准行 = 这台设备新导入的题库（或记账被清过）→ 传上去。
    if (!params.hadBaseline) {
      return { kind: "upload", reason: "本地新导入的题库" };
    }
    // 有基准行 = 上次同步时它还在云端。但"云端没有它"要分两种情况：
    // 真的删了（基准内容没变）vs 改了题目之后对不上 hash（删除不能压过编辑）。
    const cloudChanged =
      params.baseContentHash !== undefined &&
      params.cloudContentHash !== undefined &&
      params.cloudContentHash !== params.baseContentHash;
    if (cloudChanged) {
      return { kind: "conflict", reason: "云端改过题目，本机这边已经删了它" };
    }
    return { kind: "remove-local", reason: "云端删掉了这个题库" };
  }

  // ── 只有云端有 ──
  if (remote !== undefined) {
    if (!params.hadBaseline) {
      // 别的设备新导入的 → 拉下来（这是"云端更新"，但用户没在用它时不打断）。
      return { kind: "download", reason: "云端新增的题库" };
    }
    const cloudChanged =
      params.baseContentHash !== undefined &&
      remote.contentHash !== params.baseContentHash;
    if (cloudChanged) {
      return { kind: "conflict", reason: "云端改过题目，同时本机删掉了它" };
    }
    return { kind: "remove-remote", reason: "本机删掉了这个题库" };
  }

  return { kind: "in-sync", reason: "两边都没有" };
}
