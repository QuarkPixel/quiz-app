/**
 * 同步配置：Supabase 项目地址 + 密钥。
 *
 * 两样都存在 `quiz_app_sync_config` 里，**不上传**——否则换设备时会
 * 「拉下来把自己连到错地方」。
 *
 * 关于密钥类型：用 publishable key 还是 secret key，是你自己的取舍。
 * 前者可以公开，但那样数据就没有任何隔离（谁拿到都能读写）；
 * 后者是万能钥匙，但只该待在你自己的设备上。
 */

import {
  EMPTY_SYNC_CONFIG,
  STORAGE_KEY_SYNC_CONFIG,
  type SyncConfig,
  type SyncTarget,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Supabase 项目地址，形如 https://xxxxxxxx.supabase.co */
const SUPABASE_URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/;

/** 地址是不是合法的 Supabase 项目地址。 */
export function isValidSupabaseUrl(value: string): boolean {
  return SUPABASE_URL_RE.test(value.trim());
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 把任意来源的配置净化为合法的 SyncConfig。
 *
 * 兼容两种旧形状：
 *   - `{ credentials: "https://x.supabase.co sb_secret_y" }`（合并成一行的版本）
 *   - `{ supabaseUrl, supabaseKey, relayUrl }`（再早的版本，凭据本就在两个字段里）
 */
export function sanitizeSyncConfig(value: unknown): SyncConfig {
  const raw = isRecord(value) ? value : {};

  let supabaseUrl = toStringValue(raw.supabaseUrl);
  let supabaseKey = toStringValue(raw.supabaseKey);

  // 旧版把两样塞在一个字段里：拆开
  if (!supabaseUrl || !supabaseKey) {
    const merged = toStringValue(raw.credentials);
    if (merged) {
      const parts = merged.replace(/[\s#|,]+/g, " ").trim().split(" ");
      const urlIndex = parts.findIndex((part) => SUPABASE_URL_RE.test(part));
      if (urlIndex !== -1) {
        supabaseUrl ||= parts[urlIndex];
        supabaseKey ||= parts
          .filter((_, index) => index !== urlIndex)
          .join("")
          .trim();
      }
    }
  }

  return {
    supabaseUrl,
    supabaseKey,
    autoSync:
      typeof raw.autoSync === "boolean"
        ? raw.autoSync
        : EMPTY_SYNC_CONFIG.autoSync,
  };
}

/** 从 localStorage 读取同步配置。 */
export function loadSyncConfig(): SyncConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SYNC_CONFIG);
    if (raw === null) return { ...EMPTY_SYNC_CONFIG };
    return sanitizeSyncConfig(JSON.parse(raw));
  } catch (e) {
    console.warn("Failed to load sync config:", e);
    return { ...EMPTY_SYNC_CONFIG };
  }
}

/** 写入同步配置。失败仅 warn——配置存不上不该打断做题流。 */
export function saveSyncConfig(config: SyncConfig): void {
  try {
    localStorage.setItem(
      STORAGE_KEY_SYNC_CONFIG,
      JSON.stringify(sanitizeSyncConfig(config)),
    );
  } catch (e) {
    console.warn("Failed to save sync config:", e);
  }
}

/** 掩码展示密钥，避免截图 / 录屏时整串泄露。 */
export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 10) return "••••";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

/** 响应式单例：全局设置面板与同步引擎共用同一份配置。 */
export class SyncConfigStore {
  value: SyncConfig = $state(loadSyncConfig());

  /** 从 localStorage 重新读取（测试隔离 / 外部写入后刷新）。 */
  reload(): SyncConfig {
    this.value = loadSyncConfig();
    return this.value;
  }

  update(patch: Partial<SyncConfig>): void {
    this.value = sanitizeSyncConfig({ ...this.value, ...patch });
    saveSyncConfig(this.value);
  }
}

export const syncConfigStore = new SyncConfigStore();

/**
 * 把配置补上后端地址，得到可以直接用的同步目标。
 *
 * 解析失败时返回中文原因，调用方直接把它当状态文案用。
 */
export function toSyncTarget(
  config: SyncConfig,
  relayUrl: string,
): { target: SyncTarget; error?: undefined } | { target: null; error: string } {
  const url = config.supabaseUrl.trim();
  const key = config.supabaseKey.trim();

  if (!url && !key) return { target: null, error: "还没填 Supabase 地址和密钥" };
  if (!url) return { target: null, error: "还没填 Supabase 项目地址" };
  if (!isValidSupabaseUrl(url)) {
    return {
      target: null,
      error: "项目地址应该形如 https://xxxx.supabase.co",
    };
  }
  if (!key) return { target: null, error: "还没填 Supabase 密钥" };

  return {
    target: {
      relayUrl,
      supabaseUrl: url,
      supabaseKey: key,
      autoSync: config.autoSync,
    },
  };
}
