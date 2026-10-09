/**
 * 合并：把「本地有什么 / 云端有什么 / 上次同步时是什么样」算成一份计划。
 *
 * 刻意做成纯函数（不碰网络、不碰 localStorage），因为这是整个同步里最需要被测试、
 * 也最容易出错的一段：搞错了就是静默覆盖用户数据。
 *
 * ── 同步单元是「题库」，不是「文件」─────────────────────────────────────────
 *
 * 分片文件（`banks-N.json`）只是绕开 Gitee「一条 Gist 最多 10 个文件」的容器。
 * 早期版本按**文件**做三方合并，于是同一片里改 A 题库、B 题库就会互相牵连，
 * 甚至把一个题库的冲突算到整片上。现在全部按题库逐条判定。
 *
 * ── 两个独立的信号 ──────────────────────────────────────────────────────────
 *
 *   localChanged  = 这个题库的本地修改时间 > 上次同步时间（`syncedAt`）
 *   remoteChanged = 这个题库的云端内容哈希 ≠ 上次同步时记下的哈希（`remoteHash`）
 *
 * 用哈希而不是云端时间戳判断「云端改过没有」，是因为 Gitee 的 `updated_at` 只在
 * Gist 级别：你改了题库 A，整个 Gist 的时间就变了，题库 B 的时间戳也跟着"变"。
 *
 *   localChanged | remoteChanged | 结果
 *   ────────────┼──────────────┼──────────────────
 *       否      |      否       | 跳过
 *       是      |      否       | 上传
 *       否      |      是       | 下载
 *       是      |      是       | 冲突（绝不自动选边）
 *
 * 只在一边存在的题库：
 *   - 没有元数据 = 这台设备/云端第一次见 → 那边有就传那边（新导入的上传、
 *     别的设备新增的下载）；
 *   - 有元数据 = 另一边把它删了 → 跟着删（本地删了回收云端，云端删了本地也删）。
 */

import {
  bankContentHash,
  bankProgressHash,
  normalizeGeneral,
  stableHash,
  type BankRecord,
  type CollectedState,
} from "./collect";
import { planProgressMerge } from "./progressMerge";
import {
  GIST_GENERAL_FILE,
  bankRowKey,
  isLegacyBankFileName,
  shardFileName,
  shardIndexFromFileName,
  shardIndexOf,
  type BankSnapshot,
  type ConflictResolution,
  type GeneralSnapshot,
  type LibraryEntry,
  type RemoteFile,
  type SyncMeta,
  type SyncRowMeta,
  type ShardSnapshot,
} from "./types";

// ── 两边的形状 ──────────────────────────────────────────────────────────────

/** 云端的一个题库。 */
export interface RemoteBank {
  hash: string;
  /** 它落在哪个分片 */
  shard: number;
  /** **内容**哈希（题目 + 模式，与 `BankRecord.contentHash` 同一套口径） */
  contentHash: string;
  /** **进度**哈希（`state` 整段）；与内容哈希分开，冲突判定只认内容 */
  progressHash: string;
  name: string;
  snapshot: BankSnapshot;
}

/** 从 Gist 文件解出来的云端状态。 */
export interface RemoteState {
  /** 云端那份 `_general.json`；解不出来时是 null */
  general: GeneralSnapshot | null;
  generalHash: string;
  files: RemoteFile[];
  banks: Map<string, RemoteBank>;
  /** 分片下标 → 该文件里的题库 hash */
  shardBanks: Map<number, string[]>;
  /** 认不出来 / 解不开的分片文件名，原样留着不动 */
  unreadableShards: string[];
}

// ── 判定 ────────────────────────────────────────────────────────────────────

export type BankVerdict =
  | "skip"
  | "push"
  | "pull"
  | "deleteLocal"
  | "deleteRemote"
  | "conflict";

/** 一个题库的同步决定。 */
export interface BankAction {
  hash: string;
  /** 给人看的题库名 */
  name: string;
  verdict: BankVerdict;
  /** 本地内容的哈希；本地没有这个题库时 undefined */
  localHash?: string;
  /** 云端内容的哈希；云端没有这个题库时 undefined */
  remoteHash?: string;
  /** 本地最后改动时间（毫秒） */
  localAt: number;
  /**
   * 两边都动过、但**题目一样**时合出来的那份快照（见 `mergeBankSnapshots`）。
   *
   * 有它就说明这一轮不需要人裁决：引擎会把它**同时**写到本地与云端，
   * 两台设备的进度都保住。题目真的分叉了才会是 `conflict`，那时没有这个字段。
   */
  merged?: unknown;
  /** 这次合并是不是只有进度不同（用于给用户报一句「已合并进度」） */
  progressMerged?: boolean;
  /**
   * 这个 push 是「按卡合并进度」来的（不是普通的内容上传）。
   *
   * 用途只有一个：合并出来的那一份**即使和本地逐字节一样也要真的推上去**——
   * 云端那一份可能是空的（本地有进度、云端没有），照「没变化就不传」的规矩
   * 跳过就等于把本地进度永远留在本地。
   */
  mergedFromProgress?: boolean;
}

/** 云端某个分片文件里装了哪些题库（回收空文件时要重算）。 */
export interface RemoteShardRef {
  name: string;
  banks: string[];
}

/** 一份待执行的同步计划。 */
export interface SyncPlan {
  actions: BankAction[];
  /** 合并后的 `_general.json`（本地应该长成的样子） */
  general: GeneralSnapshot;
  /** 要不要把 general 推到云端 */
  generalPush: boolean;
  /** 本地的 general 需不需要改写 */
  generalChangedLocal: boolean;
  /**
   * 列表 / 设置是不是真的变了（**不看题库的增删**）。
   *
   * 只用来给用户报一句「设置已更新」：题库的增删已经有「新增 / 删除」在报了，
   * 再按 general 文件变没变来报，就会变成「导入了 1 个题库」也顺带说「设置已更新」。
   */
  settingsChanged: boolean;
  /** 需要重建并上传的分片下标（重建后内容没变就不传） */
  pushShards: number[];
  /** 应当从云端删掉的文件（分片空了 / 旧格式残留） */
  deleteRemoteFiles: string[];
  /** 还没裁决的冲突 */
  conflicts: BankAction[];
  /** 云端分片现状（裁决冲突后重算回收列表用） */
  remoteShards: RemoteShardRef[];
  /** 云端那些旧格式残留 / 认不出来的文件 */
  remoteJunkFiles: string[];
}

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

function same(a: unknown, b: unknown): boolean {
  return stableHash(a ?? null) === stableHash(b ?? null);
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
        return local.snapshot.state === undefined ? "pull" : "push";
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
      const localHasState = local.snapshot.state !== undefined;
      const remoteHasState = remote.snapshot.state !== undefined;
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

/**
 * 在云端分片里按 hash 找这个题库、算出它的内容哈希。
 *
 * 用在「只有本地有」的删除判定上：`remote.banks` 是按**题目内容**归拢的，
 * 云端改过题目时匹配不上，但分片快照里的 `banks[<hash>]` 仍然在。
 * 找到就用 `bankContentHash` 算（与本地同一个口径），找不到返回 undefined
 * （= 云端确实没有这个题库 = 真删除）。
 */
function bankContentHashInRemoteFiles(
  remote: RemoteState,
  hash: string,
): string | undefined {
  const index = shardIndexOf(hash);
  const file = remote.files.find(
    (candidate) => shardIndexFromFileName(candidate.name) === index,
  );
  if (file?.json == null) return undefined;
  try {
    const parsed = JSON.parse(file.json) as { banks?: Record<string, unknown> };
    const bank = parsed?.banks?.[hash];
    if (bank === null || typeof bank !== "object") return undefined;
    const snapshot = bank as BankSnapshot;
    if (!Array.isArray(snapshot.questions)) return undefined;
    return bankContentHash(snapshot);
  } catch {
    return undefined;
  }
}

/** 「用本地覆盖云端」：无条件把本地全部推上去，云端多出来的题库删掉。 */
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
function remoteJunkFiles(remote: RemoteState): string[] {
  const junk: string[] = [];
  for (const file of remote.files) {
    if (file.name === GIST_GENERAL_FILE) continue;
    if (shardIndexFromFileName(file.name) !== null) continue;
    // 旧版「每个题库一个文件」的残留一律回收；别的陌生文件不动
    if (isLegacyBankFileName(file.name)) junk.push(file.name);
  }
  return junk.sort();
}

/** 从本地 / 云端两边算出完整计划。 */
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
    };

    // 「题目一样、进度两边都动过」→ 这里把两份进度合起来交给引擎
    // （同时写本地与云端）。判定本身只说 push，合并的活儿归这里，
    // 免得 `judgeBank` 的返回值既可能是结论又可能带数据、调用方还要分辨。
    if (
      judged === "push" &&
      localBank !== undefined &&
      remoteBank !== undefined &&
      localBank.contentHash === remoteBank.contentHash
    ) {
      const merge = planProgressMerge({
        base: baseSnapshotOf(hash),
        local: localBank.snapshot,
        remote: remoteBank.snapshot,
      });
      if (merge.kind === "skip") action.verdict = "skip";
      else if (merge.kind === "merge") {
        action.merged = merge.snapshot;
        action.progressMerged = true;
      }
    }

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
    if (action.verdict !== "push" && action.verdict !== "deleteRemote") continue;
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

const EMPTY_GENERAL: GeneralSnapshot = {
  activeBank: null,
  defaultSettings: {},
  library: [],
  globalSettings: {},
};

/** 一个题库名 / 模式 / 数量，用来给题库列表补条目。 */
interface BankSummaryInput {
  name: string;
  mode: "quiz" | "memory";
  count: number;
}

function summarize(
  actions: readonly BankAction[],
  localBanks: ReadonlyMap<string, BankRecord>,
  remoteBanks: ReadonlyMap<string, RemoteBank>,
): Map<string, BankSummaryInput> {
  const result = new Map<string, BankSummaryInput>();
  for (const action of actions) {
    if (action.verdict === "deleteLocal" || action.verdict === "deleteRemote") {
      continue;
    }
    const local = localBanks.get(action.hash);
    const remote = remoteBanks.get(action.hash);
    const bank = local?.snapshot ?? remote?.snapshot;
    if (bank === undefined) continue;
    result.set(action.hash, {
      name: bank.name,
      mode: bank.mode,
      count: Array.isArray(bank.questions) ? bank.questions.length : 0,
    });
  }
  return result;
}

/**
 * 合并 `_general.json`。
 *
 * `library` **不是**简单选一边：它得如实反映合并之后的题库集合——两台设备
 * 各自导入的题库都要在列表里出现，被删掉的要消失。名字与顺序这类元数据
 * 才走「哪边改过听哪边」。
 */
/**
 * 两份 general 的「设置部分」是不是一样——**不看题库的增删**。
 *
 * 比的是：当前题库 / 全局设置 / 默认设置，题库列表里**两边都有**的那些条目的
 * 字段（改名、换模式、题数都算），以及这些条目之间的**相对顺序**（拖一下顺序
 * 也是改动，而且是最容易同步不过去的那种）。
 *
 * 只在一边出现的题库条目**不比**：那是「新增 / 删除」，由题库那两项在报；
 * 掺进来就会变成「导入一个题库」也顺带说「设置已更新」。
 */
export function sameSettings(a: GeneralSnapshot, b: GeneralSnapshot): boolean {
  if (
    stableHash([a.activeBank, a.defaultSettings, a.globalSettings]) !==
    stableHash([b.activeBank, b.defaultSettings, b.globalSettings])
  ) {
    return false;
  }

  const fingerprint = (snapshot: GeneralSnapshot): Map<string, string> => {
    const map = new Map<string, string>();
    for (const entry of snapshot.library) {
      const { hash, ...rest } = entry;
      map.set(hash, stableHash(rest));
    }
    return map;
  };

  const aMap = fingerprint(a);
  const bMap = fingerprint(b);
  const shared = new Set([...aMap.keys()].filter((hash) => bMap.has(hash)));
  for (const hash of shared) {
    if (aMap.get(hash) !== bMap.get(hash)) return false;
  }

  const sequence = (snapshot: GeneralSnapshot): string[] =>
    snapshot.library.map((entry) => entry.hash).filter((hash) => shared.has(hash));
  return sameList(sequence(a), sequence(b));
}

export function mergeGeneral(params: {
  local: GeneralSnapshot;
  remote: GeneralSnapshot | null;
  base: GeneralSnapshot | null;
  actions: readonly BankAction[];
  localBanks: ReadonlyMap<string, BankRecord>;
  remoteBanks: ReadonlyMap<string, RemoteBank>;
  localHasEdits: boolean;
}): GeneralSnapshot {
  const {
    local,
    remote,
    base,
    actions,
    localBanks,
    remoteBanks,
    localHasEdits,
  } = params;

  const remoteGeneral = remote ?? EMPTY_GENERAL;
  const alive = summarize(actions, localBanks, remoteBanks);

  const pick = <K extends "activeBank" | "defaultSettings" | "globalSettings">(
    key: K,
  ): GeneralSnapshot[K] => {
    if (base === null) {
      // 没有基准：本地是个空壳就听云端的，否则以本地为准
      // （换设备 / 清过缓存的新设备走这条，绝不能让空壳覆盖云端）
      return (localHasEdits ? local[key] : remoteGeneral[key]) as GeneralSnapshot[K];
    }
    const localChanged = !same(local[key], base[key]);
    const remoteChanged = !same(remoteGeneral[key], base[key]);
    if (localChanged && !remoteChanged) return local[key] as GeneralSnapshot[K];
    if (!localChanged && remoteChanged) return remoteGeneral[key] as GeneralSnapshot[K];
    // 两边都改过 / 都没改：本地优先（都没改时两边本来就一样）
    return local[key] as GeneralSnapshot[K];
  };

  const library = mergeLibrary({
    local: local.library,
    remote: remoteGeneral.library,
    base: base?.library ?? null,
    alive,
    localHasEdits,
  });

  // 激活题库：本地那个还在就用本地的，否则退到云端那个，都没有就置空
  const activeBank =
    local.activeBank !== null && alive.has(local.activeBank)
      ? local.activeBank
      : remoteGeneral.activeBank !== null && alive.has(remoteGeneral.activeBank)
        ? remoteGeneral.activeBank
        : null;

  return {
    activeBank,
    defaultSettings: pick("defaultSettings"),
    library,
    globalSettings: pick("globalSettings"),
  };
}

function mergeLibrary(params: {
  local: readonly LibraryEntry[];
  remote: readonly LibraryEntry[];
  base: readonly LibraryEntry[] | null;
  alive: ReadonlyMap<string, BankSummaryInput>;
  localHasEdits: boolean;
}): LibraryEntry[] {
  const { local, remote, base, alive, localHasEdits } = params;

  const index = (entries: readonly LibraryEntry[]): Map<string, LibraryEntry> => {
    const map = new Map<string, LibraryEntry>();
    for (const entry of entries) map.set(entry.hash, entry);
    return map;
  };
  const localMap = index(local);
  const remoteMap = index(remote);
  const baseMap = base === null ? null : index(base);

  const chosen = new Map<string, LibraryEntry>();
  for (const [hash, summary] of alive) {
    const l = localMap.get(hash);
    const r = remoteMap.get(hash);
    if (l && r) {
      if (baseMap === null) {
        chosen.set(hash, l);
      } else {
        const b = baseMap.get(hash);
        const localChanged = !same(l, b);
        const remoteChanged = !same(r, b);
        chosen.set(hash, !localChanged && remoteChanged ? r : l);
      }
    } else if (l) {
      chosen.set(hash, l);
    } else if (r) {
      chosen.set(hash, r);
    } else {
      chosen.set(hash, {
        hash,
        name: summary.name,
        mode: summary.mode,
        count: summary.count,
        addedAt: Date.now(),
      });
    }
  }

  // ── 顺序 ──
  //
  // 顺序也要三方合并，不能无脑用本地那份：否则「在 A 上把题库拖到最前面」
  // 永远传不到 B（两边条目内容一模一样，只有数组顺序变了）。
  // 判据是「谁动过顺序」——只按仍然存在的题库比较，删除题库不该被当成重排。
  const localOrder = orderOf(local, alive);
  const remoteOrder = orderOf(remote, alive);
  const baseOrder = base === null ? null : orderOf(base, alive);

  let order: string[];
  if (baseOrder === null) {
    // 没有基准：本地是个空壳（新设备）就听云端的顺序，否则以本地为准
    order = [...(localHasEdits ? localOrder : remoteOrder)];
  } else {
    const localReordered = !sameList(localOrder, baseOrder);
    const remoteReordered = !sameList(remoteOrder, baseOrder);
    // 只有云端动过顺序就跟着云端；两边都动过 / 都没动 → 本地优先
    order = [...(!localReordered && remoteReordered ? remoteOrder : localOrder)];
  }

  // 顺序里还没提到的（新合成的条目等）接在后面，按 hash 排
  const seen = new Set(order);
  for (const hash of [...alive.keys()].sort()) {
    if (seen.has(hash)) continue;
    seen.add(hash);
    order.push(hash);
  }

  return order.map((hash) => chosen.get(hash) as LibraryEntry);
}

/** 题库列表里「还活着的那些」的顺序，用来判断谁动过排序。 */
function orderOf(
  entries: readonly LibraryEntry[],
  alive: ReadonlyMap<string, BankSummaryInput>,
): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const entry of entries) {
    if (!alive.has(entry.hash) || seen.has(entry.hash)) continue;
    seen.add(entry.hash);
    order.push(entry.hash);
  }
  return order;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** 计划里有没有任何要做的事。 */
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
    return { ...action, verdict: wanted };
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
export function buildRemoteState(files: readonly RemoteFile[]): RemoteState {
  const banks = new Map<string, RemoteBank>();
  const shardBanks = new Map<number, string[]>();
  const unreadableShards: string[] = [];

  let general: GeneralSnapshot | null = null;
  let generalHash = "";

  for (const file of files) {
    if (file.name === GIST_GENERAL_FILE) {
      generalHash = file.hash;
      general = parseGeneral(file.json);
      continue;
    }
    const index = shardIndexFromFileName(file.name);
    if (index === null) continue;
    if (file.json === null) {
      unreadableShards.push(file.name);
      continue;
    }
    let snapshot: ShardSnapshot;
    try {
      snapshot = JSON.parse(file.json) as ShardSnapshot;
    } catch {
      unreadableShards.push(file.name);
      continue;
    }
    const record = snapshot?.banks;
    if (record === null || typeof record !== "object") {
      unreadableShards.push(file.name);
      continue;
    }

    const hashes: string[] = [];
    for (const [hash, raw] of Object.entries(record)) {
      if (raw === null || typeof raw !== "object") continue;
      const bank = raw as BankSnapshot;
      if (!Array.isArray(bank.questions)) continue;
      const name =
        typeof bank.name === "string" && bank.name.length > 0
          ? bank.name
          : "未命名题库";
      const snapshot: BankSnapshot = {
        mode: bank.mode === "memory" ? "memory" : "quiz",
        name,
        questions: bank.questions,
        ...(bank.state === undefined ? {} : { state: bank.state }),
      };
      hashes.push(hash);
      banks.set(hash, {
        hash,
        shard: index,
        // 哈希算在归一化后的快照上，和本地那份用同一套口径
        contentHash: bankContentHash(snapshot),
        progressHash: bankProgressHash(snapshot),
        name,
        snapshot,
      });
    }
    shardBanks.set(index, hashes);
  }

  return { general, generalHash, files: [...files], banks, shardBanks, unreadableShards };
}

function parseGeneral(json: string | null): GeneralSnapshot | null {
  if (json === null) return null;
  try {
    return normalizeGeneral(JSON.parse(json));
  } catch {
    return null;
  }
}
