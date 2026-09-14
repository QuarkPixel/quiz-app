/**
 * 云同步的常量与类型 —— Gitee Gist 版。
 *
 * ── 架构 ────────────────────────────────────────────────────────────────────
 *
 *   浏览器 ──► gitee.com/api/v5/gists
 *       └── Authorization: Bearer <私人令牌>
 *
 * **不需要任何服务器**：Gitee 的 CORS 放行任意源（`access-control-allow-origin: *`）
 * 且预检允许 `authorization` 头，所以浏览器可以直接读写 Gist。令牌走请求头，
 * 不进 URL、不经过第三方。
 *
 * ── 数据怎么组织（分片打包）────────────────────────────────────────────────
 *
 * **Gitee 一条 Gist 最多 10 个文件**（实测：10 个成功、11 个报
 * 「文件不能超过 10 个」）。所以「每个题库一个文件」在超过 9 个题库时就崩了。
 *
 * 现在的布局是 1 + `SHARD_COUNT` 个文件，永不超限：
 *
 *   _general.json         题库列表 + 顺序 + 激活题库 + 全局设置
 *   banks-0.json          { banks: { <hash>: {mode, name, questions, state} } }
 *   …
 *   banks-8.json          同上
 *
 * ── 同步单元是「题库」，不是「文件」────────────────────────────────────────
 *
 * 这一点是整个同步的正确性根基：分片文件只是**容器**，合并 / 冲突 / 删除
 * 全部按题库逐条判定（比内容哈希），同片的题库不会互相牵连。
 *
 * 题库落在哪一片是 `shardIndexOf(hash)` 算出来的**纯函数**，两台设备各算各的、
 * 结果必然一致，所以不需要在云端存一张「哪个题库在哪片」的映射表——
 * 那种表是派生数据，一旦和真实分片漂移就是新的 bug 来源。
 *
 * 每个文件的内容是压缩过的：`deflateRaw` + base64url，外面包一层版本号。
 */

/** 存放全局配置的文件名。 */
export const GIST_GENERAL_FILE = "_general.json";

/**
 * 题库分片的数量。
 *
 * 取 9 是因为「1 个 `_general.json` + 9 个分片 = 10 个文件」正好卡在
 * Gitee 的上限（实测 11 个就报错）。改这个数会让已同步的云端判定成
 * 「文件全变了」——不是不能改，但要知道代价。
 */
export const SHARD_COUNT = 9;

/** 分片文件名，如 `banks-0.json`。 */
export function shardFileName(index: number): string {
  return `banks-${index}.json`;
}

/** 文件名 → 分片下标；不是分片文件时返回 null。 */
export function shardIndexFromFileName(name: string): number | null {
  const match = /^banks-(\d+)\.json$/.exec(name);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isInteger(index) && index >= 0 && index < SHARD_COUNT ? index : null;
}

/**
 * 这个文件名是不是**早期按题库分文件**的格式（`<hash>.json`）？
 *
 * 那一版已经废弃（一条 Gist 装不下 10 个以上的题库），但云端可能还留着，
 * 所以在对账时要认出来并回收掉，免得永远当垃圾文件躺着。
 */
export function isLegacyBankFileName(name: string): boolean {
  const match = /^([0-9a-f]{16})\.json$/.exec(name);
  return match !== null;
}

/**
 * 题库 hash → 它落在哪个分片。
 *
 * 用字符串自带的稳定哈希（djb2 变体）：只需要「同一题库永远落同一片」，
 * 不要求密码学强度。`% SHARD_COUNT` 保证落在合法范围内。
 */
export function shardIndexOf(hash: string): number {
  let h = 5381;
  for (let i = 0; i < hash.length; i += 1) {
    h = ((h << 5) + h + hash.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % SHARD_COUNT;
}

/** 每个同步文件的内容格式版本。改结构时 +1，解码端保留旧分支。 */
export const SYNC_PAYLOAD_VERSION = 1;

/** 压缩后的文件内容。`d` = deflateRaw + base64url。 */
export interface SyncFilePayload {
  v: number;
  d: string;
}

/** `_general.json` 的内容。 */
export interface GeneralSnapshot {
  activeBank: string | null;
  defaultSettings: unknown;
  library: LibraryEntry[];
  globalSettings: unknown;
}

/** 题库列表里的一条。`hash` 是必有的，其余字段随版本演进。 */
export interface LibraryEntry {
  hash: string;
  name?: string;
  mode?: string;
  count?: number;
  addedAt?: number;
  [key: string]: unknown;
}

/** 单个题库的内容（存在分片文件里）。 */
export interface BankSnapshot {
  mode: "quiz" | "memory";
  name: string;
  questions: unknown[];
  /** 该题库的 StoredState；没导入过进度时为 undefined */
  state?: unknown;
}

/** 一个分片文件的内容：按题库 hash 索引的一批题库。 */
export interface ShardSnapshot {
  banks: Record<string, BankSnapshot>;
}

/** Gitee API 基地址（官方 OpenAPI v5 的 server）。 */
export const GITEE_API_BASE = "https://gitee.com/api/v5";

/** Gist 描述。Gitee 限制 1~30 字符。 */
export const GIST_DESCRIPTION = "quiz-app sync";

/**
 * 这条代码片段看起来是不是本应用建的？
 *
 * 两个判据**都要**满足：描述是我们写死的那句，**并且**含 `_general.json`。
 * 只看描述会误判（用户可能手改过描述）；只看文件名也会误判（别人也可能用这个名字）。
 */
export function looksLikeSyncGist(gist: {
  description: string;
  fileNames: readonly string[];
}): boolean {
  return (
    gist.description === GIST_DESCRIPTION &&
    gist.fileNames.includes(GIST_GENERAL_FILE)
  );
}

/**
 * 同步配置。
 *
 * 两项都存在 `quiz_app_sync_config` 里、**不上传**。
 * `gistId` 在第一次同步时自动创建并回填，用户不需要填。
 */
export interface SyncConfig {
  /**
   * 云同步总开关。
   *
   * 关掉它只是「不显示、不自动跑」，**不会**清掉令牌——所以再打开时不用重填。
   * 真要清空用设置面板里的「清空配置」。
   */
  enabled: boolean;
  /** Gitee 私人令牌（勾 `gists` 权限即可） */
  token: string;
  /** 同步用的 Gist ID；首次同步后自动写入 */
  gistId: string;
  /**
   * 那条 Gist 的网页地址（由 Gitee 的 `html_url` 原样存下来）。
   * 自己拼用户名容易拼错，直接用它给的。
   */
  gistUrl: string;
  /** 是否在改动后自动上传 / 定时拉取 */
  autoSync: boolean;
}

/**
 * 解析出来的同步目标。
 * 由 `target.ts` 合成，不落盘。
 */
export interface SyncTarget extends SyncConfig {
  /** Gitee API 基地址（留出覆盖余地，测试时指向本地 mock） */
  apiBase: string;
}

/**
 * 一行同步元数据：记录「上次同步时，这一行两边各是什么状态」。
 *
 * 行的粒度是**题库**（键 = `bank:<hash>`），另有一行是 `_general.json`。
 * 早期那版是按文件记的（`banks-3.json`），解码时仍然留着当兜底基准——
 * 升级上来的设备在第一次同步时还能据此判断方向。
 *
 * 冲突检测需要两个独立的信号：
 *   - 本地有没有改过 → 比 `syncedAt` 和这一行的本地修改时间（mtime）
 *   - 云端有没有改过 → 比 `remoteHash` 和这次读回来的**内容哈希**
 *
 * 用**内容哈希**而不是时间戳判断云端改动，是因为 Gitee 的 `updated_at` 只在
 * Gist 级别、不区分文件：整体时间变了但某个文件其实没变，逐文件比对哈希才不会误报。
 */
export interface SyncRowMeta {
  /** 上次同步成功时，该行内容的哈希（`stableHash`） */
  remoteHash: string;
  /** 上次成功同步的时间（本机时钟，毫秒）——判断「本地改过没有」的基准线 */
  syncedAt: number;
  /** 上次同步时 Gist 的 `updated_at`（毫秒），仅用于展示 */
  remoteUpdatedAt: number;
  /** 题库行专用：它当时落在哪个分片（排查用） */
  shard?: number;
}

/** 题库行的键：`bank:<hash>`。 */
export function bankRowKey(hash: string): string {
  return `bank:${hash}`;
}

/** `bank:<hash>` → hash；不是题库行时返回 null。 */
export function bankHashFromRowKey(key: string): string | null {
  return key.startsWith("bank:") ? key.slice("bank:".length) : null;
}

/**
 * 本地同步元数据。存在 `quiz_app_sync_meta`，不上传。
 */
export interface SyncMeta {
  /** 最近一次成功同步的时间（毫秒）；从没同步过就是 0 */
  lastSyncedAt: number;
  /** 是否至少成功同步过一次（仅用于文案 / 排查） */
  bootstrapped: boolean;
  /** 逐题库（+ `_general.json`）的元数据 */
  rows: Record<string, SyncRowMeta>;
  /**
   * 上次同步成功时 `_general.json` 的内容。
   *
   * 存整份而不是只存哈希，是因为 general 要做**逐字段**三方合并
   * （题库列表按条目、全局设置按字段）：只有拿到基准值才知道哪一边真的改过。
   * 它不大（题库索引而已），而且不上传。
   */
  generalBaseline: GeneralSnapshot | null;
}

/** 远端一个文件：文件名 + 内容哈希 + 解出来的 JSON。 */
export interface RemoteFile {
  /** 文件名，如 `_general.json` / `banks-3.json` */
  name: string;
  /** 内容的哈希（对解出来的内容取 `stableHash`；解不出来时退化成 sha1） */
  hash: string;
  /** 解压后的 JSON 文本；解析失败时为 null */
  json: string | null;
}

/** 上传 / 下载的结果。 */
export interface SyncTransferResult {
  pushed: number;
  pulled: number;
}

/** 解决冲突时偏向哪一边。 */
export type ConflictResolution = "keepLocal" | "keepRemote";

/** 一条冲突：同一个题库两边都改过。 */
export interface SyncConflict {
  /** 题库 hash */
  hash: string;
  /** 给人看的题库名 */
  name: string;
  /** 更细的说明（哪一边改了什么） */
  detail: string;
  /** 本地这份最后一次改动的时间（毫秒） */
  localAt: number;
  /** 云端这份的内容哈希（不是时间戳，仅用于排查） */
  remoteHash: string;
}

/** 同步引擎对外暴露的状态。 */
export interface SyncStatus {
  phase:
    | "disabled"
    | "idle"
    | "checking"
    | "syncing"
    | "offline"
    | "error"
    | "conflict";
  /** 最近一次操作的结果说明（成功 / 失败） */
  message: string;
  /** 最近一次操作完成的时间（毫秒） */
  at: number;
  /** 云端共几个文件 */
  remoteCount: number;
  /** 云端共几个题库（上次同步时读到的数量） */
  remoteBanks: number;
  conflicts: SyncConflict[];
}

/** 默认同步配置：全新安装时没有令牌，只有自动同步开着。 */
export const EMPTY_SYNC_CONFIG: SyncConfig = {
  enabled: false,
  token: "",
  gistId: "",
  gistUrl: "",
  autoSync: true,
};

/** 同步相关存储键。前缀 `quiz_app_sync_` 一律不进云端。 */
export const STORAGE_KEY_SYNC_CONFIG = "quiz_app_sync_config";
export const STORAGE_KEY_SYNC_META = "quiz_app_sync_meta";
export const SYNC_STORAGE_PREFIX = "quiz_app_sync_";

/**
 * 本地改动后，等这么久没有新改动就自动上传（毫秒）。
 *
 * 是**防抖**不是节流：连续答题时定时器会一直被推后，所以真正兜底的是
 * `SYNC_POLL_INTERVAL_MS`（3 分钟）与切回页面时那次检查。
 * 20 秒是刻意的：做题时每次保存进度都写 localStorage，2 秒一传太吵。
 */
export const SYNC_PUSH_DEBOUNCE_MS = 20_000;

/** 空闲时轮询云端的间隔（毫秒）。 */
export const SYNC_POLL_INTERVAL_MS = 3 * 60 * 1000;

/**
 * `localStorage` 钩子不生效时的兜底检查间隔（毫秒）。
 *
 * 正常情况下用不着：写入会直接通知引擎「本地脏了」。这条只在探针发现
 * 「写得进去但钩子不通知」时启用（iOS 上踩过），代价是定期比一遍内容哈希。
 */
export const SYNC_LOCAL_POLL_MS = 5000;

/** 窗口重新获得焦点时，两次检查之间至少间隔这么久（毫秒）。 */
export const SYNC_FOCUS_THROTTLE_MS = 30 * 1000;

/** 云端一个文件都没有时的元数据默认值。 */
export function emptySyncMeta(): SyncMeta {
  return { lastSyncedAt: 0, bootstrapped: false, rows: {}, generalBaseline: null };
}

/**
 * 把任意来源的 general 值净化为 `GeneralSnapshot`。
 *
 * 放在 types.ts 而不是 collect.ts，是为了让 storage.ts 也能用而不产生循环依赖：
 * 收集远端 / 本地 / 元数据基准时都要把 general 归一成同一个形状。
 */
export function normalizeGeneralSnapshot(value: unknown): GeneralSnapshot {
  const record =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  const library: LibraryEntry[] = [];
  if (Array.isArray(record.library)) {
    for (const item of record.library) {
      if (item === null || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry.hash !== "string" || entry.hash.length === 0) continue;
      library.push({ ...entry, hash: entry.hash });
    }
  }

  return {
    activeBank:
      typeof record.activeBank === "string" && record.activeBank.length > 0
        ? record.activeBank
        : null,
    defaultSettings: record.defaultSettings ?? {},
    library,
    globalSettings: record.globalSettings ?? {},
  };
}

/** 同上，但「不是对象」时返回 null（元数据里的基准用 null 表示「没有」）。 */
export function normalizeGeneralOrNull(value: unknown): GeneralSnapshot | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return normalizeGeneralSnapshot(value);
}
