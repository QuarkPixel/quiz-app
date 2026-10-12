/**
 * 落到本地 + 记账：把计划的结果写进 localStorage，并维护同步基准线。
 *
 * 从 `engine.svelte.ts` 拆出来——那个文件 1500 多行，编排（调度 / 状态机 / 错误处理）
 * 与这两件事混在一起。这里全是**纯函数或只碰 localStorage 的函数**，不碰响应式状态，
 * 所以可以单独测试与推理。
 *
 * 两组东西：
 *   - **落盘**：`applyRemoteState`（唯一入口，负责保留本机的设备本地字段）、
 *     `writeBankLocally` / `ensureLibraryEntry` / `removeBankLocally`
 *   - **记账**：`baselineMeta`（第一次建云端）/ `nextMeta`（同步成功后刷新基准线）
 *     ——「谁对齐了就写谁」是这里最容易出错的地方：冲突中的题库必须保持旧基准，
 *     否则下一轮会误判成「云端改过」而把本地改动悄悄拉掉。
 */

import { STORAGE_KEY_GENERAL } from "@/config";
import {
  GIST_GENERAL_FILE,
  bankHashFromRowKey,
  bankRowKey,
  shardIndexOf,
  type BankAction,
  type SyncConflict,
  type SyncMeta,
  type SyncPlan,
  type SyncRowMeta,
} from "./types";
import {
  bankFullHash,
  type CollectedState,
} from "./collect";
import { attachDeviceLocal } from "./model/policy";
import {
  applyRemoteValue,
  clearMtime,
  loadSyncMeta,
  readLocal,
  removeLocal,
  saveSyncMeta,
} from "./storage";

export function readActiveBankHash(): string | null {
  const raw = readLocal(STORAGE_KEY_GENERAL);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as { activeBank?: unknown };
    return typeof value?.activeBank === "string" ? value.activeBank : null;
  } catch {
    return null;
  }
}

/**
 * 同步之后云端一共有几个题库。
 *
 * 不能直接用本地题库数：被冲突冻住的分片里，「本地已删、云端还在」的题库
 * 这一轮不会从云端消失，直接数本地会少报。
 */
export function remoteBankCount(plan: SyncPlan): number {
  return plan.actions.filter((action) => {
    if (action.verdict === "deleteRemote") {
      // 没能删掉（分片被冲突冻住）→ 云端那份还在
      return !settledThisRound(plan, action);
    }
    if (action.verdict === "deleteLocal") return false; // 云端本来就没有
    return true;
  }).length;
}

/**
 * 这个题库这一轮真的对齐了吗？
 *
 * 「要上传」和「真的传上去了」不是一回事：含未裁决冲突的分片整体冻结，
 * 同一片里别的题库这一轮也就没上去——这时候绝不能给它写新基准线，
 * 否则下一次同步会把它误判成「云端改过」而把本地改动悄悄拉掉。
 */
export function settledThisRound(plan: SyncPlan, action: BankAction): boolean {
  switch (action.verdict) {
    case "conflict":
      return false;
    case "push":
    case "deleteRemote":
      return plan.pushShards.includes(shardIndexOf(action.hash));
    default:
      return true;
  }
}

/**
 * 盘上那份「第一次看到冲突」的记录，滤掉已经作废的。
 *
 * 一条记录作废有两种情况：
 *   - 这一行的**基准线不比它旧**（`syncedAt >= 记录时间`）：那次冲突已经裁决并
 *     同步过了——对账不会给冲突中的题库写新基准线，所以只要基准线追上了记录时间，
 *     就说明是裁决之后重写的。拿它当「冲突发生时间」会把一个早已解决的老冲突搬出来；
 *   - 本地已经没有这个题库：记录没有意义了。
 *
 * 反过来，基准线比记录**旧**说明冲突还在原地，那正是要保住的那个时间——
 * 刷新页面、关掉再打开同步，它都不该变。
 */
export function pruneConflictSeen(meta: SyncMeta): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [hash, at] of Object.entries(meta.conflicts)) {
    if (!(at > 0)) continue;
    const row = meta.rows[bankRowKey(hash)];
    if (row !== undefined && row.syncedAt >= at) continue;
    if (readLocal(`quiz_app_questions_${hash}`) === null) continue;
    kept[hash] = at;
  }
  return kept;
}

/** 把「第一次看到冲突」的记录写回同步元数据（整份读改写，只动 `conflicts` 一段）。 */
export function saveConflictSeen(seen: Record<string, number>): void {
  saveSyncMeta({ ...loadSyncMeta(), conflicts: seen });
}

/**
 * `BankAction` → 给 UI 看的冲突条目。
 *
 * 冲突的单位是题库，所以提示里直接写题库名——用户看到 `banks-3.json`
 * 根本不知道自己在选什么。
 */
export function toConflict(
  action: BankAction,
  detectedAt: number | undefined,
  remoteAt: number,
): SyncConflict {
  return {
    hash: action.hash,
    name: action.name,
    detail: "这个题库本机和云端都改过",
    localAt: action.localAt,
    remoteHash: action.remoteHash ?? "",
    detectedAt,
    remoteAt,
  };
}

// ── 落盘 ────────────────────────────────────────────────────────────────────

/**
 * 把一个题库写进 localStorage（拉取用）。
 *
 * 拉取**不碰 mtime**（见 `applyRemoteValue`）：这份内容来自云端，
 * 不是这台设备改的，记成「本地改动」会让下一次同步白推一遍甚至撞成冲突。
 */
/**
 * 把「可同步的状态」写回某个题库，**同时保留本机的设备本地字段**。
 *
 * 云端 / 合并结果里没有 `ui` / `filterType` / `activePool` 这些字段
 * （它们不参与同步，见 `model/policy.ts`）。直接覆盖会让本机的界面状态和
 * 当前这一轮的池子凭空消失——所以写回前先把本机那份贴回去。
 *
 * 这里是**唯一**把状态落盘的入口（拉取与合并都走它），漏一处就会丢本机状态。
 */
export function applyRemoteState(hash: string, syncable: unknown): void {
  const stateKey = `quiz_app_state_${hash}`;
  const existing = (() => {
    const raw = readLocal(stateKey);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  })();
  const next = attachDeviceLocal(syncable, existing);
  if (next === undefined) removeLocal(stateKey);
  else applyRemoteValue(stateKey, JSON.stringify(next));
}

export function writeBankLocally(bank: {
  hash: string;
  snapshot: { questions: unknown[]; state?: unknown };
}): void {
  const questionsKey = `quiz_app_questions_${bank.hash}`;
  const stateKey = `quiz_app_state_${bank.hash}`;

  applyRemoteValue(questionsKey, JSON.stringify(bank.snapshot.questions));
  // `state == null` = 云端这份没有进度 = 就是没有进度（跟着云端走，别留一份孤儿进度）。
  // `== null` 而不是 `=== undefined`：两者是同一个意思，原样写下去会在盘上留下
  // 字符串 `"null"`，然后被当成「有进度」一路传（见 `merge.ts` 的 `hasNoState`）。
  applyRemoteState(bank.hash, bank.snapshot.state);
  clearMtime(questionsKey);
  clearMtime(stateKey);
}

/**
 * 拉取之后把这个题库补进 `general.library`（只补 `mode`）。
 *
 * 为什么非得补：`collectLocalState` 是从库列表里取 `mode` 的，而**进度哈希**
 * 虽然不看 mode、**内容哈希**却看——库列表里没有这个题库时它会按默认的 `quiz`
 * 算，于是同一份题库在本地与云端算出两个哈希，下一轮同步平白判成「题目不一样」。
 * 库列表的权威是 `_general.json`（下一轮合并会把它补全），这里只是**先把哈希
 * 口径对齐**，不碰名字 / 顺序那些真正的列表内容。
 */
export function ensureLibraryEntry(hash: string, mode: "quiz" | "memory"): void {
  const raw = readLocal(STORAGE_KEY_GENERAL);
  if (raw === null) return;
  let general: { library?: unknown };
  try {
    general = JSON.parse(raw) as { library?: unknown };
  } catch {
    return;
  }
  if (!Array.isArray(general.library)) return;
  const entry = general.library.find(
    (item): item is { hash?: unknown } =>
      item !== null && typeof item === "object" && (item as { hash?: unknown }).hash === hash,
  );
  if (entry === undefined) return; // 列表里没有它：那是 general 的事，别在这里插队
  if ((entry as { mode?: unknown }).mode === mode) return;
  (entry as { mode?: unknown }).mode = mode;
  applyRemoteValue(STORAGE_KEY_GENERAL, JSON.stringify(general));
}

/** 删掉本地一个题库的题目与进度。 */
export function removeBankLocally(hash: string): void {
  removeLocal(`quiz_app_questions_${hash}`);
  removeLocal(`quiz_app_state_${hash}`);
  clearMtime(`quiz_app_questions_${hash}`);
  clearMtime(`quiz_app_state_${hash}`);
}

/** 「本地就是云端」时的基准线（第一次创建云端之后写一次）。 */
export function baselineMeta(state: CollectedState, remoteUpdatedAt: number): SyncMeta {
  const now = Date.now();
  const rows: Record<string, SyncRowMeta> = {};
  for (const bank of state.banks.values()) {
    rows[bankRowKey(bank.hash)] = {
      // `remoteHash` = 完整哈希（有没有没推上去的东西），`contentHash` = 只含题目
      remoteHash: bankFullHash(bank.snapshot),
      contentHash: bank.contentHash,
      syncedAt: now,
      remoteUpdatedAt,
      shard: bank.shard,
      mode: bank.snapshot.mode,
      snapshot: bank.snapshot,
    };
  }
  return {
    lastSyncedAt: now,
    bootstrapped: true,
    rows,
    generalBaseline: state.general,
    // 刚建出来的云端不可能有冲突记录，但整份重写时也得给全（旧记录用不上）
    conflicts: {},
  };
}

/**
 * 同步成功之后更新基准线。
 *
 * 只给「这次真的对齐了的」题库写新基准：冲突中的题库保持旧基准，
 * 否则下一次同步会误判成「云端改过」而把本地改动悄悄拉掉。
 * 已经删掉的题库连同它的行一起清掉。
 */
export function nextMeta(params: {
  previous: SyncMeta;
  state: CollectedState;
  plan: SyncPlan;
  remoteUpdatedAt: number;
  now: number;
}): SyncMeta {
  const { previous, state, plan, remoteUpdatedAt, now } = params;
  const rows: Record<string, SyncRowMeta> = { ...previous.rows };

  for (const action of plan.actions) {
    const key = bankRowKey(action.hash);
    const bank = state.banks.get(action.hash);
    switch (action.verdict) {
      case "pull":
      case "push":
        if (!settledThisRound(plan, action)) break; // 分片被冲突冻住了，保持旧基准
        if (bank === undefined) {
          delete rows[key];
          break;
        }
        rows[key] = {
          remoteHash: bankFullHash(bank.snapshot),
          contentHash: bank.contentHash,
          syncedAt: now,
          remoteUpdatedAt,
          shard: bank.shard,
          mode: bank.snapshot.mode,
          // 合并过的那一份，云端与本地都已经是它了（第 ③ 步从本地重建上传），
          // 所以基准记的就是 `bank.snapshot`——下一轮它就是三方合并的参照
          snapshot: bank.snapshot,
        };
        break;

      case "skip":
        // 两边内容一样，基准线怎么写都不会错
        // （`snapshot` 每次同步都刷新：旧版记账里没有它）
        if (bank !== undefined) {
          rows[key] = {
            remoteHash: bankFullHash(bank.snapshot),
            contentHash: bank.contentHash,
            syncedAt: now,
            remoteUpdatedAt,
            shard: bank.shard,
            mode: bank.snapshot.mode,
            snapshot: bank.snapshot,
          };
        }
        break;
      case "deleteLocal":
      case "deleteRemote":
        if (!settledThisRound(plan, action)) break;
        delete rows[key];
        break;
      case "conflict":
        // 保持旧基准，等用户裁决
        break;
    }
  }

  // 旧版记账里没有 `snapshot` 的行：这一轮没被上面几个分支更新到的，借着
  // 本地现成的那份补上——下一轮合并进度时才有三方参照可用。
  for (const [key, row] of Object.entries(rows)) {
    const hash = bankHashFromRowKey(key);
    if (hash === null) continue;
    const local = state.banks.get(hash);
    if (local === undefined) continue;
    if (row.snapshot === undefined) row.snapshot = local.snapshot;
    row.mode ??= local.snapshot.mode;
  }

  // 本地已经不存在的题库（以及老格式遗留的分片行）不再留着
  for (const key of Object.keys(rows)) {
    if (key === GIST_GENERAL_FILE) {
      delete rows[key];
      continue;
    }
    if (!key.startsWith("bank:")) {
      // 老格式（banks-N.json）的行：新格式写完之后就没用了
      delete rows[key];
      continue;
    }
    const hash = key.slice("bank:".length);
    if (!state.banks.has(hash) && !plan.conflicts.some((c) => c.hash === hash)) {
      delete rows[key];
    }
  }

  const next: SyncMeta = {
    lastSyncedAt: now,
    bootstrapped: true,
    rows,
    generalBaseline: state.general,
    // 「第一次看到冲突」的记录原样带过去，再按**新的**基准线过一遍：这一轮
    // 裁决掉的冲突，基准线就比记录新了，那条记录当场作废（接着写回盘上）。
    // 不能整个丢掉：冲突还在的那些题库，下一轮对账得拿到原来那个时间。
    conflicts: previous.conflicts,
  };
  next.conflicts = pruneConflictSeen(next);
  return next;
}
