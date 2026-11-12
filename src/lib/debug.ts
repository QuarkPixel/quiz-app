/**
 * 诊断日志与调试开关。
 *
 * **只有这一处开关。** 历史上曾经有两个互不相干的实现（`src/debug.ts` 的
 * `quizDebug()` 和这里的 `quiz_app_debug` 标志），控制台显示 "Debug ON" 而
 * `[sync:*]` 一行都不打——排查时最要命的就是"以为打开了其实是另一套"。
 * 现在 `installDebugConsoleCommands()` 与 `debugLog()` 共用同一个 `debugOn()`。
 *
 * 生效规则（`localStorage["quiz_app_debug"]`）：
 *
 *   `"1"`  → 强制开
 *   `"0"`  → 强制关
 *   没有   → 开发环境默认开，生产默认关（测试环境恒关，免得刷屏）
 *
 * 控制台里：
 *
 * ```js
 * quizDebug(true)   // 开
 * quizDebug(false)  // 关
 * quizDebug(null)   // 清掉覆盖，回到默认
 * quizDump()        // 打印「本地 / 上次同步的基准」会话摘要，贴给排查的人
 * ```
 *
 * 打开后同步链路只打**一行式**摘要，够回答「为什么判成 merge」和「写回把什么
 * 改了」：
 *
 *   `[sync:run]`    每轮开始（模式、本地题库数）
 *   `[sync:remote]` 云端读到了什么（文件数 / 404）
 *   `[sync:decide]` 每个题库这一轮的判定（kind / reason / 三侧会话摘要）
 *   `[sync:write]`  真正写回本地题库时，写进去的那份会话摘要
 *   `[sync:error]`  这一轮为什么失败
 *   `[session:reload]` 视图重读盘上那份时，盘上 / 合并后的队列长度
 *
 * 别在这里塞业务逻辑：它只负责"看得见"，不参与任何判断。
 */

import {
  STORAGE_KEY_SYNC_CONFIG,
  STORAGE_KEY_SYNC_META,
  STORAGE_PREFIX_STATE,
} from "@/config";

const DEBUG_KEY = "quiz_app_debug";

/** 没有任何显式设置时的默认值：开发开、生产关、测试关。 */
function defaultOn(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== "test";
}

export function debugOn(): boolean {
  try {
    const flag = localStorage.getItem(DEBUG_KEY);
    if (flag === "1") return true;
    if (flag === "0") return false;
  } catch {
    // 读不了 localStorage（隐私模式）就按默认来
  }
  return defaultOn();
}

/** `true` 开、`false` 关、`null` 清掉覆盖回到默认。返回当前状态。 */
export function setDebug(enabled: boolean | null): boolean {
  try {
    if (enabled === null) localStorage.removeItem(DEBUG_KEY);
    else localStorage.setItem(DEBUG_KEY, enabled ? "1" : "0");
  } catch {
    // 写不进去就只影响本次，不影响功能
  }
  return debugOn();
}

/**
 * 控制台入口（也是 `window.quizDebug`）。
 *
 * 不传参数 = **读**当前状态；传 `true` / `false` / `null` = 开 / 关 / 回到默认。
 * 旧版是「不传参数就返回状态」，保持这个手感，避免又多一种语义。
 */
export function debug(enabled?: boolean | null): boolean {
  if (enabled === undefined) return debugOn();
  return setDebug(enabled);
}

export function debugLog(channel: string, message: string): void {
  if (!debugOn()) return;
  console.info(`[${channel}] ${message}`);
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function countKeys(value: unknown): number {
  return Object.keys(asRecord(value) ?? {}).length;
}

function listLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * 一份题库状态里「会话」那点关键数字，一行说完。
 *
 * 只放**会进合并**的字段：`day` / `rev` 决定谁更新，`queue` / `doneIds` 是
 * 进度条分子分母，`targets` / `streaks` 是"还差几次"。判定出问题时，看这几个
 * 数就能分清「云端真的改了」还是「合并又把旧值当新进度」。
 */
export function sessionSummary(state: unknown): string {
  const sessions = asRecord(asRecord(state)?.memory)?.sessions;
  const review = asRecord(asRecord(sessions)?.review);
  const learning = asRecord(asRecord(sessions)?.learning);
  const parts: string[] = [];

  if (review) {
    parts.push(
      `review{day:${String(review.day)} rev:${String(review.rev)} ` +
        `q:${listLength(review.queue)} done:${listLength(review.doneIds)} ` +
        `tgt:${countKeys(review.targets)} str:${countKeys(review.streaks)} ` +
        `cur:${typeof review.currentId === "string" ? review.currentId : "-"}}`,
    );
  }
  if (learning) {
    const round = asRecord(learning.round);
    parts.push(
      `learn{rev:${String(learning.rev)} q:${listLength(learning.queue)} ` +
        `cards:${listLength(round?.cardIds)} mastered:${listLength(round?.masteredIds)}}`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : "-";
}

function isPlainRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * 两棵树**结构上**的差异（只往下走三层，够覆盖 `memory.sessions.review.*`）。
 *
 * 用来回答"合并结果到底哪个字段与本地/云端不一样"——判定层说"两边各有一份"
 * 时，这一行直接点名是 `targets` 还是 `queue` 还是 `settings`。
 */
export function diffSummary(a: unknown, b: unknown, depth = 0, prefix = ""): string {
  if (sameJson(a, b)) return "";
  if (depth >= 3 || !isPlainRecord(a) || !isPlainRecord(b)) {
    return prefix || "(root)";
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  const parts: string[] = [];
  for (const key of keys) {
    if (sameJson(a[key], b[key])) continue;
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const nested = diffSummary(a[key], b[key], depth + 1, path);
    parts.push(nested === "" ? path : nested);
  }
  return parts.join(", ");
}

/** 只读地拼一份「本地 vs 上次同步基准」，给 `quizDump()` 用。 */
export function dumpSyncDebug(): string {
  const lines: string[] = [];
  const short = (hash: string) => hash.slice(0, 4);

  try {
    const config = asRecord(
      JSON.parse(localStorage.getItem(STORAGE_KEY_SYNC_CONFIG) ?? "null"),
    );
    if (config) {
      lines.push(
        `目标 ${String(config.gistId || "（未绑定）")} ` +
          `enabled=${String(config.enabled)} auto=${String(config.autoSync)} ` +
          `token=${config.token ? "已填" : "空"}`,
      );
    } else {
      lines.push("目标 未配置");
    }
  } catch {
    lines.push("目标 读取失败");
  }

  try {
    const meta = asRecord(
      JSON.parse(localStorage.getItem(STORAGE_KEY_SYNC_META) ?? "null"),
    );
    const rows = asRecord(meta?.rows) ?? {};
    for (const [key, row] of Object.entries(rows).sort()) {
      const snapshot = asRecord(asRecord(row)?.snapshot);
      lines.push(
        `base  ${short(key.replace(/^bank:/, ""))} ` +
          `${sessionSummary(snapshot?.state)}`,
      );
    }
  } catch {
    lines.push("base  读取失败");
  }

  try {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX_STATE)) keys.push(key);
    }
    for (const key of keys.sort()) {
      const state = JSON.parse(localStorage.getItem(key) ?? "null");
      lines.push(
        `local ${short(key.slice(STORAGE_PREFIX_STATE.length))} ` +
          `${sessionSummary(state)}`,
      );
    }
  } catch {
    lines.push("local 读取失败");
  }

  return lines.join("\n");
}

export function installDebugConsoleCommands(): void {
  if (typeof window === "undefined") return;

  window.quizDebug = debug;
  window.quizDump = () => {
    const text = dumpSyncDebug();
    console.info(`[sync:dump]\n${text}`);
    return text;
  };

  const on = debugOn();
  const override = (() => {
    try {
      return localStorage.getItem(DEBUG_KEY);
    } catch {
      return null;
    }
  })();
  const source = override === null ? "默认" : "手动";
  console.log(
    `%c Debug %c ${on ? "ON" : "OFF"} %c ${source} · quizDebug(false|true|null) · quizDump()`,
    "background: #222; color: #fff; padding: 2px 5px; border-radius: 3px 0 0 3px; font-weight: bold;",
    `background: ${on ? "#2e7d32" : "#757575"}; color: #fff; padding: 2px 5px; border-radius: 0 3px 3px 0; font-weight: bold;`,
    "color: #666; font-family: monospace; margin-left: 8px;",
  );
}

declare global {
  interface Window {
    quizDebug?: (enabled?: boolean | null) => boolean;
    quizDump?: () => string;
  }
}
