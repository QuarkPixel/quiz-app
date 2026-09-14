/**
 * 同步配置：Gitee 私人令牌 + 同步用的 Gist ID。
 *
 * 两项都存在 `quiz_app_sync_config` 里、**不上传**——令牌传上去就等于把它公开了，
 * Gist ID 传上去则会出现「拉下来把自己连到错地方」。
 *
 * Gist ID 不需要用户填：第一次同步时自动创建并回填。
 */

import {
  EMPTY_SYNC_CONFIG,
  STORAGE_KEY_SYNC_CONFIG,
  type SyncConfig,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 把任意来源的配置净化为合法的 SyncConfig。
 *
 * 只认 `token` / `gistId`。更早那几版配置（Supabase 的 `supabaseUrl` /
 * `supabaseKey` / `credentials`、或中转地址 `relayUrl`）**一律丢弃**：
 * 那些凭据在新的存储后端上没有任何意义，留着只会让人以为还在生效。
 * 唯一保留下来的是 `autoSync`。
 */
export function sanitizeSyncConfig(value: unknown): SyncConfig {
  const raw = isRecord(value) ? value : {};
  const token = toStringValue(raw.token);
  return {
    // 没写过这个字段时按「填过令牌就算开着」推断——这样从旧版本升上来
    // （当年没有开关）的人不会发现同步莫名其妙被关了
    enabled:
      typeof raw.enabled === "boolean"
        ? raw.enabled
        : token.length > 0,
    token,
    gistId: toStringValue(raw.gistId),
    gistUrl: toStringValue(raw.gistUrl),
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

/** 响应式单例：全局设置面板与同步引擎共用同一份配置。 */
export class SyncConfigStore {
  value: SyncConfig = $state(loadSyncConfig());

  private listeners = new Set<(config: SyncConfig) => void>();

  /**
   * 订阅配置变更。
   *
   * 同步引擎靠它感知「总开关被关掉」——关掉之后必须把内存里的同步状态
   * （冲突提示、待裁决、错误信息）清干净，而不是等下一次同步才顺手清。
   */
  subscribe(listener: (config: SyncConfig) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 从 localStorage 重新读取（测试隔离 / 外部写入后刷新）。 */
  reload(): SyncConfig {
    this.value = loadSyncConfig();
    this.notify();
    return this.value;
  }

  update(patch: Partial<SyncConfig>): void {
    this.value = sanitizeSyncConfig({ ...this.value, ...patch });
    saveSyncConfig(this.value);
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(this.value);
      } catch (e) {
        console.warn("Sync config listener failed:", e);
      }
    }
  }
}

export const syncConfigStore = new SyncConfigStore();
