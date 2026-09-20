/**
 * 同步的存储层：感知本地改动、记录每份文件的同步元数据。
 *
 * 这里有一个刻意的设计：**用包装 `localStorage.setItem / removeItem` 的方式来感知
 * 本地改动**，而不是在 `saveState` 等出口逐个埋点。理由是本地写入的出口很分散
 * （进度、设置、题库导入 / 删除 / 重命名、题库列表顺序……），逐个改既容易漏，
 * 也会把同步逻辑渗进做题流。包装一层以后，任何写入都会自动进同步队列。
 *
 * 包装是幂等的；`writeLocal` / `removeLocal` 走原始方法，不会触发通知——
 * 否则「拉取云端」会立刻被自己判定成本地改动，来回弹。
 */

import {
  STORAGE_KEY_GENERAL,
  STORAGE_KEY_SYNC_META,
  STORAGE_PREFIX_QUESTIONS,
  STORAGE_PREFIX_STATE,
  SYNC_STORAGE_PREFIX,
} from "@/config";
import {
  emptySyncMeta,
  normalizeGeneralOrNull,
  type SyncMeta,
  type SyncRowMeta,
} from "./types";

/** `quiz_app_sync_mtime:<键>` 前缀：记录某个可同步键最后一次本地改动的时间。 */
const MTIME_PREFIX = "quiz_app_sync_mtime:";

/** 一个可以被同步的键：应用配置、题库内容、题库进度。 */
export function isSyncableKey(key: string): boolean {
  // 同步自己的键（配置里装着令牌、元数据是本地状态）永远不进云端
  if (key.startsWith(SYNC_STORAGE_PREFIX)) return false;

  if (key === STORAGE_KEY_GENERAL) return true;
  if (key.startsWith(STORAGE_PREFIX_QUESTIONS)) return true;
  if (key.startsWith(STORAGE_PREFIX_STATE)) return true;

  return false;
}

// ── localStorage 包装 ────────────────────────────────────────────────────────

interface StorageHookState {
  originalSetItem: typeof localStorage.setItem;
  originalRemoveItem: typeof localStorage.removeItem;
  listeners: Set<(key: string) => void>;
}

let hookState: StorageHookState | null = null;

/** 监听本地可同步键的变化。返回取消订阅函数。 */
export function onLocalChange(listener: (key: string) => void): () => void {
  if (!hookState) return () => {};
  hookState.listeners.add(listener);
  return () => hookState?.listeners.delete(listener);
}

/** 装一次 localStorage 钩子；重复调用是空操作。 */
export function installStorageHook(): void {
  if (hookState) return;
  if (typeof localStorage === "undefined") return;

  const originalSetItem = localStorage.setItem.bind(localStorage);
  const originalRemoveItem = localStorage.removeItem.bind(localStorage);
  const state: StorageHookState = {
    originalSetItem,
    originalRemoveItem,
    listeners: new Set(),
  };
  hookState = state;

  localStorage.setItem = (key: string, value: string) => {
    originalSetItem(key, value);
    if (!isSyncableKey(key)) return;
    touchMtime(state, key);
    notify(state, key);
  };

  localStorage.removeItem = (key: string) => {
    originalRemoveItem(key);
    if (!isSyncableKey(key)) return;
    touchMtime(state, key);
    notify(state, key);
  };
}

/** 走原始方法写入（供「拉取云端」使用），不触发本地改动通知。 */
export function writeLocal(key: string, value: string): void {
  installStorageHook();
  const write = hookState?.originalSetItem ?? localStorage.setItem.bind(localStorage);
  write(key, value);
}

/** 走原始方法删除（供「清理本地已消失的行」使用），不触发本地改动通知。 */
export function removeLocal(key: string): void {
  installStorageHook();
  const remove =
    hookState?.originalRemoveItem ?? localStorage.removeItem.bind(localStorage);
  remove(key);
}

/**
 * 本地存储这条路通不通。
 *
 *   - `ok`      写入会通知（正常）
 *   - `blocked` 写不进去（隐私模式 / 系统拦截）——连进度都存不下来
 *   - `silent`  写得进去，但钩子不通知（iOS 上踩过：覆盖 `setItem` 没生效）
 */
export type StorageHealth = "ok" | "blocked" | "silent";

/** 探针用的键：形状像可同步键（这样钩子会通知），写完立刻删掉。 */
const PROBE_KEY = `${STORAGE_PREFIX_STATE}__probe__`;

/**
 * 试一下「写入 → 钩子通知」这条路还通不通。
 *
 * 为什么需要这个：页头那颗同步指示点靠 `onLocalChange` 才知道「本地改了东西」。
 * iOS 上见过两种失灵——覆盖 `localStorage.setItem` 没生效（写得进去但没人通知，
 * 指示点永远不变黄），或者 `setItem` 直接被系统拦掉（那连进度都存不下来，
 * 属于必须让用户知道的事）。两种情况都不能假装正常。
 *
 * **要在引擎注册自己的监听之前调用**，不然探针会顺带把 pendingChanges 标脏。
 */
export function probeStorageHealth(): StorageHealth {
  installStorageHook();
  if (!hookState) return "blocked";

  let notified = false;
  const listener = () => {
    notified = true;
  };
  hookState.listeners.add(listener);

  try {
    try {
      localStorage.setItem(PROBE_KEY, "1");
    } catch {
      return "blocked";
    }
    if (!notified) return "silent";

    notified = false;
    try {
      localStorage.removeItem(PROBE_KEY);
    } catch {
      return "blocked";
    }
    return notified ? "ok" : "silent";
  } finally {
    hookState.listeners.delete(listener);
    clearMtime(PROBE_KEY);
  }
}

/** 读一个键的原始字符串；读不到返回 null。 */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function notify(state: StorageHookState, key: string): void {
  for (const listener of [...state.listeners]) {
    try {
      listener(key);
    } catch (e) {
      console.warn("Sync change listener failed:", e);
    }
  }
}

// ── 本地修改时间（mtime）────────────────────────────────────────────────────

/**
 * 记录一次本地改动的时间。
 *
 * 单独存一份 mtime 而不是复用 `SyncRowMeta.syncedAt`：两者语义不同——
 * `syncedAt` 是「上次同步成功」，mtime 是「本地内容最后一次变」。判定
 * 「本地改过没有」要用后者，否则「同步完又改了」会被误判成没改。
 */
function touchMtime(state: StorageHookState | null, key: string): void {
  const write = state?.originalSetItem ?? localStorage.setItem.bind(localStorage);
  try {
    write(MTIME_PREFIX + key, String(Date.now()));
  } catch {
    /* 存不下就算了，最坏情况是这一行漏同步一次 */
  }
}

/** 读某个键最后一次本地改动的时间；没有记录返回 0。 */
export function mtimeOf(key: string): number {
  const raw = readLocal(MTIME_PREFIX + key);
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** 清掉某个键的 mtime 记录。 */
export function clearMtime(key: string): void {
  removeLocal(MTIME_PREFIX + key);
}

/** 清理已经不存在于本地的键所留下的 mtime，避免无限增长。 */
export function pruneStaleMtimes(): void {
  const present = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && isSyncableKey(key)) present.add(key);
    }
  } catch {
    return;
  }

  const stale: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null || !key.startsWith(MTIME_PREFIX)) continue;
      if (!present.has(key.slice(MTIME_PREFIX.length))) stale.push(key);
    }
  } catch {
    return;
  }
  for (const key of stale) removeLocal(key);
}

// ── 同步元数据 ───────────────────────────────────────────────────────────────

function normalizeRowMeta(value: unknown): SyncRowMeta | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as {
    remoteHash?: unknown;
    remoteUpdatedAt?: unknown;
    syncedAt?: unknown;
    shard?: unknown;
  };
  const numberOrZero = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

  // 没有 remoteHash 的旧记录作废：那套是按「服务端每行一个 updated_at」记的，
  // 换到 Gitee 之后无法对应，强行沿用会把每一行都判成「云端改过」。
  if (typeof raw.remoteHash !== "string" || raw.remoteHash.length === 0) {
    return null;
  }

  return {
    remoteHash: raw.remoteHash,
    syncedAt: numberOrZero(raw.syncedAt),
    remoteUpdatedAt: numberOrZero(raw.remoteUpdatedAt),
    ...(typeof raw.shard === "number" && Number.isInteger(raw.shard)
      ? { shard: raw.shard }
      : {}),
  };
}

/** 读「第一次看到冲突」的记录：题库行键 → 时间戳（毫秒）。 */
function normalizeConflicts(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<string, number> = {};
  for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
    if (typeof at === "number" && Number.isFinite(at) && at > 0) result[key] = at;
  }
  return result;
}

/** 读取同步元数据。 */
export function loadSyncMeta(): SyncMeta {
  const raw = readLocal(STORAGE_KEY_SYNC_META);
  if (raw === null) return emptySyncMeta();

  try {
    const parsed = JSON.parse(raw) as {
      lastSyncedAt?: unknown;
      bootstrapped?: unknown;
      rows?: unknown;
      generalBaseline?: unknown;
      conflicts?: unknown;
    };
    const rows: Record<string, SyncRowMeta> = {};
    if (
      parsed.rows !== null &&
      typeof parsed.rows === "object" &&
      !Array.isArray(parsed.rows)
    ) {
      for (const [name, value] of Object.entries(parsed.rows)) {
        const meta = normalizeRowMeta(value);
        if (meta) rows[name] = meta;
      }
    }
    return {
      lastSyncedAt:
        typeof parsed.lastSyncedAt === "number" &&
        Number.isFinite(parsed.lastSyncedAt)
          ? parsed.lastSyncedAt
          : 0,
      bootstrapped: parsed.bootstrapped === true,
      rows,
      generalBaseline: normalizeGeneralOrNull(parsed.generalBaseline),
      conflicts: normalizeConflicts(parsed.conflicts),
    };
  } catch (e) {
    console.warn("Failed to parse sync meta:", e);
    return emptySyncMeta();
  }
}

/** 写入同步元数据。 */
export function saveSyncMeta(meta: SyncMeta): void {
  try {
    writeLocal(STORAGE_KEY_SYNC_META, JSON.stringify(meta));
  } catch (e) {
    console.warn("Failed to save sync meta:", e);
  }
}

/**
 * 写一个本地键（供「拉取云端」使用），**不碰 mtime**。
 *
 * 「mtime = 本地最后一次改动」是判断要不要上传的基准：把拉下来的内容也记成
 * 本地改动，下一次同步就会把刚拉下来的东西当成「本地改过」，轻则白传一遍、
 * 重则和云端撞成冲突（两边都"改过"同一份）。所以拉取只写内容。
 *
 * 这里也**不碰同步元数据**：一次同步会拉好几个文件，逐次读改写元数据既慢
 * 又容易互相覆盖，元数据统一由引擎在同步结束时整份写一次。
 */
export function applyRemoteValue(key: string, value: string): void {
  writeLocal(key, value);
}

/** 测试用：清掉所有同步元数据与 mtime 记录。 */
export function clearSyncMeta(): void {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith(MTIME_PREFIX)) keys.push(key);
    }
  } catch {
    /* ignore */
  }
  for (const key of keys) removeLocal(key);
  removeLocal("quiz_app_sync_meta");
}
