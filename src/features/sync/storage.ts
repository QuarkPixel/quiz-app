/**
 * 同步的存储层：收集本地快照、读写同步元数据、包装 localStorage 变更通知。
 *
 * 这里有一个刻意的设计：**用包装 `localStorage.setItem / removeItem` 的方式来感知
 * 本地改动**，而不是在 `saveState` 等出口逐个埋点。理由是本地写入的出口很分散
 * （进度、设置、题库导入 / 删除 / 重命名、题库列表顺序……），逐个改既容易漏，
 * 也会把同步逻辑渗进做题流。包装一层以后，任何写入都会自动进同步队列。
 *
 * 包装是幂等的；`writeLocal` 写的所有内容都走原始方法，不会触发通知——
 * 否则「拉取云端」会立刻被自己判定成本地改动，来回弹。
 */

import {
  STORAGE_KEY_GENERAL,
  STORAGE_PREFIX_QUESTIONS,
  STORAGE_PREFIX_STATE,
} from "@/config";
import {
  SYNC_STORAGE_PREFIX,
  emptySyncMeta,
  type SyncMeta,
  type SyncRowMeta,
} from "./types";

/** 一行本地快照。`value` 是 localStorage 里的原始字符串。 */
export interface LocalEntry {
  id: string;
  value: string;
  /** 这一行的本地修改时间（毫秒），来自同步元数据；没有记录就是 0 */
  localAt: number;
}

/** 一个可以被同步的键：应用配置、题库内容、题库进度。 */
export function isSyncableKey(key: string): boolean {
  // 同步自己的键（配置里装着 key、元数据是本地状态）永远不进云端
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
    touchMtime(key);
    notify(state, key);
  };

  localStorage.removeItem = (key: string) => {
    originalRemoveItem(key);
    if (!isSyncableKey(key)) return;
    touchMtime(key);
    notify(state, key);
  };
}

/** 走原始方法写入（供「拉取云端」使用），不触发本地改动通知。 */
export function writeLocal(key: string, value: string): void {
  installStorageHook();
  const write =
    hookState?.originalSetItem ?? localStorage.setItem.bind(localStorage);
  write(key, value);
}

/** 走原始方法删除（供「清理本地已消失的行」使用），不触发本地改动通知。 */
export function removeLocal(key: string): void {
  installStorageHook();
  const remove =
    hookState?.originalRemoveItem ?? localStorage.removeItem.bind(localStorage);
  remove(key);
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

// ── 同步元数据 ───────────────────────────────────────────────────────────────

/** 记录每一行的本地修改时间的存储键：`quiz_app_sync_mtime:<key>`。 */
function mtimeKey(key: string): string {
  return `quiz_app_sync_mtime:${key}`;
}

/**
 * 记录一次本地改动的时间。
 *
 * 单独存一份 mtime 而不是复用 `SyncRowMeta.syncedAt`：两者语义不同——
 * `syncedAt` 是「上次同步成功」，mtime 是「本地内容最后一次变」。判定
 * 「本地改过没有」要用后者，否则「同步完又改了」会被误判成没改。
 */
function touchMtime(key: string): void {
  installStorageHook();
  const write =
    hookState?.originalSetItem ?? localStorage.setItem.bind(localStorage);
  try {
    write(mtimeKey(key), String(Date.now()));
  } catch {
    /* 存不下就算了，最坏情况是这一行漏同步一次 */
  }
}

function readMtime(key: string): number {
  const raw = readLocal(mtimeKey(key));
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * 收集所有要同步的本地行。
 *
 * 「本地修改时间」优先读 mtime；缺失时（例如这一行是被「拉取云端」写下来的）
 * 回落到元数据里的 `syncedAt`——它和遥控侧的时间对齐，不会误判成「本地改过」。
 * 顺手清掉本地已删行的 mtime，避免 `quiz_app_sync_mtime:*` 无限增长。
 */
export function collectLocalEntries(): LocalEntry[] {
  const meta = loadSyncMeta();
  const entries: LocalEntry[] = [];
  const seen = new Set<string>();

  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null || !isSyncableKey(key)) continue;
      const value = localStorage.getItem(key);
      if (value === null) continue;
      seen.add(key);
      const localAt = readMtime(key) || meta.rows[key]?.syncedAt || 0;
      entries.push({ id: key, value, localAt });
    }
  } catch (e) {
    console.warn("Failed to enumerate localStorage:", e);
  }

  // 清掉已经消失的行的 mtime
  const staleMtimes: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key === null) continue;
      if (!key.startsWith("quiz_app_sync_mtime:")) continue;
      const target = key.slice("quiz_app_sync_mtime:".length);
      if (!seen.has(target)) staleMtimes.push(key);
    }
  } catch {
    /* ignore */
  }
  for (const key of staleMtimes) removeLocal(key);

  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return entries;
}

/** 现在这一轮，本地每一行的修改时间。用于判断「还有没有没推上去的改动」。 */
export function collectLocalTimestamps(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const entry of collectLocalEntries()) {
    result[entry.id] = entry.localAt;
  }
  return result;
}

function normalizeRowMeta(value: unknown): SyncRowMeta | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as { remoteUpdatedAt?: unknown; syncedAt?: unknown };
  const remoteUpdatedAt =
    typeof raw.remoteUpdatedAt === "number" &&
    Number.isFinite(raw.remoteUpdatedAt)
      ? raw.remoteUpdatedAt
      : 0;
  const syncedAt =
    typeof raw.syncedAt === "number" && Number.isFinite(raw.syncedAt)
      ? raw.syncedAt
      : 0;
  return { remoteUpdatedAt, syncedAt };
}

/** 读取同步元数据。 */
export function loadSyncMeta(): SyncMeta {
  const raw = readLocal("quiz_app_sync_meta");
  if (raw === null) return emptySyncMeta();

  try {
    const parsed = JSON.parse(raw) as {
      lastSyncedAt?: unknown;
      bootstrapped?: unknown;
      rows?: unknown;
    };
    const rows: Record<string, SyncRowMeta> = {};
    if (
      parsed.rows !== null &&
      typeof parsed.rows === "object" &&
      !Array.isArray(parsed.rows)
    ) {
      for (const [key, value] of Object.entries(parsed.rows)) {
        const meta = normalizeRowMeta(value);
        if (meta && isSyncableKey(key)) rows[key] = meta;
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
    };
  } catch (e) {
    console.warn("Failed to parse sync meta:", e);
    return emptySyncMeta();
  }
}

/** 写入同步元数据。 */
export function saveSyncMeta(meta: SyncMeta): void {
  try {
    writeLocal("quiz_app_sync_meta", JSON.stringify(meta));
  } catch (e) {
    console.warn("Failed to save sync meta:", e);
  }
}

/**
 * 写一行本地数据（走原始方法，不触发本地改动通知），并刷新它的修改时间。
 * 供「拉取云端」使用。
 *
 * 这里**不碰同步元数据**：一次同步会拉很多行，逐行读改写元数据既慢又容易互相覆盖，
 * 元数据统一由引擎在同步结束时整份写一次。
 */
export function applyRemoteRow(id: string, payload: string): void {
  writeLocal(id, payload);
  touchMtime(id);
}

/**
 * 同步元数据整份读-改-写。
 *
 * 引擎一次同步只写一次盘（`loadSyncMeta` → 改 → `saveSyncMeta`），
 * 所以这里不提供「按行写」的接口——那会让一次同步写十几次 localStorage。
 */

/** 测试用：清掉所有同步元数据与 mtime 记录。 */
export function clearSyncMeta(): void {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null && key.startsWith("quiz_app_sync_mtime:"))
        keys.push(key);
    }
  } catch {
    /* ignore */
  }
  for (const key of keys) removeLocal(key);
  removeLocal("quiz_app_sync_meta");
}
