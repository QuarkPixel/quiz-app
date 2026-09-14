/**
 * 解析同步目标：把「配置里的地址 + 密钥 + 后端地址」合成一个可以直接用的目标。
 *
 * 全是本地的活，不需要问网络——凭据本来就在这台设备上（这正是
 * 「各带各的库」的形状：后端不知道也不需要知道你的库在哪）。
 */

import { toSyncTarget } from "./config.svelte";
import { SYNC_API_PATH, type SyncConfig, type SyncTarget } from "./types";

/**
 * 后端基地址。
 *
 * - 生产：与页面同源，`/api/sync`
 * - 本地开发：Vite 把 `/api/sync` 代理到线上部署（见 `vite.config.ts`），
 *   所以这里仍旧是同源相对路径——开发时不用改任何代码
 * - 想指向别处：构建时给 `VITE_SYNC_RELAY` 即可
 */
export function relayBase(): string {
  const override = import.meta.env.VITE_SYNC_RELAY;
  if (typeof override === "string" && override.trim()) {
    return override.trim().replace(/\/+$/, "");
  }
  return SYNC_API_PATH;
}

export interface ResolveResult {
  target: SyncTarget | null;
  /** 失败原因（给人看的中文说明） */
  error?: string;
}

/** 把配置解析成同步目标。纯函数，不发请求。 */
export function resolveSyncTarget(config: SyncConfig): ResolveResult {
  return toSyncTarget(config, relayBase());
}
