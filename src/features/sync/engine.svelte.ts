/**
 * 同步引擎：把「本地改了什么 / 云端改了什么」跑成实际动作。
 *
 * 触发时机：
 *   - 本地任何 `quiz_app_*` 写入 → 防抖 2 秒后上传
 *   - 页面重新可见 / 窗口获得焦点（30 秒节流）→ 静默检查云端有没有新东西
 *   - 定时轮询（3 分钟，只在页面可见时）
 *   - 设置面板里的「立即同步 / 上传 / 下载」
 *
 * 连接信息（Supabase 地址与密钥）不在前端：每次同步先问自己的后端要一份
 * （`resolveSyncTarget`，进程内缓存），前端只持有同步口令。
 *
 * 冲突（同一行两边都改过）**绝不自动选一边**：进入 conflict 状态，
 * 在设置面板里让用户决定，决定前那一行谁都不动。
 *
 * 拉取到实际变化后会整页刷新一次，而不是逐个去刷新内存里的会话状态——
 * 题目 / 进度在内存里有好几份缓存（BankStore 的解析缓存、两个 Session 的
 * runtime state），刷新是唯一不会漏掉某一处、也不会把「答题到一半」搞成
 * 状态撕裂的做法。只拉到「和本地一样的内容」时不刷新，避免无谓地闪一下。
 */

import { syncConfigStore, type SyncConfigStore } from "./config.svelte";
import { buildSyncPlan, decideBootstrap, type SyncPlan } from "./plan";
import { resolveSyncTarget } from "./relay";
import { SyncClient, SyncError, type SyncPingResult } from "./remote";
import {
  applyRemoteRow,
  clearSyncMeta,
  collectLocalEntries,
  installStorageHook,
  loadSyncMeta,
  onLocalChange,
  readLocal,
  removeLocal,
  saveSyncMeta,
  type LocalEntry,
} from "./storage";
import {
  SYNC_FOCUS_THROTTLE_MS,
  SYNC_POLL_INTERVAL_MS,
  SYNC_PUSH_DEBOUNCE_MS,
  type ConflictResolution,
  type RemoteRowMeta,
  type SyncMeta,
  type SyncStatus,
  type SyncTarget,
  type SyncTransferResult,
} from "./types";

export type SyncMode = "merge" | "push" | "pull";

export interface SyncEvent {
  kind: "synced" | "conflict" | "error";
  message: string;
  result?: SyncTransferResult;
}

export interface SyncOutcome {
  pushed: number;
  pulled: number;
  conflicts: string[];
  /** 拉取是否真的改动了本地内容（决定要不要刷新页面） */
  changedLocal: boolean;
}

const IDLE_OUTCOME: SyncOutcome = {
  pushed: 0,
  pulled: 0,
  conflicts: [],
  changedLocal: false,
};

export class SyncEngine {
  status: SyncStatus = $state({
    phase: "idle",
    message: "还没同步过",
    at: 0,
    remoteCount: 0,
    conflicts: [],
  });

  /** 用户在下一次同步里对冲突的选择（一次性）。 */
  private conflictResolution: ConflictResolution | null = null;
  private running: Promise<SyncOutcome> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unlisten: Array<() => void> = [];
  private lastFocusCheck = 0;
  private listeners = new Set<(event: SyncEvent) => void>();

  constructor(private readonly config: SyncConfigStore = syncConfigStore) {}

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  /** 装上钩子。可重复调用（幂等）。 */
  init(): void {
    if (typeof window === "undefined") return;

    installStorageHook();
    this.unlisten.push(
      onLocalChange(() => {
        this.schedulePush();
      }),
    );

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      this.maybeCheckOnFocus();
    };
    document.addEventListener("visibilitychange", onVisible);
    this.unlisten.push(() =>
      document.removeEventListener("visibilitychange", onVisible),
    );

    window.addEventListener("focus", onVisible);
    this.unlisten.push(() => window.removeEventListener("focus", onVisible));

    const onOnline = () => {
      void this.sync();
    };
    window.addEventListener("online", onOnline);
    this.unlisten.push(() => window.removeEventListener("online", onOnline));

    this.pollTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void this.sync();
    }, SYNC_POLL_INTERVAL_MS);

    this.setStatus("idle", "点「测试连接」开始");
  }

  dispose(): void {
    for (const off of this.unlisten) off();
    this.unlisten = [];
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /** 订阅同步结果（UI 用来弹提示）。 */
  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── 对外动作 ──────────────────────────────────────────────────────────────

  /** 本地改动后的防抖上传。关掉自动同步时是空操作。 */
  schedulePush(): void {
    if (!this.config.value.autoSync) return;
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      // 页面在后台时先不动，等重新可见时那次检查一并处理
      if (document.visibilityState !== "visible") return;
      void this.sync();
    }, SYNC_PUSH_DEBOUNCE_MS);
  }

  /** 双向同步（默认入口）。 */
  sync(): Promise<SyncOutcome> {
    return this.run("merge");
  }

  /** 强制上传：本地覆盖云端，包括冲突的行。 */
  pushLocal(): Promise<SyncOutcome> {
    return this.run("push");
  }

  /** 强制下载：云端覆盖本地，包括冲突的行。 */
  pullRemote(): Promise<SyncOutcome> {
    return this.run("pull");
  }

  /** 冲突时选择「保留本地」。 */
  keepLocal(): Promise<SyncOutcome> {
    this.conflictResolution = "keepLocal";
    return this.run("merge");
  }

  /** 冲突时选择「保留云端」。 */
  keepRemote(): Promise<SyncOutcome> {
    this.conflictResolution = "keepRemote";
    return this.run("merge");
  }

  /** 连接自检：后端 → Supabase → 表，整条链路一次验完。 */
  async testConnection(): Promise<SyncPingResult> {
    this.setStatus("checking", "正在检查连接…");
    const target = this.ensureTarget();
    if (!target) {
      return { ok: false, rowCount: 0, error: this.status.message };
    }

    const result = await this.createClient(target).ping();

    this.status = {
      phase: result.ok ? "idle" : "error",
      message: result.ok
        ? `连接正常 · 云端 ${result.rowCount} 项`
        : (result.error ?? "连接失败"),
      at: Date.now(),
      remoteCount: result.rowCount,
      conflicts: [],
    };
    return result;
  }

  /** 忘记本地同步记录（下次同步按「首次」处理）。不动云端数据。 */
  forgetLocalSyncState(): void {
    clearSyncMeta();
    this.status = {
      phase: "idle",
      message: "已忘记本地同步记录",
      at: Date.now(),
      remoteCount: this.status.remoteCount,
      conflicts: [],
    };
  }

  // ── 内部实现 ──────────────────────────────────────────────────────────────

  /**
   * 拿到可用的同步目标。
   *
   * 纯本地解析：凭据就在这台设备的 localStorage 里，不需要问后端。
   */
  private ensureTarget(): SyncTarget | null {
    const { target, error } = resolveSyncTarget(this.config.value);
    if (!target) {
      this.setStatus("error", error ?? "同步配置不完整");
      return null;
    }
    return target;
  }

  private createClient(target: SyncTarget): SyncClient {
    return new SyncClient({ target });
  }

  private setStatus(phase: SyncStatus["phase"], message: string): void {
    this.status = { ...this.status, phase, message, at: Date.now() };
  }

  private emit(event: SyncEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (e) {
        console.warn("Sync event listener failed:", e);
      }
    }
  }

  private maybeCheckOnFocus(): void {
    if (!this.config.value.autoSync) return;
    const now = Date.now();
    if (now - this.lastFocusCheck < SYNC_FOCUS_THROTTLE_MS) return;
    this.lastFocusCheck = now;
    void this.sync();
  }

  /** 串行化：同一时刻只跑一次同步，后来者复用同一个 promise。 */
  private run(mode: SyncMode): Promise<SyncOutcome> {
    if (this.running) return this.running;
    const task = this.runOnce(mode).finally(() => {
      this.running = null;
    });
    this.running = task;
    return task;
  }

  private async runOnce(mode: SyncMode): Promise<SyncOutcome> {
    this.setStatus(
      "syncing",
      mode === "merge" ? "正在同步…" : mode === "push" ? "正在上传…" : "正在下载…",
    );

    try {
      const target = this.ensureTarget();
      if (!target) return IDLE_OUTCOME;

      const client = this.createClient(target);
      const remote = await client.listRows();
      const local = collectLocalEntries();
      const meta = loadSyncMeta();

      // ── 首次同步：两边都有数据时绝不猜 ──
      if (!meta.bootstrapped && local.length > 0 && remote.length > 0) {
        return await this.bootstrap(client, local, remote);
      }

      const plan = buildSyncPlan({ local, remote, meta });
      return await this.execute(client, plan, local, remote, mode);
    } catch (error) {
      return this.fail(error);
    }
  }

  /**
   * 首次同步：决定「以哪一边为准」，并把它走完。
   *
   * - `same`       → 两边内容本来就一致，只写下基准线
   * - `pullRemote` → 云端为准：先删掉本地独有的行，再把云端整份拉下来
   * - `pushLocal`  → 本地为准：先删掉云端独有的行，再把本地整份推上去
   * - `ask`        → 两边都有数据且内容不同，交给用户拍板（这一轮什么都不做）
   *
   * 这里刻意不复用增量流程：增量是「逐行比时间」，首次同步根本没有基准线可比，
   * 硬套只会绕出一堆特例。
   */
  private async bootstrap(
    client: SyncClient,
    local: LocalEntry[],
    remote: RemoteRowMeta[],
  ): Promise<SyncOutcome> {
    const decision = await this.decideFirstSync(client, local, remote);

    if (decision === "ask") {
      const plan = buildSyncPlan({
        local,
        remote,
        meta: { lastSyncedAt: 0, bootstrapped: false, rows: {} },
      });
      this.reportConflict(plan.conflicts, remote);
      return { ...IDLE_OUTCOME, conflicts: plan.conflicts };
    }

    if (decision === "same") {
      saveSyncMeta(baselineMeta(local, remote));
      this.setStatus("idle", "云端与本地一致");
      return IDLE_OUTCOME;
    }

    const pullByRemote = decision === "pullRemote";
    const localValues = new Map(local.map((entry) => [entry.id, entry.value]));
    const remoteIds = new Set(remote.map((row) => row.id));
    const keepLocalIds = pullByRemote ? remoteIds : new Set(localValues.keys());

    // 云端为准：把云端整份拉下来（本地独有的行随后删掉）
    // 本地为准：云端独有的行推上去，云端多出来的行删掉
    const pullIds = remote
      .filter((row) => pullByRemote || !localValues.has(row.id))
      .map((row) => row.id);
    const pushEntries = local.filter((entry) => !remoteIds.has(entry.id));
    const localDeletes = local.filter((entry) => !keepLocalIds.has(entry.id));
    const remoteDeletes = pullByRemote
      ? []
      : remote.filter((row) => !localValues.has(row.id)).map((row) => row.id);

    const outcome = await this.transfer(client, {
      pullIds,
      pushEntries,
      localDeletes,
      remoteDeletes,
    });

    this.setStatus(
      "idle",
      `首次同步完成 · 上传 ${outcome.pushed} 项 · 下载 ${outcome.pulled} 项`,
    );
    this.emit({
      kind: "synced",
      message: pullByRemote ? "已从云端恢复" : "已把本地数据备份到云端",
      result: { pushed: outcome.pushed, pulled: outcome.pulled },
    });
    if (outcome.changedLocal) this.reloadForAppliedChanges();
    return outcome;
  }

  /**
   * 首次同步的处置。
   *
   * - 只有一边有数据 → 按那一边走（不打扰用户）
   * - 两边数据完全一致 → 只补上基准线，什么也不传
   * - 两边都有且不一致 → 交给用户决定
   */
  private async decideFirstSync(
    client: SyncClient,
    local: LocalEntry[],
    remote: RemoteRowMeta[],
  ): Promise<"pushLocal" | "pullRemote" | "same" | "ask"> {
    const latestLocalAt = local.reduce(
      (max, entry) => Math.max(max, entry.localAt),
      0,
    );

    // 只有行数和 id 都对得上时才值得比内容
    const remoteById = new Map(remote.map((row) => [row.id, row]));
    let allMatch = local.length === remote.length;
    if (allMatch) {
      const ids = local
        .filter((entry) => remoteById.has(entry.id))
        .map((entry) => entry.id);
      const payloads = await client.fetchRows(ids);
      for (const entry of local) {
        const remoteValue = payloads.get(entry.id);
        if (remoteValue === undefined || !sameJson(remoteValue, entry.value)) {
          allMatch = false;
          break;
        }
      }
    }

    const decision = decideBootstrap({
      hasLocalData: local.length > 0,
      hasRemoteData: remote.length > 0,
      localMatchesRemote: allMatch,
      latestLocalAt,
    });

    return decision === null ? "same" : decision;
  }

  /**
   * 执行增量计划。
   *
   * 冲突（同一行两边都改过）在没有用户裁决时原地不动，其余行照常同步。
   * 「保留云端」要把那一行的本地基准线抹掉，否则拉下来之后它又会因为
   * 「本地比基准新」而被判成待上传。
   */
  private async execute(
    client: SyncClient,
    plan: SyncPlan,
    local: LocalEntry[],
    remote: RemoteRowMeta[],
    mode: SyncMode,
  ): Promise<SyncOutcome> {
    let conflicts = plan.conflicts;
    let pullIds = [...plan.pullNew, ...plan.pullUpdated];
    const pushEntries = [...plan.pushNew, ...plan.pushUpdated];

    if (mode === "merge" && conflicts.length > 0) {
      const resolution = this.conflictResolution;
      this.conflictResolution = null;

      if (resolution === null) {
        this.reportConflict(conflicts, remote);
        // 冲突的行原封不动，其余行照常同步
      } else if (resolution === "keepLocal") {
        pushEntries.push(
          ...local.filter((entry) => conflicts.includes(entry.id)),
        );
        conflicts = [];
      } else {
        pullIds = [...pullIds, ...conflicts];
        const meta = loadSyncMeta();
        for (const id of conflicts) delete meta.rows[id];
        saveSyncMeta(meta);
        conflicts = [];
      }
    } else {
      conflicts = [];
    }

    const outcome = await this.transfer(client, {
      pullIds: mode === "push" ? [] : pullIds,
      pushEntries: mode === "pull" ? [] : pushEntries,
      localDeletes: [],
      remoteDeletes: mode === "pull" ? [] : plan.orphans,
    });

    outcome.conflicts = conflicts;
    this.finishStatus(outcome, remote);
    if (outcome.changedLocal) this.reloadForAppliedChanges();
    return outcome;
  }

  /**
   * 真正跑网络动作。顺序固定：先下载 → 再删除 → 最后上传。
   *
   * 「上传的 payload」必须在下载之前就定下来：下载会写 localStorage，
   * 那些写入只会影响「本地修改时间」，绝不能污染这一轮要推上去的内容。
   */
  private async transfer(
    client: SyncClient,
    request: {
      pullIds: string[];
      pushEntries: LocalEntry[];
      /** 本地要删掉的行（云端为准时，本地独有的那些） */
      localDeletes: LocalEntry[];
      /** 云端要删掉的行（本地为准时，云端独有的那些） */
      remoteDeletes: string[];
    },
  ): Promise<SyncOutcome> {
    const outcome: SyncOutcome = { ...IDLE_OUTCOME };
    const meta = loadSyncMeta();
    const now = Date.now();
    const pullIds = [...new Set(request.pullIds)];

    // ── 删除云端独有的行（本地为准时）──
    if (request.remoteDeletes.length > 0) {
      await client.deleteRows(request.remoteDeletes);
      for (const id of request.remoteDeletes) {
        delete meta.rows[id];
        removeLocal(`quiz_app_sync_mtime:${id}`);
      }
    }

    // ── 下载 ──
    if (pullIds.length > 0) {
      // 单独取一次远端元信息：调用方手里的那份可能已经过期
      const remoteRows = await client.listRows();
      const remoteById = new Map(remoteRows.map((row) => [row.id, row]));
      const payloads = await client.fetchRows(pullIds);

      for (const id of pullIds) {
        const payload = payloads.get(id);
        if (payload === undefined) continue;
        const remoteUpdatedAt = remoteById.get(id)?.updatedAt ?? now;
        if (sameJson(payload, readLocal(id))) {
          // 内容一样：只补元数据，不写盘也不触发刷新
          meta.rows[id] = { remoteUpdatedAt, syncedAt: now };
          continue;
        }
        applyRemoteRow(id, payload);
        meta.rows[id] = { remoteUpdatedAt, syncedAt: now };
        outcome.pulled += 1;
        outcome.changedLocal = true;
      }
    }

    // ── 删掉本地独有的行（云端为准时）──
    for (const entry of request.localDeletes) {
      removeLocal(entry.id);
      removeLocal(`quiz_app_sync_mtime:${entry.id}`);
      delete meta.rows[entry.id];
    }

    // ── 上传 ──
    if (request.pushEntries.length > 0) {
      const serverAt = await client.upsertRows(request.pushEntries);
      // 批量 upsert 在同一个事务里跑，所有行的 updated_at 是同一个值；
      // 回执里没带上时间戳的行用这个批量时间兜底，避免退化成「本机现在」——
      // 那会让这一行在下一轮被误判成「云端又改过」。
      const batchAt = serverAt.size > 0 ? Math.max(...serverAt.values()) : now;
      for (const entry of request.pushEntries) {
        meta.rows[entry.id] = {
          remoteUpdatedAt: serverAt.get(entry.id) ?? batchAt,
          syncedAt: now,
        };
        outcome.pushed += 1;
      }
    }

    meta.lastSyncedAt = now;
    meta.bootstrapped = true;
    saveSyncMeta(meta);
    return outcome;
  }

  private finishStatus(outcome: SyncOutcome, remote: RemoteRowMeta[]): void {
    if (outcome.conflicts.length > 0) {
      this.reportConflict(outcome.conflicts, remote);
      return;
    }

    const summary =
      outcome.pushed === 0 && outcome.pulled === 0
        ? "已是最新"
        : `上传 ${outcome.pushed} 项 · 下载 ${outcome.pulled} 项`;

    this.status = {
      phase: "idle",
      message: summary,
      at: Date.now(),
      remoteCount: this.status.remoteCount,
      conflicts: [],
    };

    if (outcome.pushed > 0 || outcome.pulled > 0) {
      this.emit({
        kind: "synced",
        message: summary,
        result: { pushed: outcome.pushed, pulled: outcome.pulled },
      });
    }
  }

  /** 进入冲突状态：冲突的那一行谁都不动，等用户在设置面板里选择。 */
  private reportConflict(ids: string[], remote: RemoteRowMeta[]): void {
    const remoteById = new Map(remote.map((row) => [row.id, row]));
    const meta = loadSyncMeta();
    this.status = {
      phase: "conflict",
      message: `${ids.length} 项两边都改过，需要你选择保留哪一边`,
      at: Date.now(),
      remoteCount: remote.length,
      conflicts: ids.map((id) => ({
        id,
        localAt: meta.rows[id]?.syncedAt ?? 0,
        remoteAt: remoteById.get(id)?.updatedAt ?? 0,
      })),
    };
    this.emit({
      kind: "conflict",
      message: `${ids.length} 项内容两边都改过，请在设置里选择保留哪一边`,
    });
  }

  private fail(error: unknown): SyncOutcome {
    const offline =
      typeof navigator !== "undefined" && navigator.onLine === false;
    const message =
      error instanceof SyncError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    this.status = {
      ...this.status,
      phase: offline ? "offline" : "error",
      message: offline ? "当前离线，联网后会自动重试" : message,
      at: Date.now(),
    };
    if (!offline) this.emit({ kind: "error", message });
    console.warn("Sync failed:", error);
    return IDLE_OUTCOME;
  }

  /**
   * 拉取到实际变化后整页刷新。
   *
   * `changedLocal` 只在真的写入了不同内容时才为真，所以不会出现
   * 「刷新 → 同步 → 刷新」的死循环。
   */
  private reloadForAppliedChanges(): void {
    window.location.reload();
  }
}

/** 把「本地就是云端」记下来，作为后续冲突检测的基准线。 */
export function baselineMeta(
  local: LocalEntry[],
  remote: RemoteRowMeta[],
): SyncMeta {
  const meta = loadSyncMeta();
  const remoteById = new Map(remote.map((row) => [row.id, row]));
  const now = Date.now();
  for (const entry of local) {
    meta.rows[entry.id] = {
      remoteUpdatedAt: remoteById.get(entry.id)?.updatedAt ?? 0,
      syncedAt: now,
    };
  }
  meta.lastSyncedAt = now;
  meta.bootstrapped = true;
  return meta;
}

/**
 * 比较两段 JSON 是否等价。
 *
 * 不能直接比 `JSON.stringify(JSON.parse(x))`：`JSON.parse` 保留键的出现顺序，
 * 所以「同一份数据、键序不同」会被判成不同——那会让同步误以为内容变了，
 * 白白多传一遍、还会多刷新一次页面。这里递归排序键名后再比。
 */
export function sameJson(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  if (a === b) return true;
  try {
    return canonicalJson(JSON.parse(a)) === canonicalJson(JSON.parse(b));
  } catch {
    return false;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** 应用级单例。 */
export const syncEngine = new SyncEngine();
