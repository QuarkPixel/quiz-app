/**
 * 与云端对话的那一层。
 *
 * 请求**全部**发到自己的后端（同源的 `/api/sync`，见 `relay.ts`），
 * 由后端转发给 Supabase。浏览器不经手、也不知道 Supabase 的密钥：
 * 这里唯一带上的凭据是同步口令（`X-Sync-Key`）。
 *
 * 这里刻意不引 `@supabase/supabase-js`：一方面用到的只有
 * select / upsert / delete 三个动作，手写 fetch 更小更可控；
 * 另一方面引入它就意味着要把项目地址和 key 放进前端——那正是这套设计要避免的。
 */

import { SYNC_TABLE, type RemoteRowMeta, type SyncTarget } from "./types";

/** 同步过程中的错误。`status` 为 0 表示请求根本没发出去（网络层失败）。 */
export class SyncError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/** 连接自检的结果。 */
export interface SyncPingResult {
  ok: boolean;
  /** 后端连 Supabase 那一段的自检信息 */
  relay?: { ok: boolean; latencyMs?: number; hint?: string; error?: string };
  /** 云端表里现在有几行 */
  rowCount: number;
  error?: string;
}

export interface SyncClientOptions {
  target: SyncTarget;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 把 HTTP 错误翻成给人看的中文说明。 */
export function describeHttpError(status: number, body: string): string {
  const trimmed = body.trim();
  let detail = trimmed;
  try {
    const parsed = JSON.parse(trimmed) as {
      message?: unknown;
      hint?: unknown;
      code?: unknown;
    };
    const parts = [parsed.message, parsed.hint].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    if (parts.length > 0) detail = parts.join(" · ");
    if (parsed.code === "42P01") {
      return "云端还没有建表——确认 supabase/migrations 里的迁移已经部署到项目上";
    }
  } catch {
    /* 不是 JSON，用原文 */
  }

  switch (status) {
    case 401:
      return "同步口令不对（要和 Vercel 上的 SYNC_TOKEN 一致）";
    case 403:
      return "后端拒绝了这次请求";
    case 404:
      return "云端没有这张表——确认迁移已经部署到项目上";
    case 429:
      return "请求太频繁，被 Supabase 限流了";
    case 502:
      return "同步后端连不上 Supabase（Vercel 到 Supabase 这一段的网络问题）";
    default:
      return `请求失败（HTTP ${status}）${detail ? `：${detail}` : ""}`;
  }
}

export class SyncClient {
  private readonly base: string;
  private readonly query: string;
  private readonly headers: Record<string, string>;

  constructor(options: SyncClientOptions) {
    const { target } = options;
    this.base = target.relayUrl.replace(/\/+$/, "");
    // 后端据此知道该转发到哪个 Supabase 项目（它自己不记这些）
    this.query = `?url=${encodeURIComponent(target.supabaseUrl)}`;

    this.headers = {
      "content-type": "application/json",
      apikey: target.supabaseKey,
    };
  }

  /** 表路径（含 url 参数），供各动作拼查询串。 */
  private table(extra = ""): string {
    const separator = extra ? "&" : "";
    return `${this.base}/${SYNC_TABLE}${this.query}${separator}${extra}`;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(this.headers);
    const extra = new Headers(init.headers);
    extra.forEach((value, name) => headers.set(name, value));

    try {
      return await fetch(path, { ...init, headers });
    } catch (error) {
      throw new SyncError(
        "连不上同步后端——确认网站是从 Vercel 打开的，或本地开发时 `pnpm dev` 正在运行",
        0,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** 把响应体解析成 JSON 数组；失败时抛出带中文说明的 SyncError。 */
  private async readJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!response.ok) {
      throw new SyncError(
        describeHttpError(response.status, text),
        response.status,
        text,
      );
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new SyncError("后端返回的不是合法 JSON", 0, text.slice(0, 300));
    }
  }

  /** 列出云端所有行的元信息（不含 data，只取 id 和 updated_at）。 */
  async listRows(): Promise<RemoteRowMeta[]> {
    const response = await this.request(
      this.table("select=id,updated_at&order=id.asc&limit=10000"),
      { method: "GET", headers: { accept: "application/json" } },
    );
    const rows = await this.readJson(response);
    if (!Array.isArray(rows)) return [];

    const result: RemoteRowMeta[] = [];
    for (const row of rows) {
      if (row === null || typeof row !== "object") continue;
      const record = row as { id?: unknown; updated_at?: unknown };
      if (typeof record.id !== "string") continue;
      result.push({ id: record.id, updatedAt: parseTimestamp(record.updated_at) });
    }
    return result;
  }

  /** 取回指定行的 data（原样字符串，客户端不做转换）。 */
  async fetchRows(ids: readonly string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (ids.length === 0) return result;

    const filter = encodeURIComponent(`(${ids.map(quoteValue).join(",")})`);
    const response = await this.request(this.table(`select=id,data&id=in.${filter}`), {
      method: "GET",
      headers: { accept: "application/json" },
    });
    const rows = await this.readJson(response);
    if (!Array.isArray(rows)) return result;

    for (const row of rows) {
      if (row === null || typeof row !== "object") continue;
      const record = row as { id?: unknown; data?: unknown };
      if (typeof record.id !== "string") continue;
      result.set(record.id, JSON.stringify(record.data ?? null));
    }
    return result;
  }

  /**
   * 上行若干行（存在就覆盖）。返回每一行服务器侧的 `updated_at` 毫秒时间戳。
   *
   * 一次请求批量写完：数据量本来就只有几十 KB，逐行发请求只会平白多几个来回。
   */
  async upsertRows(
    entries: readonly { id: string; value: string }[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (entries.length === 0) return result;

    const body = entries.map((entry) => ({
      id: entry.id,
      data: safeParse(entry.value),
    }));

    const response = await this.request(
      this.table("on_conflict=id&select=id,updated_at"),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          // merge-duplicates = 主键冲突时改成 UPDATE
          prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(body),
      },
    );
    const rows = await this.readJson(response);

    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row === null || typeof row !== "object") continue;
        const record = row as { id?: unknown; updated_at?: unknown };
        if (typeof record.id !== "string") continue;
        const at = parseTimestamp(record.updated_at);
        if (at > 0) result.set(record.id, at);
      }
    }
    return result;
  }

  /** 删掉云端若干行（回收本地已经删掉的题库）。 */
  async deleteRows(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;

    const filter = encodeURIComponent(`(${ids.map(quoteValue).join(",")})`);
    const response = await this.request(this.table(`id=in.${filter}`), {
      method: "DELETE",
      headers: { prefer: "return=minimal" },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new SyncError(
        describeHttpError(response.status, text),
        response.status,
        text,
      );
    }
    return ids.length;
  }

  /**
   * 连接自检：确认「同源后端 → Supabase → 表」整条链路。
   *
   * 先 ping 后端（它活着吗），再列一次表——
   * 这样出问题时能一眼看出是「后端不可达」还是「地址 / 密钥 / 表 不对」。
   */
  async ping(): Promise<SyncPingResult> {
    const result: SyncPingResult = { ok: false, rowCount: 0 };

    try {
      const response = await fetch(`${this.base}/_ping`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
      const payload = (await response.json()) as { ok?: unknown };
      result.relay = { ok: payload.ok === true };
    } catch (error) {
      result.relay = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      result.rowCount = (await this.listRows()).length;
      result.ok = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }
}

/** PostgREST 的 in.() 过滤器里，值要用双引号包起来以容纳特殊字符。 */
function quoteValue(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/** 把 localStorage 里的原始字符串转成可以塞进 jsonb 的值。 */
function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    // 存进去的本来都是 JSON；万一不是，包成字符串也比整个同步失败强
    return value;
  }
}
