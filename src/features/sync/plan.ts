/**
 * 一个题库这一轮到底做什么——**唯一的决定处**。
 *
 * ── 为什么单独出来 ──────────────────────────────────────────────────────────
 *
 * 以前判定分两步：`judgeBank` 给一个 `verdict`，然后 `buildSyncPlan` 里再用
 * 一句 `if (merge.kind === "skip") action.verdict = "skip"` **把它改掉**。
 * 那句改写就是线上「复习完的卡又变回待复习」的根因——它把两个不同的问题混成了
 * 一个字段：
 *
 *   - `merge.kind === "skip"` 回答「**云端有没有本地没见过的卡**」→ 决定要不要把
 *     合并结果写回本地；
 *   - `push` 回答「**本地改过、要传上去**」。
 *
 * 于是"这一轮没什么可合并的"被判成了"这一轮什么都不用做"，本地那次改动**永远传不上去**；
 * 而基准线照常刷新，下一轮就被判成 pull，云端那份旧进度反手把本地改动覆盖掉。
 *
 * 所以这里把答案拆成**两个独立的字段**：`action`（本地怎么改）与 `upload`（传不传）。
 * 一个函数同时给"结论"和"数据"、调用方还要负责别再改它——那种设计不该再有。
 */

import { planProgressMerge } from "./progressMerge";
import type { BankVerdict } from "./types";

/** 本地这一轮要做什么。 */
export type BankActionKind =
  | "skip" // 本地不用改
  | "download" // 用云端那份覆盖本地
  | "merge" // 把合并结果写回本地
  | "deleteLocal" // 本地删掉这个题库
  | "deleteRemote" // 云端删掉这个题库
  | "conflict"; // 等人裁决，谁都不动

export interface BankDecision {
  /** 本地这一轮做什么。 */
  action: BankActionKind;
  /**
   * **这一轮要不要把这个题库传上去。**
   *
   * 与 `action` 相互独立：`action === "skip"`（本地不用改）时照样可以是 `true`
   * ——本地改过、云端没有，那就只需要上传。这正是上面那两个问题被拆开之后的形状。
   */
  upload: boolean;
  /** 要写回本地的合并结果（只有 `action === "merge"` 时有）。 */
  merged?: unknown;
  /** 给用户报一句「已合并进度」——只有真的从云端取到了新东西才为真。 */
  progressMerged: boolean;
}

function actionOf(verdict: BankVerdict): BankActionKind {
  switch (verdict) {
    case "push":
      return "skip"; // push 本身不改本地；要不要合并由下面决定
    case "pull":
      return "download";
    case "deleteLocal":
      return "deleteLocal";
    case "deleteRemote":
      return "deleteRemote";
    case "conflict":
      return "conflict";
    default:
      return "skip";
  }
}

/**
 * 决定一个题库这一轮做什么。
 *
 * @param judged `judgeBank` 的结论（"这个题库往哪个方向走"）
 * @param localContentHash / `remoteContentHash` 题目+模式的内容哈希；
 *        两者相等才谈得上"按卡合并进度"
 */
export function decideBank(params: {
  judged: BankVerdict;
  local?: { contentHash: string; snapshot: unknown };
  remote?: { contentHash: string; snapshot: unknown };
  /** 上次同步成功的快照（三方参照） */
  base?: unknown;
}): BankDecision {
  const { judged, local, remote, base } = params;
  const action = actionOf(judged);
  const upload = judged === "push" || judged === "deleteRemote";

  // 只有「本地改过」+「两边题目一样」才谈得上按卡合并进度。
  // 题目分叉了是 conflict，早就由 `judgeBank` 定死了。
  if (
    judged !== "push" ||
    local === undefined ||
    remote === undefined ||
    local.contentHash !== remote.contentHash
  ) {
    return { action, upload, progressMerged: false };
  }

  const plan = planProgressMerge({ base, local: local.snapshot, remote: remote.snapshot });
  if (plan.kind === "merge") {
    return { action: "merge", upload, merged: plan.snapshot, progressMerged: true };
  }
  // `skip` = 云端没有本地没见过的卡 → **本地不用改写，但照样要上传**
  //（上传的理由是"本地改过"，与"合并能不能带来新东西"是两件事）。
  // `push` = 云端压根没有进度 / 进度表是空的 → 直接传本地那份。
  return { action: "skip", upload, progressMerged: false };
}
