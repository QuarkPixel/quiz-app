/**
 * Gitee Gists API 客户端。
 *
 * ── 为什么可以直接从浏览器调 ────────────────────────────────────────────────
 * 实测（`scripts/gitee-cors-probe.mjs`）：Gitee 返回 `access-control-allow-origin: *`，
 * 预检明确放行 `authorization` 与 `content-type`，且 `Authorization: Bearer <令牌>`
 * 对读写都有效。所以**不需要任何中转服务器**，令牌也不会出现在 URL 里。
 *
 * ── 实测确认过的接口行为（scripts/gitee-probe.mjs）─────────────────────────
 *   POST   /gists?access_token=…            创建，体是 JSON `{files:{名:{content}}}`
 *   GET    /gists/{id}                      读单条，取内容走 `files[名].content`
 *   PATCH  /gists/{id}                      更新，**只带要改的文件**即可，
 *                                           其余文件原封不动（这是逐题库更新的依据）
 *   DELETE /gists/{id}                      删整条
 *
 * 更新用 `application/json` 体就行（虽然官方 spec 写的是 multipart/form-data，
 * 实测 JSON 也吃；multipart 的 `files[名][content]` 写法同样可用，见探针脚本）。
 *
 * 认证方式上，令牌同时放查询串（官方 spec 的写法）和 `Authorization` 头：
 * 前者是保底，后者是实测有效且不进 URL 的那条路。
 */

import { GIST_DESCRIPTION, type SyncTarget } from "./types";

/** 同步过程中的错误。`status` 为 0 表示请求根本没发出去（网络层失败）。 */
export class GiteeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "GiteeError";
  }
}

/** Gitee 返回的一个文件。 */
interface GiteeFile {
  content?: unknown;
  truncated?: unknown;
}

export interface GiteeGist {
  id: string;
  /** Gitee 给的人类可读页面地址（`https://gitee.com/<用户>/codes/<id>`），直接用它，别自己拼 */
  htmlUrl: string;
  description: string;
  updatedAt: number;
  files: Map<string, string>;
}

/** 列表里的一条（只要够选择用就行，不带内容）。 */
export interface GistSummary {
  id: string;
  htmlUrl: string;
  description: string;
  fileNames: string[];
  updatedAt: number;
}

/** 把 HTTP 错误翻成给人看的中文说明。 */
export function describeHttpError(status: number, body: string): string {
  let message = "";
  try {
    const parsed = JSON.parse(body) as { message?: unknown; messages?: unknown };
    if (typeof parsed.message === "string") message = parsed.message;
    else if (Array.isArray(parsed.messages)) {
      message = parsed.messages.filter((m) => typeof m === "string").join(" · ");
    }
  } catch {
    message = body.trim().slice(0, 200);
  }

  switch (status) {
    case 401:
      return "令牌无效或已过期";
    case 403:
      return "令牌权限不足（需要 gists）";
    case 404:
      return "目标仓库不存在";
    case 422:
      return `请求不合法${message ? `：${message}` : ""}`;
    case 429:
      return "请求过于频繁，稍后再试";
    default:
      return `请求失败（HTTP ${status}）${message ? `：${message}` : ""}`;
  }
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string") return 0;
  // Gitee 给的是 `2026-09-14T22:18:40+08:00`，Date.parse 能认
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class GiteeClient {
  private readonly base: string;
  private readonly token: string;
  private gistId: string;

  constructor(target: SyncTarget) {
    this.base = target.apiBase.replace(/\/+$/, "");
    this.token = target.token.trim();
    this.gistId = target.gistId.trim();
  }

  get id(): string {
    return this.gistId;
  }

  private headers(json: boolean): HeadersInit {
    const headers: Record<string, string> = {
      accept: "application/json",
      // 实测有效；官方 spec 走查询串，两者都带上更稳
      authorization: `Bearer ${this.token}`,
    };
    if (json) headers["content-type"] = "application/json";
    return headers;
  }

  private url(path: string): string {
    const separator = path.includes("?") ? "&" : "?";
    return `${this.base}${path}${separator}access_token=${encodeURIComponent(this.token)}`;
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    try {
      return await fetch(this.url(path), { ...init, headers: this.headers(true) });
    } catch (error) {
      throw new GiteeError(
        "连接 Gitee 失败",
        0,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async readError(response: Response): Promise<GiteeError> {
    const text = await response.text().catch(() => "");
    return new GiteeError(
      describeHttpError(response.status, text),
      response.status,
      text.slice(0, 300),
    );
  }

  /** 解析 Gitee 的 gist 响应体。 */
  private parseGist(body: unknown): GiteeGist | null {
    if (body === null || typeof body !== "object") return null;
    const record = body as {
      id?: unknown;
      html_url?: unknown;
      description?: unknown;
      updated_at?: unknown;
      files?: unknown;
    };
    if (typeof record.id !== "string") return null;

    const files = new Map<string, string>();
    if (record.files !== null && typeof record.files === "object") {
      for (const [name, raw] of Object.entries(record.files as Record<string, unknown>)) {
        const file = raw as GiteeFile;
        // 实测：files[名] 是个对象，内容在 .content
        if (file !== null && typeof file === "object" && typeof file.content === "string") {
          files.set(name, file.content);
        } else if (typeof raw === "string") {
          files.set(name, raw);
        }
      }
    }

    return {
      id: record.id,
      htmlUrl: typeof record.html_url === "string" ? record.html_url : "",
      description: typeof record.description === "string" ? record.description : "",
      updatedAt: parseTimestamp(record.updated_at),
      files,
    };
  }

  /**
   * 列出账号里的代码片段，用于「选一条已有的来同步」。
   *
   * 实测列表接口**会返回 `description` 和 `files` 的文件名**，所以能凭这两样
   * 认出哪些是本应用创建的（描述是我们写死的那句，且含 `_general.json`）。
   *
   * 只取第一页（`per_page=100`）：代码片段多到超过 100 条时，更旧的那些选不到 ——
   * 对一个同步用途来说够了，真需要再翻页。
   */
  async listGists(): Promise<GistSummary[]> {
    const response = await this.request("/gists?per_page=100&page=1", { method: "GET" });
    if (!response.ok) throw await this.readError(response);

    const body = await response.json();
    if (!Array.isArray(body)) return [];

    const result: GistSummary[] = [];
    for (const raw of body) {
      if (raw === null || typeof raw !== "object") continue;
      const record = raw as {
        id?: unknown;
        html_url?: unknown;
        description?: unknown;
        updated_at?: unknown;
        files?: unknown;
      };
      if (typeof record.id !== "string") continue;

      const fileNames =
        record.files !== null && typeof record.files === "object"
          ? Object.keys(record.files as Record<string, unknown>)
          : [];

      result.push({
        id: record.id,
        htmlUrl: typeof record.html_url === "string" ? record.html_url : "",
        description: typeof record.description === "string" ? record.description : "",
        fileNames,
        updatedAt: parseTimestamp(record.updated_at),
      });
    }

    // 最近更新的排前面
    result.sort((a, b) => b.updatedAt - a.updatedAt);
    return result;
  }

  /** 创建一条新的 Gist，并把它的 id 记下来。 */
  async createGist(files: Record<string, string>): Promise<GiteeGist> {
    const response = await this.request("/gists", {
      method: "POST",
      body: JSON.stringify({
        description: GIST_DESCRIPTION,
        public: false,
        files: Object.fromEntries(
          Object.entries(files).map(([name, content]) => [name, { content }]),
        ),
      }),
    });
    if (!response.ok) throw await this.readError(response);

    const gist = this.parseGist(await response.json());
    if (!gist) throw new GiteeError("创建失败：未返回 id", 0);
    this.gistId = gist.id;
    return gist;
  }

  /** 读当前 Gist；返回 null 表示它不存在（被删了）。 */
  async getGist(): Promise<GiteeGist | null> {
    if (!this.gistId) throw new GiteeError("尚未选定目标仓库", 0);

    const response = await this.request(`/gists/${encodeURIComponent(this.gistId)}`, {
      method: "GET",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await this.readError(response);

    const gist = this.parseGist(await response.json());
    if (!gist) throw new GiteeError("Gist 格式无法识别", 0);
    return gist;
  }

  /**
   * 只更新指定的这几个文件，其余文件原封不动。
   *
   * 这是「改了哪个题库就只传哪个」的关键——实测过：只带 B 文件时，
   * A 文件的内容与存在性都不受影响。
   */
  async updateFiles(files: Record<string, string>): Promise<GiteeGist> {
    if (!this.gistId) throw new GiteeError("尚未选定目标仓库", 0);

    const response = await this.request(`/gists/${encodeURIComponent(this.gistId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        files: Object.fromEntries(
          Object.entries(files).map(([name, content]) => [name, { content }]),
        ),
      }),
    });
    if (!response.ok) throw await this.readError(response);

    const gist = this.parseGist(await response.json());
    if (!gist) throw new GiteeError("Gist 格式无法识别", 0);
    return gist;
  }

  /**
   * 删除 Gist 里的文件。
   *
   * Gitee 的约定：把文件内容置为 null 就表示删除（GitHub 也是这个约定）。
   */
  async deleteFiles(names: readonly string[]): Promise<void> {
    if (names.length === 0) return;
    if (!this.gistId) throw new GiteeError("尚未选定目标仓库", 0);

    const body = {
      files: Object.fromEntries(names.map((name) => [name, null])),
    };
    const response = await this.request(`/gists/${encodeURIComponent(this.gistId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await this.readError(response);
  }

  /**
   * 整个删掉一条代码片段。
   *
   * 不可恢复——面板那边是二次确认（垃圾桶图标点两下）之后才走到这里。
   */
  async deleteGist(): Promise<void> {
    if (!this.gistId) throw new GiteeError("尚未选定目标仓库", 0);
    const response = await this.request(`/gists/${encodeURIComponent(this.gistId)}`, {
      method: "DELETE",
    });
    if (!response.ok) throw await this.readError(response);
  }

  /**
   * 自检：令牌能用吗、Gist 在不在。
   *
   * `gist` 一并带回来（读得到的时候），调用方不必再请求一次就能数出
   * 云端有几个题库、也能顺手回填网页地址。
   */
  async ping(): Promise<{
    ok: boolean;
    fileCount: number;
    gist?: GiteeGist;
    error?: string;
    /** 目标 Gist 已经不在了（被删 / 换了账号）——面板会把那条 id 划掉 */
    missingTarget?: boolean;
  }> {
    try {
      if (!this.gistId) {
        // 还没建过：用一次列接口验证令牌（per_page=1 只取一条，不动数据）
        const response = await this.request("/gists?per_page=1", { method: "GET" });
        if (!response.ok) throw await this.readError(response);
        return { ok: true, fileCount: 0 };
      }
      const gist = await this.getGist();
      if (!gist) return { ok: false, fileCount: 0, error: "目标仓库不存在", missingTarget: true };
      return { ok: true, fileCount: gist.files.size, gist };
    } catch (error) {
      return {
        ok: false,
        fileCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
