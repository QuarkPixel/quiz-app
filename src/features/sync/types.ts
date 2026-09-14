/**
 * 云同步的常量与类型。
 *
 * ── 架构 ────────────────────────────────────────────────────────────────────
 *
 *   浏览器 ──► 你的 Vercel 域名 /api/sync ──► Supabase ──► PostgreSQL
 *              （同源；它只是哑管道，不持有密钥）
 *
 * Supabase 的地址与密钥由浏览器在每次请求里带上：
 * 地址走 `?url=`，密钥走 `apikey` 头。所以换项目、换 key 都不用重新部署，
 * 后端也不需要任何环境变量。
 *
 * 同步的单位是 localStorage 的键，一行一个：
 *
 *   quiz_app_general               应用配置（题库列表 / 顺序 / 激活题库 / 全局设置）
 *   quiz_app_questions_<hash>      某个题库的题目数组
 *   quiz_app_state_<hash>          某个题库的进度 + 按库设置 + UI 偏好
 *
 * **不上传**的只有同步自己的几个键（`quiz_app_sync_*`）：里面装着连接凭据
 * （传上去会出现「拉下来把自己连到错地方」）与本地同步元数据。
 */

/**
 * 同步配置：两样连接信息。
 *
 * 它们存在 `quiz_app_sync_config` 里、**不上传**——否则换设备时会
 * 「拉下来把自己连到错地方」。
 */
export interface SyncConfig {
  /** Supabase 项目地址，形如 `https://xxxxxxxx.supabase.co` */
  supabaseUrl: string;
  /** Supabase 密钥（publishable 或 secret 都行，取决于你自己的取舍） */
  supabaseKey: string;
  /** 是否在改动后自动上传 / 定时拉取 */
  autoSync: boolean;
}

/**
 * 解析出来的同步目标：连接信息 + 后端地址。
 * 由 `relay.ts` 在内存里合成，不落盘。
 */
export interface SyncTarget extends SyncConfig {
  /** 后端基地址（同源时就是 `/api/sync`） */
  relayUrl: string;
}

/** 一行同步元数据：记录「上次同步时，这一行两边各是什么时间」。 */
export interface SyncRowMeta {
  /** 上次同步成功时服务器侧的 `updated_at`（毫秒）；从来没有过就是 0 */
  remoteUpdatedAt: number;
  /** 上次成功同步的时间（本机时钟，毫秒）——冲突检测的基准线 */
  syncedAt: number;
}

/** 本地同步元数据。存在 `quiz_app_sync_meta`，不上传。 */
export interface SyncMeta {
  /** 最近一次成功同步的时间（毫秒）；从没同步过就是 0 */
  lastSyncedAt: number;
  /** 是否已经做过首次同步（决定开局是「上传本地」还是「拉取云端」） */
  bootstrapped: boolean;
  /** 按 localStorage 键名索引的逐行元数据 */
  rows: Record<string, SyncRowMeta>;
}

/** 远端一行（只取元信息，不含 data）。 */
export interface RemoteRowMeta {
  id: string;
  updatedAt: number;
}

/** 上传 / 下载的结果：同步成功写了几行。 */
export interface SyncTransferResult {
  pushed: number;
  pulled: number;
}

/** 解决冲突时偏向哪一边。 */
export type ConflictResolution = "keepLocal" | "keepRemote";

/** 一条冲突：本地和远端都改过同一行。 */
export interface SyncConflict {
  id: string;
  localAt: number;
  remoteAt: number;
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
  /** 云端共几行 */
  remoteCount: number;
  conflicts: SyncConflict[];
}

/** 默认同步配置：全新安装时两样连接信息都是空的，只有自动同步开着。 */
export const EMPTY_SYNC_CONFIG: SyncConfig = {
  supabaseUrl: "",
  supabaseKey: "",
  autoSync: true,
};

/** 同步相关存储键。前缀 `quiz_app_sync_` 一律不进云端。 */
export const STORAGE_KEY_SYNC_CONFIG = "quiz_app_sync_config";
export const STORAGE_KEY_SYNC_META = "quiz_app_sync_meta";
export const SYNC_STORAGE_PREFIX = "quiz_app_sync_";

/** Supabase 侧承载同步快照的表名（迁移文件里也用的是它）。 */
export const SYNC_TABLE = "quiz_app_sync";

/** 同源 API 路径。生产环境下浏览器只访问这个路径。 */
export const SYNC_API_PATH = "/api/sync";

/** 本地改动后，等这么久没有新改动就自动上传（毫秒）。 */
export const SYNC_PUSH_DEBOUNCE_MS = 2000;

/** 空闲时轮询云端的间隔（毫秒）。 */
export const SYNC_POLL_INTERVAL_MS = 3 * 60 * 1000;

/** 窗口重新获得焦点时，两次检查之间至少间隔这么久（毫秒）。 */
export const SYNC_FOCUS_THROTTLE_MS = 30 * 1000;

/** 云端返回一行都没有时的元数据默认值（时间戳 0 = 从未同步）。 */
export function emptySyncMeta(): SyncMeta {
  return { lastSyncedAt: 0, bootstrapped: false, rows: {} };
}
