/**
 * 解析同步目标：把配置里的令牌 / Gist ID 合成一个可以直接用的目标。
 *
 * 全是本地的活，不发请求——Gitee 的地址是固定的，不需要问任何后端。
 */

import { GITEE_API_BASE, type SyncConfig, type SyncTarget } from "./types";

/**
 * Gitee API 基地址。
 *
 * 正常就是官方地址；测试时可以用 `VITE_GITEE_API_BASE` 指向本地 mock，
 * 免得为了测同步逻辑真的去动线上数据。
 */
export function giteeApiBase(): string {
  const override = import.meta.env.VITE_GITEE_API_BASE;
  if (typeof override === "string" && override.trim()) {
    return override.trim().replace(/\/+$/, "");
  }
  return GITEE_API_BASE;
}

export interface ResolveResult {
  target: SyncTarget | null;
  /** 失败原因（给人看的中文说明） */
  error?: string;
}

/**
 * 把配置解析成同步目标。纯函数，不发请求。
 *
 * `apiBase` 只在测试里显式传（指向本地替身）；生产走 `giteeApiBase()`。
 */
export function resolveSyncTarget(
  config: SyncConfig,
  apiBase: string = giteeApiBase(),
): ResolveResult {
  const token = config.token.trim();
  if (!token) {
    return { target: null, error: "未填写 Gitee 令牌" };
  }

  return {
    target: {
      apiBase,
      enabled: config.enabled,
      token,
      gistId: config.gistId.trim(),
      gistUrl: config.gistUrl.trim(),
      autoSync: config.autoSync,
    },
  };
}

/** 掩码展示令牌，避免截图 / 录屏时整串泄露。 */
export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 10) return "••••";
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}
