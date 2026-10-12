/**
 * 计划器：把「本地有什么 / 云端有什么 / 上次同步时是什么样」算成一份计划。
 *
 * 从旧的 `merge.ts` 拆出来（那个文件 1000 多行，合并 / 计划 / general / 云端解析
 * 全混在一起）。**纯函数**：不碰网络、不碰 localStorage——这是整个同步里最需要
 * 被测试、也最容易出错的一段，搞错了就是静默覆盖用户数据。
 *
 * 判定结果**不再被调用方改写**：`judgeBank` 只回答「往哪个方向走」，完整决定由
 * `plan.ts` 的 `decideBank` 一次给出（见那个文件的文件头）。
 */

import { stableHash, type BankRecord, type CollectedState } from "./collect";
import { mergeGeneral, sameSettings } from "./general";
import { decideBank } from "./plan";
import { bankContentHashInRemoteFiles, remoteJunkFiles } from "./remote";
import {
  bankRowKey,
  shardFileName,
  shardIndexFromFileName,
  shardIndexOf,
  type BankAction,
  type BankVerdict,
  type ConflictResolution,
  type GeneralSnapshot,
  type RemoteBank,
  type RemoteState,
  type SyncMeta,
  type SyncPlan,
  type SyncRowMeta,
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
 * 这份快照「没有进度」吗。
 *
 * `null` 与 `undefined` 必须当成**同一件事**，别只判 `undefined`：
 *
 *   - `bankProgressHash` 用 `state ?? null` 归一（两者算出同一个哈希），
 *     `progressMerge` 的 `stateOf` 用 `asRecord`（`null` → `undefined`）——
 *     那两处都把它们当「没有进度」；
 *   - 但 `writeBankLocally` 会把 `null` 原样 `JSON.stringify` 成字符串 `"null"`
 *     写进 localStorage，于是这份「空进度」会一路传到云端、再传回来。
 *
 * 判定这里漏掉 `null` 的后果很具体：「本地没进度、云端有进度」会被读成
 * 「本地有进度」，于是走 `push`，**把云端那份真进度覆盖成空**。
 */
function hasNoState(bank: { snapshot: { state?: unknown } }): boolean {
  return bank.snapshot.state == null;
}

/**
 * 单个题库的三方判定。
 *
 * `baseline` 是「上次同步时这一行是什么」：新格式是题库行（`bank:<hash>`），
 * 老格式只有分片文件的元数据（`banks-3.json`）——升级上来的设备第一次同步
 * 还能拿它当兜底基准，不然后面那些判定全都没有参照物。
 */

export function judgeBank(params: {
  local?: BankRecord;
  remote?: RemoteBank;
  /** 题库行的基准（新格式） */
  row?: SyncRowMeta;
  /** 该题库所在分片文件的基准（老格式兜底） */
  fileRow?: SyncRowMeta;
  /** 云端那个分片文件当前的内容哈希（配合 fileRow 判断「云端改过没有」） */
  remoteFileHash?: string;
  /**
   * 云端那份**该题库**的内容哈希（只含题目 + 模式）。
   *
   * 「只有本地有」时才有意义：`remote` 为 undefined 只能说明**当前**云端解析出来的
   * 题库表里没有它，但为了判断「云端是删了它、还是改了它」，调用方可以从云端分片
   * 快照里再查一次（改过题目但同片的其它题库仍在时，它仍会在分片里）。
   * 查不到就是 `undefined` = 云端确实没有它。
   */
  remoteBankContentHash?: string;
}): BankVerdict {
  const { local, remote, row, fileRow, remoteFileHash, remoteBankContentHash } =
    params;

  // ── 两边都有 ──
  if (local && remote) {
    // ① **题目一模一样**：这一轮没有任何需要裁决的东西，只看进度怎么合
    //
    //    进度不参与「内容冲突」的判定是有意的：两台设备先后做同一份题库是
    //    最日常的用法，判成冲突再让人二选一，等于必然丢掉一边的进度。
    if (local.contentHash === remote.contentHash) {
      if (local.progressHash === remote.progressHash) return "skip";

      const baseline = row ?? fileRow;
      if (baseline === undefined) {
        // 第一次接上这个云端（没有任何基准）：
        //   - 本地没进度 → 听云端的
        //   - 本地有进度 → 推上去（别白丢本地那份），顺带把基准立起来
        return hasNoState(local) ? "pull" : "push";
      }
      // 本地没动过 → 跟着云端那份进度走
      if (local.localAt <= baseline.syncedAt) return "pull";
      // 两边都动过 → 按卡合并（合并结果由 `buildSyncPlan` 生成后交给引擎）
      return "push";
    }

    // ② 题目不一样：按两个信号判谁改过
    const baseline = row ?? fileRow;
    if (baseline === undefined) {
      // 没有任何基准（这台设备第一次接上这个云端，而且两边都已经有这份题库）。
      // 先看有没有「空的一边」可以安全地让路，再退到让用户裁决。
      const localHasState = !hasNoState(local);
      const remoteHasState = !hasNoState(remote);
      if (!localHasState && remoteHasState) return "pull";
      if (localHasState && !remoteHasState) return "push";
      return "conflict";
    }

    const localChanged = local.localAt > baseline.syncedAt;
    // 老格式只有文件级的哈希：文件没变就说明云端这个题库也没变。
    // 题库行的基准优先读 `contentHash`（只含题目），读不到才退回 `remoteHash`
    // ——老记账里那个字段正好就是内容哈希。
    const baselineContentHash = row ? (row.contentHash ?? row.remoteHash) : undefined;
    const remoteChanged =
      baselineContentHash !== (row ? remote.contentHash : remoteFileHash);

    if (localChanged && remoteChanged) return "conflict";
    if (localChanged) return "push";
    if (remoteChanged) return "pull";
    // 题目不同、两边按基准看都没动过：老格式的文件级基准才会走到这里
    // （同片的别的题库动过就会让文件哈希变，从而两边都"动过"）。
    // 这时以本地为准——总比永远跳过、差异一直摆在那里强。
    return "push";
  }

  // ── 只有本地有 ──
  if (local && !remote) {
    // 有题库行的基准 = 上次同步时它还在云端。但**删除不能压过编辑**：
    // 只有「云端相对基准也没动」才说明那边真的只是删了。
    //
    // 判据用基准行里记的**题库内容哈希**（`contentHash`，只含题目 + 模式）。
    // 老格式只有分片文件的 `remoteHash`，跟单个题库不是一个口径，比不出结论
    // ——那种情况按「纯删除」处理（与改动前一致），不冒险报假冲突。
    //
    // 云端那个题库的内容哈希 `remoteBankContentHash` 由调用方从**当前云端分片**
    // 里取（题库已经不在云端了时是 undefined = 云端确实没有它 = 真删除）。
    if (row !== undefined) {
      const cloudChanged =
        row.contentHash !== undefined &&
        remoteBankContentHash !== undefined &&
        row.contentHash !== remoteBankContentHash;
      return cloudChanged ? "conflict" : "deleteLocal";
    }
    return "push";
  }

  // ── 只有云端有 ──
  if (!local && remote) {
    // 本地没有它：可能是「这台设备删了它」，也可能是「别的设备新导入的」
    // （后者没有基准行，走下面的 `pull`）。
    //
    // 有基准行时**不能直接删**：还得看云端那份相对基准动过没有。
    //   - 没动过 → 本地确实只是删了它 → 回收云端那一份（正常删除传播）
    //   - 动过   → 云端在基准之后被改过（例如另一台设备改了题目），
    //              这时删掉就是「删除压过编辑」，必须让用户裁决
    //
    // 判据用**题库内容哈希**（`contentHash`，只含题目 + 模式）。老格式只有分片
    // 文件的 `remoteHash`，跟单个题库不是一个口径，比不出结论——那种情况按
    // 「纯删除」处理（与改动前一致），不冒险报假冲突。
    if (row !== undefined) {
      const cloudChanged =
        row.contentHash !== undefined &&
        remote.contentHash !== row.contentHash;
      return cloudChanged ? "conflict" : "deleteRemote";
    }
    return "pull";
  }

  return "skip";
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
      verdict: "push",
      upload: true,
      localHash: bank.contentHash,
      remoteHash: remote.banks.get(bank.hash)?.contentHash,
      localAt: bank.localAt,
    });
  }
  for (const bank of remote.banks.values()) {
    if (local.banks.has(bank.hash)) continue;
    plan.actions.push({
      hash: bank.hash,
      name: bank.name,
      verdict: "deleteRemote",
      upload: true,
      remoteHash: bank.contentHash,
      localAt: 0,
    });
  }
  plan.generalPush = true;
  // 云端原来那份设置会被本地这份盖掉（云端还没有 general 时不算「变了」）
  plan.settingsChanged =
    remote.general !== null && !sameSettings(plan.general, remote.general);
  plan.pushShards = shardsToPush(plan.actions, []);
  plan.remoteShards = [...remote.shardBanks].map(([index, banks]) => ({
    name: shardFileName(index),
    banks,
  }));
  plan.remoteJunkFiles = remoteJunkFiles(remote);
  plan.deleteRemoteFiles = emptyRemoteFiles(
    plan.actions,
    remote.shardBanks,
    plan.remoteJunkFiles,
    [],
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
      verdict: "pull",
      upload: false,
      localHash: local.banks.get(bank.hash)?.contentHash,
      remoteHash: bank.contentHash,
      localAt: local.banks.get(bank.hash)?.localAt ?? 0,
    });
  }
  for (const bank of local.banks.values()) {
    if (remote.banks.has(bank.hash)) continue;
    plan.actions.push({
      hash: bank.hash,
      name: bank.snapshot.name,
      verdict: "deleteLocal",
      upload: false,
      localHash: bank.contentHash,
      localAt: bank.localAt,
    });
  }
  // 云端为准：不回推 general，但要把合并后的 general 落到本地
  plan.generalChangedLocal = true;
  // 本地这份设置会被云端那份盖掉
  plan.settingsChanged = !sameSettings(local.general, plan.general);
  return plan;
}

/** 云端那些「不是我们的分片文件」：旧格式残留 + 认不出来的文件。 */

export function buildSyncPlan(params: {
  local: CollectedState;
  remote: RemoteState;
  meta: SyncMeta;
}): SyncPlan {
  const { local, remote, meta } = params;

  const fileBaselineOf = (hash: string): SyncRowMeta | undefined => {
    const index = remote.banks.get(hash)?.shard;
    const fromRemote =
      index === undefined ? undefined : meta.rows[shardFileName(index)];
    if (fromRemote !== undefined) return fromRemote;
    const localIndex = local.banks.get(hash)?.shard;
    return localIndex === undefined ? undefined : meta.rows[shardFileName(localIndex)];
  };

  /**
   * 三方合并要的那份「上次同步成功时这个题库长什么样」。
   *
   * 题库行优先，但**它没有快照时退回任何一个有快照的行**（老格式的文件行、
   * 或者升级上来还没有快照的题库行）。没有它，`mergeBankSnapshots` 只能退化成
   * 「两边各取更靠前的」——同一张卡上「一边答对推进、另一边答错归零」这类
   * 情形就会合错（真踩过：合并之后掌握档位被另一边拖回去）。
   */
  const baseSnapshotOf = (hash: string): unknown => {
    const row = meta.rows[bankRowKey(hash)];
    if (row?.snapshot !== undefined) return row.snapshot;
    return fileBaselineOf(hash)?.snapshot;
  };

  const actions: BankAction[] = [];
  const hashes = new Set<string>([
    ...local.banks.keys(),
    ...remote.banks.keys(),
  ]);

  for (const hash of hashes) {
    const localBank = local.banks.get(hash);
    const remoteBank = remote.banks.get(hash);
    const judged = judgeBank({
      local: localBank,
      remote: remoteBank,
      row: meta.rows[bankRowKey(hash)],
      fileRow: fileBaselineOf(hash),
      remoteFileHash:
        remoteBank === undefined
          ? undefined
          : remote.files.find(
              (file) => shardIndexFromFileName(file.name) === remoteBank.shard,
            )?.hash,
      // 「云端改过没有」要用**题库**的内容哈希。`remoteBank` 为 undefined 时
      // 再从云端分片快照里找一次：那边可能改了题目（所以按题库表匹配不上），
      // 但同片的快照里仍然有这个 hash。
      remoteBankContentHash:
        remoteBank?.contentHash ?? bankContentHashInRemoteFiles(remote, hash),
    });

    // 决定这一轮做什么。**「本地怎么改」与「要不要上传」是两个独立的问题**
    // （见 `plan.ts` 的文件头：把它们混成一个 `verdict` 再让调用方改写，
    // 就是上一个线上 bug 的根因），所以这里拿到的是一个完整的决定，不再事后修它。
    const decision = decideBank({
      judged,
      local:
        localBank === undefined
          ? undefined
          : { contentHash: localBank.contentHash, snapshot: localBank.snapshot },
      remote:
        remoteBank === undefined
          ? undefined
          : { contentHash: remoteBank.contentHash, snapshot: remoteBank.snapshot },
      base: baseSnapshotOf(hash),
    });

    const action: BankAction = {
      hash,
      name:
        localBank?.snapshot.name ??
        remoteBank?.name ??
        "未命名题库",
      verdict: judged,
      localHash: localBank?.contentHash,
      remoteHash: remoteBank?.contentHash,
      localAt: localBank?.localAt ?? 0,
      // `verdict` 保持 `judgeBank` 的原话（往哪个方向走），
      // 「要不要上传」与「合并出来的那份」由 `decideBank` 单独给出。
      upload: decision.upload,
      ...(decision.merged === undefined ? {} : { merged: decision.merged }),
      ...(decision.progressMerged ? { progressMerged: true } : {}),
    };

    actions.push(action);
  }

  actions.sort((a, b) => (a.hash < b.hash ? -1 : 1));

  const conflicts = actions.filter((action) => action.verdict === "conflict");
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
    pushShards: shardsToPush(actions, conflicts),
    deleteRemoteFiles: emptyRemoteFiles(
      actions,
      remote.shardBanks,
      remoteJunkFiles(remote),
      conflicts,
    ),
    conflicts,
    remoteShards: [...remote.shardBanks].map(([index, banks]) => ({
      name: shardFileName(index),
      banks,
    })),
    remoteJunkFiles: remoteJunkFiles(remote),
  };
}

/**
 * 哪些分片需要重建上传。
 *
 * **含未裁决冲突的分片一律不动**：分片是整体上传的，为了传同一片里的另一个
 * 题库而把它一起推上去，就等于替用户选了「保留本地」。
 */
function shardsToPush(
  actions: readonly BankAction[],
  conflicts: readonly BankAction[],
): number[] {
  const blocked = new Set(conflicts.map((action) => action.hash));
  const indexes = new Set<number>();
  for (const action of actions) {
    // 按 `upload` 而不是 `verdict`：判定 pull 但"本地手里那份云端没有"时同样要传
    if (!action.upload) continue;
    if (blocked.has(action.hash)) continue;
    indexes.add(shardIndexOfHash(action.hash));
  }
  for (const hash of blocked) indexes.delete(shardIndexOfHash(hash));
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
  conflicts: readonly BankAction[],
): string[] {
  const conflicted = new Set(conflicts.map((action) => action.hash));
  const alive = new Set(
    actions
      .filter(
        (action) =>
          action.verdict === "skip" ||
          action.verdict === "push" ||
          action.verdict === "pull",
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

function shardIndexOfHash(hash: string): number {
  return shardIndexOf(hash);
}

// ── general 的逐字段合并 ────────────────────────────────────────────────────

export function planIsEmpty(plan: SyncPlan): boolean {
  return (
    !plan.generalPush &&
    !plan.generalChangedLocal &&
    plan.deleteRemoteFiles.length === 0 &&
    plan.pushShards.length === 0 &&
    plan.actions.every(
      (action) => action.verdict === "skip" || action.verdict === "conflict",
    )
  );
}

/**
 * 按用户的选择把冲突裁决掉：`keepLocal` 推、`keepRemote` 拉。
 *
 * `resolutions` 是「用户已经答过的那些题库 → 他的选择」，**按题库 hash 逐个**
 * 应用，而不是一刀切：
 *   - 用户只可能对他**看见过**的那些冲突做选择（面板上列的就是它们）；
 *   - 两次同步之间又冒出来的新冲突必须继续问，绝不能被上一次的答案顺手带走。
 *
 * 裁决完要**重算** `pushShards` / `deleteRemoteFiles`——之前因为冲突而整片
 * 冻结的分片，现在可以动了。计划里带着云端分片的现状，所以这一步不需要
 * 再拿到 `RemoteState`。
 */
export function applyResolution(
  plan: SyncPlan,
  resolutions: ReadonlyMap<string, ConflictResolution>,
): SyncPlan {
  if (plan.conflicts.length === 0) return plan;

  const actions = plan.actions.map((action) => {
    const resolution = resolutions.get(action.hash);
    if (resolution === undefined) return action;
    const wanted: BankVerdict = resolution === "keepLocal" ? "push" : "pull";
    return { ...action, verdict: wanted, upload: wanted === "push" };
  });

  const shardBanks = new Map<number, string[]>();
  for (const shard of plan.remoteShards) {
    const index = shardIndexFromFileName(shard.name);
    if (index !== null) shardBanks.set(index, shard.banks);
  }

  // 还剩没裁决的（用户没见过的新冲突）就继续留着，由调用方决定怎么办
  const conflicts = actions.filter((action) => action.verdict === "conflict");

  return {
    ...plan,
    actions,
    conflicts,
    pushShards: shardsToPush(actions, conflicts),
    deleteRemoteFiles: emptyRemoteFiles(
      actions,
      shardBanks,
      plan.remoteJunkFiles,
      conflicts,
    ),
  };
}

// ── 把云端的文件解成 RemoteState ────────────────────────────────────────────

/**
 * 从 Gist 文件组装云端状态。
 *
 * 认不出来的文件（不是我们的格式）一律跳过，只留个名字——绝不按猜测去动它。
 */
