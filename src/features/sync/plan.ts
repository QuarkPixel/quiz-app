/**
 * 同步规划：把「本地有什么 / 云端有什么 / 上次同步到哪」算成一份可执行计划。
 *
 * 刻意做成纯函数（不碰网络、不碰 localStorage），因为这是整个同步里最需要被测试、
 * 也最容易出错的一段：搞错了就是静默覆盖用户数据。
 *
 * 逐行三方合并的规则（基准线是 `syncedAt` = 上次同步成功的时间）：
 *
 *   本地改过 | 云端改过 | 结果
 *   ────────┼─────────┼──────────────────────────────
 *      否    |   否    | 跳过
 *      是    |   否    | 上传
 *      否    |   是    | 下载
 *      是    |   是    | 冲突（两边都动了，绝不自动选一边）
 *
 * 只在一边存在的行：本地有云端没有 → 上传；云端有本地没有 → 下载（换设备时靠这条恢复；
 * 本地主动删掉的行会先被记成孤儿再从云端删掉，不会走到这里）。
 */

import type { LocalEntry } from "./storage";
import type { RemoteRowMeta, SyncMeta, SyncRowMeta } from "./types";

/** 一份待执行的同步计划。 */
export interface SyncPlan {
  /** 本地有、云端没有 → 上传 */
  pushNew: LocalEntry[];
  /** 云端有、本地没有 → 下载 */
  pullNew: string[];
  /** 本地更新 → 上传 */
  pushUpdated: LocalEntry[];
  /** 云端更新 → 下载 */
  pullUpdated: string[];
  /** 两边都改过 → 必须用户决定 */
  conflicts: string[];
  /** 云端有、本地完全没有（连痕迹都没有）→ 从云端删除，回收孤儿行 */
  orphans: string[];
}

/** 一行都没有的同步计划。 */
export function emptyPlan(): SyncPlan {
  return {
    pushNew: [],
    pullNew: [],
    pushUpdated: [],
    pullUpdated: [],
    conflicts: [],
    orphans: [],
  };
}

/**
 * 按 `id` 合并成本地 / 远端两张表。
 *
 * 远端表里可能出现「有元数据但这一行已经没了」的键吗？不会——元数据是从
 * 远端本次返回的行里重建的，所以远端表天然只含真实存在的行。
 */
export function groupByIds(
  local: LocalEntry[],
  remote: RemoteRowMeta[],
): {
  local: Map<string, LocalEntry>;
  remote: Map<string, RemoteRowMeta>;
} {
  const localMap = new Map<string, LocalEntry>();
  for (const entry of local) localMap.set(entry.id, entry);

  const remoteMap = new Map<string, RemoteRowMeta>();
  for (const row of remote) remoteMap.set(row.id, row);

  return { local: localMap, remote: remoteMap };
}

/**
 * 计算孤儿行：云端有、本地既没有这一行、也没有它的元数据。
 *
 * 「有元数据」= 这台设备见过这一行，只是本地删掉了它 → 该删云端。
 * 「连元数据都没有」= 这台设备从没见过它（比如另一台设备刚导入的新题库）
 * → 绝不能删，那是别人的数据。
 */
export function computeOrphans(
  localIds: ReadonlySet<string>,
  remoteIds: readonly string[],
  meta: Pick<SyncMeta, "rows">,
): string[] {
  return remoteIds
    .filter((id) => !localIds.has(id) && meta.rows[id] === undefined)
    .sort();
}

/** 单行的合并判定。 */
type RowVerdict = "skip" | "push" | "pull" | "conflict";

export function judgeRow(
  localAt: number,
  remoteAt: number,
  meta: SyncRowMeta | undefined,
): RowVerdict {
  const syncedAt = meta?.syncedAt ?? 0;
  const localChanged = localAt > syncedAt;
  const remoteChanged = remoteAt > syncedAt;

  if (localChanged && remoteChanged) return "conflict";
  if (localChanged) return "push";
  if (remoteChanged) return "pull";
  return "skip";
}

/** 从本地行与远端行算出一份完整计划。 */
export function buildSyncPlan(params: {
  local: LocalEntry[];
  remote: RemoteRowMeta[];
  meta: SyncMeta;
}): SyncPlan {
  const plan = emptyPlan();
  const { local: localMap, remote: remoteMap } = groupByIds(
    params.local,
    params.remote,
  );

  plan.orphans = computeOrphans(
    new Set(localMap.keys()),
    [...remoteMap.keys()],
    params.meta,
  );
  const orphanSet = new Set(plan.orphans);

  for (const [id, entry] of localMap) {
    const remoteRow = remoteMap.get(id);
    if (!remoteRow) {
      if (!orphanSet.has(id)) plan.pushNew.push(entry);
      continue;
    }
    const remoteAt = remoteRow.updatedAt;
    switch (judgeRow(entry.localAt, remoteAt, params.meta.rows[id])) {
      case "push":
        plan.pushUpdated.push(entry);
        break;
      case "pull":
        plan.pullUpdated.push(id);
        break;
      case "conflict":
        plan.conflicts.push(id);
        break;
      case "skip":
        break;
    }
  }

  for (const id of remoteMap.keys()) {
    if (localMap.has(id)) continue;
    if (orphanSet.has(id)) continue;
    plan.pullNew.push(id);
  }

  plan.pushNew.sort((a, b) => (a.id < b.id ? -1 : 1));
  plan.pushUpdated.sort((a, b) => (a.id < b.id ? -1 : 1));
  plan.pullNew.sort();
  plan.pullUpdated.sort();
  plan.conflicts.sort();
  return plan;
}

/** 计划里有没有任何要做的事。 */
export function planIsEmpty(plan: SyncPlan): boolean {
  return (
    plan.pushNew.length === 0 &&
    plan.pushUpdated.length === 0 &&
    plan.pullNew.length === 0 &&
    plan.pullUpdated.length === 0 &&
    plan.orphans.length === 0
  );
}

/**
 * 首次同步时，本地和云端都已经有数据、而且两边内容不一样，该怎么办。
 *
 * 返回 `null` 表示可以直接自动处理（只有一边有数据，或者两边完全一致）。
 * 这种情况不猜——猜错就是丢数据，交给用户在设置面板里选。
 */
export function decideBootstrap(params: {
  hasLocalData: boolean;
  hasRemoteData: boolean;
  localMatchesRemote: boolean;
  latestLocalAt: number;
}): "pushLocal" | "pullRemote" | null {
  const { hasLocalData, hasRemoteData, localMatchesRemote, latestLocalAt } =
    params;

  // 云端什么都没有 → 把本地推上去（首次备份）
  if (!hasRemoteData) return "pushLocal";
  // 本地什么都没有 → 从云端拉下来（新设备 / 清过缓存）
  if (!hasLocalData) return "pullRemote";
  // 两边内容一致（比如刚推送完就被清掉了元数据）→ 不需要做任何事
  if (localMatchesRemote) return null;

  // 两边都有、内容不同：
  // 本地行有 mtime = 这台设备上确实有人改过东西（例如刚导入完题库就配上了
  // 云端）→ 偏向本地；mtime 全是 0 = 本地只是「有数据」，那多半是一台新设备
  // 连上一个已经有云端的账号 → 拉取云端。
  return latestLocalAt > 0 ? "pushLocal" : "pullRemote";
}
