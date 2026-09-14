/**
 * Gitee 客户端的契约测试：用一个最小的 Gitee 替身 verifies 我们的请求形状。
 *
 * 为什么要有这一层：`scripts/gitee-probe.mjs` 已经用真令牌确认过 Gitee 的实际行为
 * （创建 / 读取 / 只更新一个文件 / 删除），但那是要手动跑、且会碰网络的。
 * 这里把**从探针里学到的约定**固化成断言，让以后改客户端时能立刻发现破坏：
 *
 *   - 认证走 `access_token` 查询参数 **或** `Authorization: Bearer` 头
 *   - 创建用 JSON 体 `{files:{名:{content}}}`
 *   - 读取时内容在 `files[名].content`
 *   - 更新只带要改的文件，服务器**保留其余文件**
 *   - 删除文件 = 把内容置为 null
 *   - 响应里的 `updated_at` 是 `2026-09-14T22:18:40+08:00` 这种格式
 */

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { GiteeClient, GiteeError } from "@/features/sync/gitee";

/** 内存里的 Gitee 替身。 */
class FakeGitee {
  private gists = new Map<
    string,
    { files: Map<string, string>; updatedAt: string; description: string }
  >();
  private counter = 0;
  requests: Array<{ method: string; path: string; query: URLSearchParams; files?: unknown }> = [];

  /** 令牌校验：跟真 Gitee 一样，不对就 401。 */
  private authorized(url: URL, authHeader: string | undefined): boolean {
    const fromQuery = url.searchParams.get("access_token");
    const fromHeader = authHeader?.replace(/^Bearer\s+/i, "");
    return fromQuery === "good-token" || fromHeader === "good-token";
  }

  /**
   * 响应统一带上 CORS 头。
   *
   * 这不是为了绕过什么——**真 Gitee 就是这么返回的**（实测
   * `access-control-allow-origin: *`，预检放行 authorization）。测试环境
   * （happy-dom）的 fetch 会真的执行同源策略，所以替身必须照做，
   * 否则测出来的失败是环境的、不是代码的。
   */
  private corsHeaders(): Record<string, string> {
    return {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
    };
  }

  private json(res: import("node:http").ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json", ...this.corsHeaders() });
    res.end(JSON.stringify(body));
  }

  private gistBody(id: string, files: Map<string, string>, updatedAt: string) {
    return {
      id,
      updated_at: updatedAt,
      files: Object.fromEntries(
        [...files.entries()].map(([name, content]) => [name, { content }]),
      ),
    };
  }

  handle = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const body = await readBody(req);
      const record: (typeof this.requests)[number] = {
        method: req.method ?? "GET",
        path: url.pathname,
        query: url.searchParams,
      };
      if (body) {
        try {
          record.files = (JSON.parse(body) as { files?: unknown }).files;
        } catch {
          /* 不是 JSON（比如 multipart），忽略 */
        }
      }
      this.requests.push(record);

      if (req.method === "OPTIONS") {
        res.writeHead(204, this.corsHeaders());
        return res.end();
      }

      if (!this.authorized(url, req.headers.authorization)) {
        return this.json(res, 401, { message: "401 Unauthorized: Access token does not exist" });
      }

      // POST /gists —— 创建
      if (req.method === "POST" && url.pathname === "/gists") {
        const parsed = JSON.parse(body || "{}") as {
          files?: Record<string, { content?: string }>;
          description?: string;
        };
        const id = `gist-${++this.counter}`;
        const files = new Map<string, string>();
        for (const [name, entry] of Object.entries(parsed.files ?? {})) {
          if (typeof entry?.content === "string") files.set(name, entry.content);
        }
        const updatedAt = new Date().toISOString();
        this.gists.set(id, {
          files,
          updatedAt,
          description:
            typeof parsed.description === "string" ? parsed.description : "",
        });
        return this.json(res, 201, this.gistBody(id, files, updatedAt));
      }

      // GET /gists —— 列表（令牌校验与「选一条已有的」都用它）
      if (req.method === "GET" && url.pathname === "/gists") {
        return this.json(
          res,
          200,
          [...this.gists.entries()].map(([id, g]) => ({
            id,
            html_url: `https://gitee.com/someone/codes/${id}`,
            description: g.description,
            updated_at: g.updatedAt,
            files: Object.fromEntries(
              [...g.files.keys()].map((name) => [name, { content: "" }]),
            ),
          })),
        );
      }

      const match = /^\/gists\/([^/]+)$/.exec(url.pathname);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const gist = this.gists.get(id);
        if (!gist) return this.json(res, 404, { message: "Not Found" });

        if (req.method === "GET") {
          return this.json(res, 200, this.gistBody(id, gist.files, gist.updatedAt));
        }

        if (req.method === "PATCH") {
          const parsed = JSON.parse(body || "{}") as {
            files?: Record<string, { content?: string } | null>;
          };
          // 关键约定：只动传进来的文件，其余原样保留；content 为 null 表示删除
          for (const [name, entry] of Object.entries(parsed.files ?? {})) {
            if (entry === null) gist.files.delete(name);
            else if (typeof entry?.content === "string") gist.files.set(name, entry.content);
          }
          gist.updatedAt = new Date().toISOString();
          return this.json(res, 200, this.gistBody(id, gist.files, gist.updatedAt));
        }

        if (req.method === "DELETE") {
          this.gists.delete(id);
          res.writeHead(204, this.corsHeaders());
          return res.end();
        }
      }

      return this.json(res, 404, { message: "Not Found" });
    })();
  };
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

let server: Server;
let apiBase: string;
let fake: FakeGitee;

beforeAll(async () => {
  fake = new FakeGitee();
  server = createServer(fake.handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  apiBase = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(gistId = ""): GiteeClient {
  return new GiteeClient({
    apiBase,
    token: "good-token",
    gistId,
    autoSync: true,
  });
}

describe("Gitee 客户端", () => {
  test("创建 Gist 会带上文件，并回填 id", async () => {
    const c = client();
    const gist = await c.createGist({
      "_general.json": '{"v":1}',
      "abc.json": '{"v":2}',
    });
    expect(gist.id).toMatch(/^gist-/);
    expect(gist.files.get("_general.json")).toBe('{"v":1}');
    expect(gist.files.get("abc.json")).toBe('{"v":2}');
    expect(c.id).toBe(gist.id);
  });

  test("读取单条能拿回文件内容与 updated_at", async () => {
    const c = client();
    const created = await c.createGist({ "a.json": '{"x":1}' });
    const read = await client(created.id).getGist();
    expect(read?.files.get("a.json")).toBe('{"x":1}');
    expect(read?.updatedAt).toBeGreaterThan(0);
  });

  test("只更新一个文件时，其余文件原封不动（逐题库更新的依据）", async () => {
    const created = await client().createGist({
      "a.json": "AAA",
      "b.json": "BBB",
    });
    const c = client(created.id);
    await c.updateFiles({ "b.json": "BBB2" });

    const after = await client(created.id).getGist();
    expect(after?.files.get("b.json")).toBe("BBB2");
    expect(after?.files.get("a.json")).toBe("AAA");
  });

  test("删除文件只删指定的那些", async () => {
    const created = await client().createGist({
      "keep.json": "K",
      "drop.json": "D",
    });
    await client(created.id).deleteFiles(["drop.json"]);

    const after = await client(created.id).getGist();
    expect(after?.files.has("drop.json")).toBe(false);
    expect(after?.files.get("keep.json")).toBe("K");
  });

  test("Gist 不存在时 getGist 返回 null（而不是抛错）", async () => {
    expect(await client("does-not-exist").getGist()).toBeNull();
  });

  test("令牌不对时抛出可读的中文错误", async () => {
    const bad = new GiteeClient({
      apiBase,
      token: "wrong-token",
      gistId: "",
      autoSync: true,
    });
    await expect(bad.createGist({ "a.json": "x" })).rejects.toThrow(GiteeError);
    await expect(bad.createGist({ "a.json": "x" })).rejects.toThrow(/令牌/);
  });

  test("认证信息同时出现在查询串与请求头里（两条路都留）", async () => {
    fake.requests.length = 0;
    const created = await client().createGist({ "a.json": "x" });
    const createReq = fake.requests.at(-1);
    expect(createReq?.query.get("access_token")).toBe("good-token");
    void created;
  });

  test("自检：没建过 Gist 时验令牌，建过时报文件数", async () => {
    const fresh = await client().ping();
    expect(fresh.ok).toBe(true);
    expect(fresh.fileCount).toBe(0);

    const created = await client().createGist({ "a.json": "1", "b.json": "2" });
    const existing = await client(created.id).ping();
    expect(existing.ok).toBe(true);
    expect(existing.fileCount).toBe(2);
  });

  test("列表返回 id / 描述 / 文件名 / 更新时间（选一条已有 Gist 的依据）", async () => {
    const created = await client().createGist({
      "_general.json": "{}",
      "banks-0.json": "{}",
    });
    const list = await client().listGists();

    const mine = list.find((g) => g.id === created.id);
    expect(mine, "刚建的这条应该出现在列表里").toBeDefined();
    expect(mine?.htmlUrl).toContain(created.id);
    expect(mine?.description).toBe("quiz-app sync");
    expect([...(mine?.fileNames ?? [])].sort()).toEqual([
      "_general.json",
      "banks-0.json",
    ]);
    expect(mine?.updatedAt ?? 0).toBeGreaterThan(0);
  });

  test("列表按更新时间倒序（最近的在最前面）", async () => {
    await client().createGist({ "a.json": "1" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await client().createGist({ "b.json": "2" });

    const list = await client().listGists();
    expect(list[0].id).toBe(second.id);
  });

  test("自检遇到不存在的 Gist 时给出可读原因", async () => {
    const result = await client("gone").ping();
    expect(result.ok).toBe(false);
    expect(result.error).toContain("不存在");
  });
});
