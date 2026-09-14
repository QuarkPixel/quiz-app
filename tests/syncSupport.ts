/**
 * 云同步测试的脚手架：内存里的 Gitee 替身 + 多设备 localStorage + 可控时钟。
 *
 * 「多设备」是真的多份 localStorage 快照：`use(name)` 把某台设备的快照装回来，
 * 写完再 `save(name)` 存回去。这样一台设备上跑完同步，另一台设备看到的就是
 * 真实的结果（而不是把同一份 localStorage 改来改去）。
 *
 * 时钟也必须是可控的：同步判定依赖「本地改动时间 vs 上次同步时间」，
 * 同一毫秒里连做几步会让判定失真，测试就测不出线上那些 bug 了。
 */

import { vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { SyncEngine } from "@/features/sync/engine.svelte";
import { SyncConfigStore } from "@/features/sync/config.svelte";
import { installStorageHook, writeLocal } from "@/features/sync/storage";
import { decodePayload } from "@/features/sync/payload";
import {
  GIST_GENERAL_FILE,
  shardFileName,
  shardIndexOf,
  type GeneralSnapshot,
  type ShardSnapshot,
} from "@/features/sync/types";

export const EMPTY_GENERAL: GeneralSnapshot = {
  activeBank: null,
  defaultSettings: {},
  library: [],
  globalSettings: {},
};

// ── Gitee 替身 ──────────────────────────────────────────────────────────────

export class FakeGitee {
  private gists = new Map<string, Map<string, string>>();
  private counter = 0;
  /** 测试用：收到过的请求（`GET /gists` 这种），用来断言「关掉同步后一个请求都不发」。 */
  readonly requests: string[] = [];

  handle = (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://localhost");
      this.requests.push(`${req.method ?? ""} ${url.pathname}`);
      const body = await readBody(req);
      const cors = {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
      };
      const send = (status: number, payload?: unknown) => {
        res.writeHead(status, { "content-type": "application/json", ...cors });
        res.end(payload === undefined ? "" : JSON.stringify(payload));
      };

      if (req.method === "OPTIONS") return send(204);
      if ((req.headers.authorization ?? "").replace(/^Bearer /, "") !== "tok") {
        return send(401, { message: "401 Unauthorized" });
      }

      if (req.method === "POST" && url.pathname === "/gists") {
        const parsed = JSON.parse(body || "{}") as {
          files?: Record<string, { content?: string }>;
        };
        const id = `g${++this.counter}`;
        const files = new Map<string, string>();
        for (const [n, f] of Object.entries(parsed.files ?? {})) {
          if (typeof f?.content === "string") files.set(n, f.content);
        }
        this.gists.set(id, files);
        return send(201, gistBody(id, files));
      }

      // 列表接口：「测试连接」靠它让用户挑一条已有的 Gist
      if (req.method === "GET" && url.pathname === "/gists") {
        const summaries = [...this.gists].map(([id, files]) => ({
          id,
          html_url: `https://gitee.com/tester/codes/${id}`,
          description: "quiz-app sync",
          updated_at: new Date().toISOString(),
          files: Object.fromEntries([...files.keys()].map((n) => [n, { filename: n }])),
        }));
        return send(200, summaries);
      }

      const m = /^\/gists\/([^/]+)$/.exec(url.pathname);
      if (m) {
        const id = m[1];
        const files = this.gists.get(id);
        if (!files) return send(404, { message: "Not Found" });

        if (req.method === "GET") return send(200, gistBody(id, files));
        if (req.method === "PATCH") {
          const parsed = JSON.parse(body || "{}") as {
            files?: Record<string, { content?: string } | null>;
          };
          for (const [n, f] of Object.entries(parsed.files ?? {})) {
            if (f === null) files.delete(n);
            else if (typeof f?.content === "string") files.set(n, f.content);
          }
          return send(200, gistBody(id, files));
        }
        if (req.method === "DELETE") {
          this.gists.delete(id);
          return send(204);
        }
      }
      return send(404, { message: "Not Found" });
    })();
  };

  /** 测试用：云端现在有哪些文件。 */
  filesOf(id: string): Record<string, string> {
    return Object.fromEntries(this.gists.get(id) ?? []);
  }

  /** 测试用：直接往云端塞一个文件（模拟另一台设备 / 手工改过）。 */
  put(id: string, name: string, content: string): void {
    const files = this.gists.get(id);
    if (files) files.set(name, content);
  }

  /** 测试用：云端有没有这条 Gist。 */
  has(id: string): boolean {
    return this.gists.has(id);
  }

  /** 测试用：清空全部云端数据（每个用例之间隔离）。 */
  reset(): void {
    this.gists.clear();
    this.counter = 0;
    this.requests.length = 0;
  }
}

function gistBody(id: string, files: Map<string, string>) {
  return {
    id,
    html_url: `https://gitee.com/tester/codes/${id}`,
    description: "quiz-app sync",
    updated_at: new Date().toISOString(),
    files: Object.fromEntries([...files].map(([n, c]) => [n, { content: c }])),
  };
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => resolve(d));
  });
}

// ── 多设备脚手架 ────────────────────────────────────────────────────────────

interface DeviceEntry {
  storage: Record<string, string>;
  engine: SyncEngine;
  store: SyncConfigStore;
}

export class SyncHarness {
  readonly fake = new FakeGitee();
  apiBase = "";

  private server: Server | null = null;
  private clock = 1_700_000_000_000;
  private devices = new Map<string, DeviceEntry>();
  private current: string | null = null;

  async start(): Promise<void> {
    this.server = createServer(this.fake.handle);
    await new Promise<void>((r) => this.server?.listen(0, "127.0.0.1", r));
    const { port } = this.server.address() as AddressInfo;
    this.apiBase = `http://127.0.0.1:${port}`;
    vi.spyOn(Date, "now").mockImplementation(() => this.clock);
    installStorageHook();
    // 拉取到新内容时引擎会整页刷新；测试里拦下来，免得真的跳走
    vi.stubGlobal("location", {
      ...globalThis.location,
      reload: () => {
        this.reloads += 1;
      },
    });
  }

  async stop(): Promise<void> {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    await new Promise<void>((r) => this.server?.close(() => r()));
    this.server = null;
  }

  reloads = 0;

  /** 每个用例之间彻底隔离：设备、云端、时钟全部重来。 */
  reset(): void {
    this.devices.clear();
    this.current = null;
    this.fake.reset();
    localStorage.clear();
    this.reloads = 0;
    this.clock = 1_700_000_000_000;
  }

  /** 时间往前走一点（真实使用里每一步之间都有间隔）。 */
  tick(ms = 1000): void {
    this.clock += ms;
  }

  // ── 设备 ──

  /** 全新设备：只有应用启动时写下的默认 general 配置。 */
  freshDevice(name: string): void {
    this.use(name);
    localStorage.setItem("quiz_app_general", JSON.stringify(EMPTY_GENERAL));
    this.tick();
    this.save(name);
  }

  /**
   * 把某台设备的 localStorage 装回来。
   *
   * 必须走**原始** setItem（`writeLocal`）：装快照不是「本机改动了数据」，
   * 走被包装过的 setItem 会把每个键的 mtime 刷新成现在，测试里的时间线就废了
   * （表现成「我没动过的题库被判成本地改过」）。
   */
  use(name: string): void {
    // 已经在这台设备上就别重装：那会把还没 save() 的改动冲掉
    if (this.current === name) return;
    localStorage.clear();
    for (const [key, value] of Object.entries(this.devices.get(name)?.storage ?? {})) {
      writeLocal(key, value);
    }
    this.current = name;
  }

  /** 把当前 localStorage 存回某台设备。 */
  save(name = this.current): void {
    if (name === null) throw new Error("还没有 use(device)");
    const storage: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key !== null) storage[key] = localStorage.getItem(key) ?? "";
    }
    const existing = this.devices.get(name);
    this.devices.set(name, {
      storage,
      engine: existing?.engine ?? (undefined as unknown as SyncEngine),
      store: existing?.store ?? (undefined as unknown as SyncConfigStore),
    });
    this.current = name;
  }

  /** 在某台设备上「打开应用」：装好 localStorage，造一个指向替身的引擎。 */
  open(
    name: string,
    init: Partial<{ gistId: string; autoSync: boolean; token: string }> = {},
  ): SyncEngine {
    this.use(name);
    const store = new SyncConfigStore();
    store.update({
      enabled: true,
      token: "tok",
      autoSync: true,
      ...init,
    });
    const engine = new SyncEngine(store, this.apiBase);
    this.devices.set(name, { storage: this.devices.get(name)?.storage ?? {}, engine, store });
    this.current = name;
    // 把配置写回这台设备的快照（否则下次 use() 会把它冲掉）
    this.save(name);
    return engine;
  }

  engine(name: string): SyncEngine {
    const entry = this.devices.get(name);
    if (!entry?.engine) throw new Error(`设备 ${name} 还没 open()`);
    this.use(name);
    return entry.engine;
  }

  store(name: string): SyncConfigStore {
    const entry = this.devices.get(name);
    if (!entry?.store) throw new Error(`设备 ${name} 还没 open()`);
    return entry.store;
  }

  /** 切到某台设备 → 跑一段逻辑 → 存回去。 */
  async on<T>(name: string, fn: (engine: SyncEngine) => Promise<T>): Promise<T> {
    const engine = this.engine(name);
    const result = await fn(engine);
    this.tick();
    this.save(name);
    return result;
  }

  // ── 本地数据 ──

  /** 造一个题库：题目 + 进度 + library 条目（形状与真实写入一致）。 */
  seedBank(
    hash: string,
    name: string,
    marker: string,
    options: { withState?: boolean } = {},
  ): void {
    const withState = options.withState ?? true;
    localStorage.setItem(
      `quiz_app_questions_${hash}`,
      JSON.stringify([
        { id: "q1", type: "memory", question: marker, answer: marker },
        { id: "q2", type: "memory", question: `${marker}2`, answer: `${marker}2` },
      ]),
    );
    if (withState) {
      localStorage.setItem(
        `quiz_app_state_${hash}`,
        JSON.stringify({ currentRound: 1, memory: { progress: {} } }),
      );
    }
    const general = JSON.parse(localStorage.getItem("quiz_app_general") ?? "{}");
    general.library = [
      ...(general.library ?? []).filter((b: { hash: string }) => b.hash !== hash),
      { hash, name, mode: "memory", count: 2, addedAt: Date.now() },
    ];
    localStorage.setItem("quiz_app_general", JSON.stringify(general));
    this.tick();
  }

  /** 模拟刷题：改这个题库的进度。 */
  studyBank(hash: string, round: number): void {
    localStorage.setItem(
      `quiz_app_state_${hash}`,
      JSON.stringify({ currentRound: round, memory: { progress: { q1: { level: round } } } }),
    );
    this.tick();
  }

  /** 模拟侧边栏把某个题库置顶（只改列表顺序）。 */
  moveBankToTop(hash: string): void {
    const general = JSON.parse(localStorage.getItem("quiz_app_general") ?? "{}");
    const library = (general.library ?? []) as Array<{ hash: string }>;
    const entry = library.find((item) => item.hash === hash);
    if (!entry) throw new Error(`题库不在列表里：${hash}`);
    general.library = [entry, ...library.filter((item) => item.hash !== hash)];
    localStorage.setItem("quiz_app_general", JSON.stringify(general));
    this.tick();
  }

  /** 模拟删题库（题库内容 + 进度 + 列表条目）。 */
  deleteBank(hash: string): void {
    localStorage.removeItem(`quiz_app_questions_${hash}`);
    localStorage.removeItem(`quiz_app_state_${hash}`);
    const general = JSON.parse(localStorage.getItem("quiz_app_general") ?? "{}");
    general.library = (general.library ?? []).filter(
      (b: { hash: string }) => b.hash !== hash,
    );
    localStorage.setItem("quiz_app_general", JSON.stringify(general));
    this.tick();
  }

  localLibrary(): Array<{ hash: string; name: string }> {
    const general = JSON.parse(localStorage.getItem("quiz_app_general") ?? "{}");
    return general.library ?? [];
  }

  localQuestionText(hash: string): string | null {
    return localStorage.getItem(`quiz_app_questions_${hash}`);
  }

  // ── 云端 ──

  cloudFiles(gistId: string): Record<string, string> {
    return this.fake.filesOf(gistId);
  }

  async cloudShard(gistId: string, hash: string): Promise<ShardSnapshot | null> {
    const raw = this.cloudFiles(gistId)[shardFileName(shardIndexOf(hash))];
    if (!raw) return null;
    const json = await decodePayload(raw);
    return json === null ? null : (JSON.parse(json) as ShardSnapshot);
  }

  async cloudGeneral(gistId: string): Promise<GeneralSnapshot | null> {
    const raw = this.cloudFiles(gistId)[GIST_GENERAL_FILE];
    if (!raw) return null;
    const json = await decodePayload(raw);
    return json === null ? null : (JSON.parse(json) as GeneralSnapshot);
  }

  async cloudBanks(gistId: string): Promise<string[]> {
    const hashes: string[] = [];
    for (const name of Object.keys(this.cloudFiles(gistId))) {
      if (name === GIST_GENERAL_FILE) continue;
      const raw = this.cloudFiles(gistId)[name];
      const json = await decodePayload(raw);
      if (json === null) continue;
      const snapshot = JSON.parse(json) as ShardSnapshot;
      hashes.push(...Object.keys(snapshot.banks ?? {}));
    }
    return hashes.sort();
  }
}
