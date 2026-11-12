/**
 * 计划器：把「本地有什么 / 云端有什么 / 上次同步时是什么样」算成一份计划。
 *
 * **纯函数**：不碰网络、不碰 localStorage——这是整个同步里最需要被测试、
 * 也最容易出错的一段，搞错了就是静默覆盖用户数据。
 *
 * 每个题库"做什么"只有一处决定：`decision.ts` 的 `decideBankSync`。这个文件
 * 只负责把那些决定装进计划、并算出"哪些分片要重建上传 / 哪些云端文件该回收"。
 * 旧版在这里还会按 mtime 改判一次，于是同一份数据能算出两个方向——不要再来一遍。
 */

import { stableHash, type BankRecord, type CollectedState } from "./collect";
import { decideBankSync } from "./decision";
import { debugLog, sessionSummary } from "@/lib/debug";
import { mergeGeneral, sameSettings } from "./general";
import type {
  BankAction,
  ConflictResolution,
  GeneralSnapshot,
  RemoteBank,
  RemoteState,
  SyncMeta,
  SyncPlan,
  SyncRowMeta,
} from "./types";
import { actionUploads } from "./types";

import { bankContentHashInRemoteFiles, remoteJunkFiles } from "./remote";
import {
  bankRowKey,
  shardFileName,
  shardIndexFromFileName,
  shardIndexOf,
} from "./types";

export function emptyPlan(general: GeneralSnapshot): SyncPlan {
  return {
    actions: [],
    general,
    generalPush: false,
    generalChangedLocal: false,
    settingsChanged: false,
    pushShards: [],
    deleteRemoteFiles: [],
    conflicts: [],
    remoteShards: [],
    remoteJunkFiles: [],
  };
}

/**
 * 单个题库这一轮做什么。
 *
 * 判定需要的每一样东西都从**内容**来：两边的题目 / 进度哈希、上次同步时的
 * 快照与内容哈希。`localAt` 只带进 `BankAction` 供展示，**不参与判定**。
 */
function actionOf(params: {
  hash: string;
  name: string;
  local?: BankRecord;
  remote?: RemoteBank;
  row?: SyncRowMeta;
  /** 云端分片里这个题库的内容哈希（判断"云端改过还是删了"） */
  cloudContentHash?: string;
}): BankAction {
  const { hash, name, local, remote, row, cloudContentHash } = params;
  const decision = decideBankSync({
    local:
      local === undefined
        ? undefined
        : {
            contentHash: local.contentHash,
            progressHash: local.progressHash,
            snapshot: local.snapshot,
            hasState: local.snapshot.state != null,
          },
    remote:
      remote === undefined
        ? undefined
        : {
            contentHash: remote.contentHash,
            progressHash: remote.progressHash,
            snapshot: remote.snapshot,
            hasState: remote.snapshot.state != null,
          },
    baseSnapshot: row?.snapshot,
    baseContentHash: row?.contentHash,
    cloudContentHash,
    hadBaseline: row !== undefined,
  });

  // 诊断：只在这一轮真要做点什么时说一句（`in-sync` 太吵）。
  // 三侧会话摘要能直接回答「云端到底有没有新进度」。
  if (decision.kind !== "in-sync") {
    debugLog(
      "sync:decide",
      `${name}(${hash.slice(0, 4)}) → ${decision.kind} — ${decision.reason}` +
        ` | local:${sessionSummary(local?.snapshot.state)}` +
        ` remote:${sessionSummary(remote?.snapshot.state)}` +
        ` base:${sessionSummary((row?.snapshot as { state?: unknown } | undefined)?.state)}`,
    );
  }

  return {
    hash,
    name,
    kind: decision.kind,
    localHash: local?.contentHash,
    remoteHash: remote?.contentHash,
    localAt: local?.localAt ?? 0,
    ...(decision.merged === undefined ? {} : { merged: decision.merged }),
    ...(decision.progressMerged ? { progressMerged: true } : {}),
    reason: decision.reason,
  };
}

export function buildSyncPlan(params: {
  local: CollectedState;
  remote: RemoteState;
  meta: SyncMeta;
}): SyncPlan {
  const { local, remote, meta } = params;

  const actions: BankAction[] = [];
  const hashes = new Set<string>([
    ...local.banks.keys(),
    ...remote.banks.keys(),
  ]);

  for (const hash of hashes) {
    const localBank = local.banks.get(hash);
    const remoteBank = remote.banks.get(hash);
    actions.push(
      actionOf({
        hash,
        name:
          localBank?.snapshot.name ??
          remoteBank?.name ??
          "未命名题库",
        local: localBank,
        remote: remoteBank,
        row: meta.rows[bankRowKey(hash)],
        // `remoteBank` 为 undefined 时再从云端分片快照里找一次：那边可能改了
        // 题目（所以按题库表匹配不上），但同片的快照里仍然有这个 hash。
        cloudContentHash:
          remoteBank?.contentHash ??
          bankContentHashInRemoteFiles(remote, hash),
      }),
    );
  }

  actions.sort((a, b) => (a.hash < b.hash ? -1 : 1));

  const conflicts = actions.filter((action) => action.kind === "conflict");
  const general = mergeGeneral({
    local: local.general,
    remote: remote.general,
    base: meta.generalBaseline,
    actions,
    localBanks: local.banks,
    remoteBanks: remote.banks,
    localHasEdits: local.generalHasEdits,
  });

  const remoteGeneralHash = remote.general === null ? null : remote.generalHash;
  const generalPush =
    remoteGeneralHash === null
      ? local.generalHasEdits || local.banks.size > 0
      : stableHash(general) !== remoteGeneralHash;

  return {
    actions,
    general,
    generalPush,
    generalChangedLocal: stableHash(general) !== local.generalHash,
    settingsChanged:
      // 本地那份会被改写（设置从云端下来了），或者云端那份会被改写（本地设置推上去）
      !sameSettings(local.general, general) ||
      (remote.general !== null && !sameSettings(general, remote.general)),
    pushShards: shardsToPush(actions),
    deleteRemoteFiles: emptyRemoteFiles(
      actions,
      remote.shardBanks,
      remoteJunkFiles(remote),
    ),
    conflicts,
    remoteShards: [...remote.shardBanks].map(([index, banks]) => ({
      name: shardFileName(index),
      banks,
    })),
    remoteJunkFiles: remoteJunkFiles(remote),
  };
}

export function forcePushPlan(
  local: CollectedState,
  remote: RemoteState,
  _meta: SyncMeta,
): SyncPlan {
  const plan = emptyPlan(local.general);
  for (const bank of local.banks.values()) {
    plan.actions.push({
      hash: bank.hash,
      name: bank.snapshot.name,
      kind: "upload",
      localHash: bank.contentHash,
      remoteHash: remote.banks.get(bank.hash)?.contentHash,
      localAt: bank.localAt,
      reason: "强制上传",
    });
  }
  for (const bank of remote.banks.values()) {
    if (local.banks.has(bank.hash)) continue;
    plan.actions.push({
      hash: bank.hash,
      name: bank.name,
      kind: "remove-remote",
      remoteHash: bank.contentHash,
      localAt: 0,
      reason: "强制上传",
    });
  }
  plan.generalPush = true;
  // 云端原来那份设置会被本地这份盖掉（云端还没有 general 时不算「变了」）
  plan.settingsChanged =
    remote.general !== null && !sameSettings(plan.general, remote.general);
  plan.pushShards = shardsToPush(plan.actions);
  plan.remoteShards = [...remote.shardBanks].map(([index, banks]) => ({
    name: shardFileName(index),
    banks,
  }));
  plan.remoteJunkFiles = remoteJunkFiles(remote);
  plan.deleteRemoteFiles = emptyRemoteFiles(
    plan.actions,
    remote.shardBanks,
    plan.remoteJunkFiles,
  );
  return plan;
}

/** 「用云端覆盖本地」：无条件把云端全部拉下来，本地多出来的题库删掉。 */
export function forcePullPlan(
  local: CollectedState,
  remote: RemoteState,
  _meta: SyncMeta,
): SyncPlan {
  const plan = emptyPlan(remote.general ?? local.general);
  for (const bank of remote.banks.values()) {
    plan.actions.push({
      hash: bank.hash,
      name: bank.name,
      kind: "download",
      localHash: local.banks.get(bank.hash)?.contentHash,
      remoteHash: bank.contentHash,
      localAt: local.banks.get(bank.hash)?.localAt ?? 0,
      reason: "强制下载",
    });
  }
  for (const bank of local.banks.values()) {
    if (remote.banks.has(bank.hash)) continue;
    plan.actions.push({
      hash: bank.hash,
      name: bank.snapshot.name,
      kind: "remove-local",
      localHash: bank.contentHash,
      localAt: bank.localAt,
      reason: "强制下载",
    });
  }
  // 云端为准：不回推 general，但要把合并后的 general 落到本地
  plan.generalChangedLocal = true;
  // 本地这份设置会被云端那份盖掉
  plan.settingsChanged = !sameSettings(local.general, plan.general);
  return plan;
}

/**
 * 哪些分片需要重建上传。
 *
 * **含未裁决冲突的分片一律不动**：分片是整体上传的，为了传同一片里的另一个
 * 题库而把它一起推上去，就等于替用户选了「保留本地」。
 */
export function shardsToPush(actions: readonly BankAction[]): number[] {
  const blocked = new Set(
    actions
      .filter((action) => action.kind === "conflict")
      .map((action) => shardIndexOf(action.hash)),
  );
  const indexes = new Set<number>();
  for (const action of actions) {
    if (!actionUploads(action)) continue;
    const index = shardIndexOf(action.hash);
    if (blocked.has(index)) continue;
    indexes.add(index);
  }
  return [...indexes].sort((a, b) => a - b);
}

/**
 * 云端哪些文件该回收。
 *
 * 判据是「这一片里的题库一个都不剩了」——它们全被删掉（本地删的、或云端删的）
 * 且没有待裁决的冲突。旧格式残留由 `junk` 单独列出来，一律回收。
 */
function emptyRemoteFiles(
  actions: readonly BankAction[],
  shardBanks: ReadonlyMap<number, readonly string[]>,
  junk: readonly string[],
): string[] {
  const conflicted = new Set(
    actions
      .filter((action) => action.kind === "conflict")
      .map((action) => action.hash),
  );
  // 「这一轮结束后还会留在云端」的题库：in-sync / upload / download / reconcile。
  // `remove-*` 都不留（一个删本地、一个删云端），冲突由上面单独冻结。
  const alive = new Set(
    actions
      .filter(
        (action) =>
          action.kind === "in-sync" ||
          action.kind === "upload" ||
          action.kind === "download" ||
          action.kind === "reconcile",
      )
      .map((action) => action.hash),
  );

  const files: string[] = [...junk];
  for (const [index, banks] of shardBanks) {
    if (banks.length === 0) continue;
    if (banks.some((hash) => conflicted.has(hash))) continue;
    if (banks.some((hash) => alive.has(hash))) continue;
    files.push(shardFileName(index));
  }

  return [...new Set(files)].sort();
}

export function planIsEmpty(plan: SyncPlan): boolean {
  return (
    !plan.generalPush &&
    !plan.generalChangedLocal &&
    plan.deleteRemoteFiles.length === 0 &&
    plan.pushShards.length === 0 &&
    plan.actions.every(
      (action) => action.kind === "in-sync" || action.kind === "conflict",
    )
  );
}

/**
 * 按用户的选择把冲突裁决掉：`keepLocal` 推、`keepRemote` 拉。
 *
 * `resolutions` 是「用户已经答过的那些题库 → 他的选择」，**按题库 hash 逐个**
 * 应用，而不是一刀切：用户只可能对他**看见过**的那些冲突做选择，两次同步之间
 * 又冒出来的新冲突必须继续问。
 *
 * 裁决完要**重算** `pushShards` / `deleteRemoteFiles`——之前因为冲突而整片
 * 冻结的分片，现在可以动了。
 */
export function applyResolution(
  plan: SyncPlan,
  resolutions: ReadonlyMap<string, ConflictResolution>,
): SyncPlan {
  if (plan.conflicts.length === 0) return plan;

  const actions = plan.actions.map((action) => {
    const resolution = resolutions.get(action.hash);
    if (resolution === undefined || action.kind !== "conflict") return action;
    // 裁决之后不再合并：保留本地就是原样上传，保留云端就是原样下载
    return resolution === "keepLocal"
      ? {
          ...action,
          kind: "upload" as const,
          merged: undefined,
          reason: "用户选择保留本地",
        }
      : {
          ...action,
          kind: "download" as const,
          merged: undefined,
          reason: "用户选择保留云端",
        };
  });

  const shardBanks = new Map<number, string[]>();
  for (const shard of plan.remoteShards) {
    const index = shardIndexFromFileName(shard.name);
    if (index !== null) shardBanks.set(index, shard.banks);
  }

  const conflicts = actions.filter((action) => action.kind === "conflict");

  return {
    ...plan,
    actions,
    conflicts,
    pushShards: shardsToPush(actions),
    deleteRemoteFiles: emptyRemoteFiles(
      actions,
      shardBanks,
      plan.remoteJunkFiles,
    ),
  };
}

/**
 * 计划里会不会写本机的题库进度（供引擎在"用户正在做题"时让路）。
 *
 * 直接按 `actionWritesLocal(kind)` 过滤，不另存一个"要写本地"的布尔——
 * 「写本地」与「上传」都只由 `kind` 决定。
 */
