/**
 * 同步引擎：把「本地改了什么 / 云端改了什么」跑成实际的 Gitee 读写。
 *
 * 触发时机：
 *   - **打开 / 刷新页面**（配好之后）立刻对一次账
 *   - 本地任何 `quiz_app_*` 写入 → 防抖 20 秒后同步（连续写入会一直推后）
 *   - 页面重新可见 / 窗口获得焦点（30 秒节流）→ 静默检查云端有没有新东西
 *   - 定时轮询（3 分钟，只在页面可见时）
 *   - 设置面板里的「立即同步 / 上传 / 下载」
 *
 * **不需要任何服务器**：直接请求 gitee.com 的 API，令牌走 `Authorization` 头。
 *
 * ── 同步单元是「题库」──────────────────────────────────────────────────────
 *
 * 分片文件（`_general.json` + `banks-0..8.json`）只是绕开 Gitee「一条 Gist 最多
 * 10 个文件」的容器。合并、冲突、删除全部按题库逐条判定（见 `merge.ts`），
 * 所以同一片里的题库互不牵连。
 *
 * ── 几条不能违反的规矩 ─────────────────────────────────────────────────────
 *
 * 1. **推上去的内容必须是「应用完拉取之后」重新收集的**，不能拿同步开始时
 *    收集的旧快照去推——线上真出过：新设备把「空壳 general」推上云端，
 *    于是所有设备的题库列表都被清空了。
 * 2. **冲突（同一个题库两边都改过）绝不自动选一边**：进入 conflict 状态，
 *    在设置面板里让用户决定，决定前那个题库（连同它所在的分片）都不动。
 * 3. 拉取到实际变化后会整页刷新一次，而不是逐个去刷新内存里的会话状态——
 *    题目 / 进度在内存里有好几份缓存（BankStore 的解析缓存、两个 Session 的
 *    runtime state），刷新是唯一不会漏掉某一处、也不会把「答题到一半」搞成
 *    状态撕裂的做法。只拉到「和本地一样的内容」时不刷新。
 */

import { STORAGE_KEY_GENERAL } from "@/config";
import {
  buildShardSnapshot,
  collectLocalState,
  filesOfState,
  stableHash,
  type CollectedState,
  type LocalFile,
} from "./collect";
import { syncConfigStore, type SyncConfigStore } from "./config.svelte";
import { GiteeClient, GiteeError, type GistSummary } from "./gitee";
import {
  applyResolution,
  buildRemoteState,
  buildSyncPlan,
  forcePullPlan,
  forcePushPlan,
  type BankAction,
  type RemoteState,
  type SyncPlan,
} from "./merge";
import { decodePayload, encodePayload } from "./payload";
import { describeSyncResult, type SyncTransferSummary } from "./summary";
import {
  applyRemoteValue,
  clearMtime,
  clearSyncMeta,
  installStorageHook,
  loadSyncMeta,
  mtimeOf,
  onLocalChange,
  probeStorageHealth,
  pruneStaleMtimes,
  removeLocal,
  saveSyncMeta,
} from "./storage";
import { resolveSyncTarget } from "./target";
import {
  GIST_GENERAL_FILE,
  SYNC_FOCUS_THROTTLE_MS,
  SYNC_LOCAL_POLL_MS,
  SYNC_POLL_INTERVAL_MS,
  SYNC_PUSH_DEBOUNCE_MS,
  bankRowKey,
  shardFileName,
  shardIndexOf,
  type ConflictResolution,
  type RemoteFile,
  type SyncConflict,
  type SyncMeta,
  type SyncRowMeta,
  type SyncConfig,
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

export interface SyncOutcome extends SyncTransferSummary {
  /** 没能自动解决的冲突（题库 hash） */
  conflicts: string[];
  /** 拉取是否真的改动了本地内容（决定要不要刷新页面） */
  changedLocal: boolean;
}

const IDLE_OUTCOME: SyncOutcome = {
  pushed: 0,
  pulled: 0,
  newOnCloud: 0,
  newLocally: 0,
  removed: 0,
  settingsChanged: false,
  conflicts: [],
  changedLocal: false,
};

/**
 * SHA-1 十六进制。
 *
 * 只用于「不是我们格式的文件」那种兜底哈希——正常路径统一用 `stableHash`
 * （比的是**内容**，不受对象键序影响）。
 */
function sha1Hex(text: string): Promise<string> {
  return crypto.subtle
    .digest("SHA-1", new TextEncoder().encode(text))
    .then((buf) =>
      [...new Uint8Array(buf)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    );
}

export class SyncEngine {
  status: SyncStatus = $state({
    phase: "idle",
    message: "还没同步过",
    at: 0,
    lastSyncAt: 0,
    remoteCount: 0,
    remoteBanks: 0,
    conflicts: [],
  });

  /**
   * 本地有没有还没推上去的东西（头部那个指示点靠它区分黄/绿）。
   *
   * 默认 `true`：没验证过之前一律说「还没同步」，绝不上来就报「已同步」。
   * 本地一写入就置 `true`（便宜），每次同步成功后按真实数据重算
   * （`computePendingChanges`）。
   */
  pendingChanges: boolean = $state(true);

  /**
   * 目标那条例代码片段已经不在了（被删 / 令牌换了账号）。
   *
   * 面板靠它把那条 id 划掉、旁边标「（已被删除）」——**不写一段说明文字**。
   */
  targetMissing: boolean = $state(false);

  /**
   * 这台设备的本地存储写不进去（隐私模式 / 系统拦截）。
   *
   * 那不是「同步坏了」而是「进度根本存不下来」，必须让用户看见，
   * 所以指示点会因此标红（见 `inSync` 与 `AppShell`）。
   */
  storageBlocked: boolean = $state(false);

  /**
   * 是否在用「定时比对本地改动」的兜底（正常设备上永远是 false）。
   *
   * iOS 上见过覆盖 `localStorage.setItem` 不生效：写入照常落盘、但钩子一声不响，
   * 于是指示点永远不变黄、也不会自动上传。这时改用 `SYNC_LOCAL_POLL_MS` 定时比内容。
   */
  localChangeFallback: boolean = $state(false);

  private localPollTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 用户已经答过的冲突裁决：题库 hash → 保留哪一边。
   *
   * 按题库记账而不是「一次性开关」，是因为两次同步之间可能又冒出新的冲突：
   * 一刀切会把用户没见过的冲突也顺手裁决掉，而用户只对他**看见过**的负责。
   */
  private resolutions = new Map<string, ConflictResolution>();
  private running: Promise<SyncOutcome> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unlisten: Array<() => void> = [];
  private lastFocusCheck = 0;
  private listeners = new Set<(event: SyncEvent) => void>();
  /** 上一次报过的冲突 / 错误：一样就不再重复弹提示（轮询每 3 分钟一次，会刷屏） */
  private lastConflictSignature = "";
  private lastErrorSignature = "";

  /**
   * Gitee API 基地址。默认取 `giteeApiBase()`；测试里可以指向本地替身，
   * 这样同一套引擎代码能在不打真网络的情况下跑完整流程。
   */
  private readonly apiBase: string | undefined;

  /** 配置订阅的取消函数；`dispose()` 之后可以重新 `init()` 再订上。 */
  private unsubscribeConfig: (() => void) | null = null;

  constructor(
    private readonly config: SyncConfigStore = syncConfigStore,
    apiBase?: string,
  ) {
    this.apiBase = apiBase;
    // 总开关被关掉 / 重新打开时要立刻收拾内存状态（见 onConfigChanged）。
    // 这件事不依赖 DOM，所以放在构造函数里——测试里造一个引擎就能用。
    this.watchConfig();
  }

  private watchConfig(): void {
    if (this.unsubscribeConfig !== null) return;
    this.unsubscribeConfig = this.config.subscribe((config) =>
      this.onConfigChanged(config),
    );
  }

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  /** 装上钩子。可重复调用（幂等）。 */
  init(): void {
    if (typeof window === "undefined") return;

    // 探针要在注册自己的监听**之前**跑：它自己会写一次探针键，
    // 否则会被当成「本地改动」。
    const health = probeStorageHealth();
    this.storageBlocked = health === "blocked";
    if (health === "silent") this.watchLocalChangesByPolling();
    if (health === "blocked") {
      console.warn(
        "[sync] 这台设备写不了 localStorage：做题进度不会保存，云同步也无法工作",
      );
    }

    installStorageHook();
    this.watchConfig();

    // 「上次同步」是盘上的事实（`quiz_app_sync_meta`），重开页面先把它读进来，
    // 别等这一轮同步跑完才显示
    this.status = {
      ...this.status,
      lastSyncAt: loadSyncMeta().lastSyncedAt,
    };

    this.unlisten.push(
      onLocalChange(() => {
        // 本地一有写入就先标成「还没同步」（这里不做全量比对：每次答题都会
        // 走到这儿，扫一遍所有题库太贵）。同步成功之后再按真实数据重算。
        this.pendingChanges = true;
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
      if (!this.isOn()) return;
      if (document.visibilityState !== "visible") return;
      void this.sync();
    }, SYNC_POLL_INTERVAL_MS);

    this.setStatus("idle", this.idleMessage());
    // 装在钩子之后按真实数据算一次：应用启动时那几次写入（配置规范化 / 迁移）
    // 不该被当成「有改动没同步」——比的是内容，不是 mtime。
    this.pendingChanges = this.computePendingChanges();

    // 打开 / 刷新页面就先对一次账（这就是「每次打开网页都会自动检查」）。
    // 只在真的配好了（令牌 + 自动同步）时才跑，免得白白发请求。
    if (this.isOn() && this.config.value.token.length > 0 && this.config.value.autoSync) {
      void this.sync();
    }
  }

  dispose(): void {
    for (const off of this.unlisten) off();
    this.unlisten = [];
    this.unsubscribeConfig?.();
    this.unsubscribeConfig = null;
    if (this.localPollTimer !== null) clearInterval(this.localPollTimer);
    this.localPollTimer = null;
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    if (this.pollTimer !== null) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  /**
   * 「现在和云端一致吗」——头部指示点用。
   *
   * 两个条件都要满足：上一次同步是正常收尾的（`idle`，而不是正在跑 / 报错 /
   * 离线 / 有冲突），而且本地没有还没推上去的改动。
   */
  get inSync(): boolean {
    // 存储写不进去时永远不算「已同步」——那时候本地数据随时会丢
    if (this.storageBlocked) return false;
    return this.status.phase === "idle" && !this.pendingChanges;
  }

  /** 订阅同步结果（UI 用来弹提示）。 */
  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── 对外动作 ──────────────────────────────────────────────────────────────

  /** 本地改动后的防抖上传。云同步关掉、或关掉自动同步时是空操作。 */
  schedulePush(): void {
    if (!this.isOn()) return;
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

  /** 强制上传：本地覆盖云端，包括冲突的题库。 */
  pushLocal(): Promise<SyncOutcome> {
    return this.run("push");
  }

  /** 强制下载：云端覆盖本地，包括冲突的题库。 */
  pullRemote(): Promise<SyncOutcome> {
    return this.run("pull");
  }

  /** 冲突时选择「保留本地」（只针对面板上列出来的那些题库）。 */
  keepLocal(): Promise<SyncOutcome> {
    return this.resolveConflicts("keepLocal");
  }

  /** 冲突时选择「保留云端」（只针对面板上列出来的那些题库）。 */
  keepRemote(): Promise<SyncOutcome> {
    return this.resolveConflicts("keepRemote");
  }

  /**
   * 记下用户的选择，然后**重新**跑一次同步。
   *
   * 如果此刻正好有一次同步在跑，它已经读过裁决表了——必须先等它结束再跑，
   * 否则用户点了按钮却什么都没发生（裁决还躺在表里等下一轮）。
   */
  private async resolveConflicts(kind: ConflictResolution): Promise<SyncOutcome> {
    for (const conflict of this.status.conflicts) {
      this.resolutions.set(conflict.hash, kind);
    }
    const running = this.running;
    if (running !== null) await running.catch(() => {});
    return this.run("merge");
  }

  /**
   * 盯上一条已有的 Gist（用户在设置里选的）。
   *
   * **会清掉同步记账**：换了云端就等于换了基准，旧的「每个题库同步到哪」
   * 对新云端没有意义；留着还会把整包数据判成冲突。
   */
  selectGist(gistId: string, gistUrl = ""): void {
    this.config.update({ gistId: gistId.trim(), gistUrl: gistUrl.trim() });
    this.targetMissing = false;
    clearSyncMeta();
    this.status = {
      phase: "idle",
      message: "已选定目标仓库",
      at: Date.now(),
      // 换了云端 = 换了基准，旧的「上次同步」不再作数
      lastSyncAt: 0,
      remoteCount: 0,
      remoteBanks: 0,
      conflicts: [],
    };
  }

  /** 丢弃本地记的 Gist ID，下次同步重新建一条云端（不动旧的）。 */
  forgetGist(): void {
    this.config.update({ gistId: "", gistUrl: "" });
    this.clearSyncState("已断开目标仓库");
  }

  /**
   * 把盘上的同步记账（`quiz_app_sync_meta`）也删掉，并把内存状态复位。
   *
   * 「清空配置」走这条：清完记账之后配置本身由面板整个删掉（
   * `syncConfigStore.clear()` 连 localStorage 的键都不留）。**令牌、本地题库与
   * 进度一概不动**——这里只清「上次同步到哪」这本账。
   */
  clearSyncState(message: string): void {
    this.targetMissing = false;
    clearSyncMeta();
    this.status = {
      phase: "idle",
      message,
      at: Date.now(),
      lastSyncAt: 0,
      remoteCount: 0,
      remoteBanks: 0,
      conflicts: [],
    };
  }

  /**
   * 列出账号里的代码片段，供用户挑一条来同步。
   *
   * 需要先有令牌（用草稿令牌也行，所以这里收一个可选参数）。
   */
  async listGists(token?: string): Promise<GistSummary[]> {
    const draft = token?.trim();
    const config = draft
      ? { ...this.config.value, token: draft }
      : this.config.value;
    const { target, error } = resolveSyncTarget(config, this.apiBase);
    if (!target) throw new Error(error ?? "同步配置不完整");
    return await new GiteeClient(target).listGists();
  }

  /**
   * 连接自检：令牌能用吗、云端在不在、里面有几个题库。
   *
   * `draftToken` 是**编辑态里还没保存**的令牌。传了它就完全按草稿走：
   * 不发请求之前先不动配置、也不碰引擎状态——「没点保存就不该生效」，
   * 否则用户在编辑框里试一下就等于把令牌存下来了。
   */
  async testConnection(draftToken?: string): Promise<{
    ok: boolean;
    message: string;
    fileCount: number;
    bankCount: number;
  }> {
    const draft = draftToken?.trim();
    if (draft === undefined) this.setStatus("checking", "正在检查连接…");
    /**
     * 两种自检**不是一回事**：
     *
     *   - 展示模式（不传草稿）：验令牌 **+ 当前目标仓库**还在不在 —— 平时就看这个；
     *   - 编辑模式（传草稿令牌）：**只验令牌**（`gistId: ""`，走列表接口）。
     *
     * 编辑模式绝不能带上旧的 gistId：目标被删的时候，用户正是要换一条，
     * 如果这时候还要求旧目标合法，他就会卡在「测试不通过 → 选不了新的 → 存不了」
     * ——等于把钥匙锁在门里面。
     */
    const target = this.ensureTarget(
      draft === undefined ? undefined : { token: draft, gistId: "" },
    );
    if (!target) {
      return { ok: false, message: this.status.message, fileCount: 0, bankCount: 0 };
    }

    const client = new GiteeClient(target);
    const result = await client.ping();
    let bankCount = 0;

    // 只有「查当前目标」的那种自检才有资格改这个状态位：
    // 草稿自检压根没看目标，不能把它清掉
    if (draft === undefined) this.targetMissing = result.missingTarget === true;

    if (result.ok && result.gist) {
      // 顺手数一下云端有几个题库（同一份响应里就有全部文件内容，不用再请求）
      const remote = buildRemoteState(
        await this.readRemoteFiles(result.gist.files),
      );
      bankCount = remote.banks.size;

      // 令牌与 Gist 都通的情况下顺手回填 id 与它的网页地址。
      // 草稿模式不回填：那些值还没被用户保存过。
      if (draft === undefined) {
        const patch: { gistId?: string; gistUrl?: string } = {};
        if (client.id !== this.config.value.gistId) patch.gistId = client.id;
        if (!this.config.value.gistUrl && result.gist.htmlUrl) {
          patch.gistUrl = result.gist.htmlUrl;
        }
        if (Object.keys(patch).length > 0) this.patchConfig(patch);
      }
    }

    const message = result.ok
      ? result.fileCount > 0
        ? `连接正常 · 云端 ${bankCount} 个题库`
        : "连接正常 · 云端为空"
      : (result.error ?? "连接失败");

    if (draft === undefined) {
      this.status = {
        phase: result.ok ? "idle" : "error",
        message,
        at: Date.now(),
        // 自检不是同步：别让「上次同步」跟着跳（用户会以为它偷偷同步了一次）
        lastSyncAt: this.status.lastSyncAt,
        remoteCount: result.fileCount,
        remoteBanks: bankCount,
        conflicts: [],
      };
    }
    return { ok: result.ok, message, fileCount: result.fileCount, bankCount };
  }

  /**
   * 删掉云端某条代码片段。
   *
   * 面板上每条候选右边那个垃圾桶走这里。删的 id 由调用方给（用户可能正在看
   * 另一条）；`draftToken` 是编辑态里还没保存的令牌——列表就是用它列出来的，
   * 删除也得用同一个，否则第一次配置时（配置里还没有令牌）根本删不动。
   */
  async deleteGist(gistId: string, draftToken?: string): Promise<void> {
    const id = gistId.trim();
    if (!id) return;
    const draft = draftToken?.trim();
    const target = this.ensureTarget(draft ? { token: draft } : undefined);
    if (!target) throw new Error(this.status.message);
    await new GiteeClient({ ...target, gistId: id }).deleteGist();
  }

  // ── 内部实现 ──────────────────────────────────────────────────────────────

  /** 云同步的总开关是否打开。关掉后自动同步与轮询都不跑。 */
  private isOn(): boolean {
    return this.config.value.enabled;
  }

  /** 还没同步过时状态行该显示什么（配好了就不该再出现「点测试连接开始」）。 */
  private idleMessage(): string {
    if (!this.config.value.enabled) return "云同步已关闭";
    if (this.config.value.token.length === 0) return "请先测试连接";
    return "还没同步过";
  }

  /**
   * 解析出同步目标。
   *
   * `override` 用来按**还没保存的草稿**试一次（编辑态里的令牌），
   * 不传就是配置里那份。
   */
  private ensureTarget(override?: Partial<SyncConfig>): SyncTarget | null {
    const config = override ? { ...this.config.value, ...override } : this.config.value;
    const { target, error } = resolveSyncTarget(config, this.apiBase);
    if (!target) {
      this.setStatus("error", error ?? "同步配置不完整");
      return null;
    }
    return target;
  }

  private setStatus(phase: SyncStatus["phase"], message: string): void {
    this.status = { ...this.status, phase, message, at: Date.now() };
  }

  /**
   * 写回配置——**除非配置已经被清空了**。
   *
   * 同步 / 自检跑到一半时用户可能点了「清空配置」（它会连 localStorage 的键一起删）。
   * 那一下必须算数：一个在飞的请求不能把刚删掉的键又写回来。
   * 判据用「开关关着且令牌是空的」——那正是 `clear()` 之后的形状，
   * 而「只是关掉开关」的人令牌还在，回填 gistUrl 这类操作照旧。
   */
  private patchConfig(patch: Partial<SyncConfig>): void {
    if (!this.isOn() && this.config.value.token.length === 0) return;
    this.config.update(patch);
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

  /**
   * 配置变了。
   *
   * 关键的一条：**总开关一关，内存里的同步状态就立刻清干净**——冲突提示、
   * 待裁决、错误信息、排队中的防抖上传。不然会出现「云同步都关了，侧边栏还在
   * 提示有待处理冲突」这种自相矛盾的状态。
   *
   * 注意这里清的是**内存状态**：盘上的 `quiz_app_sync_meta`（「上次同步到哪」的
   * 基准线）与 mtime 都留着——它们是下次打开同步时判断「谁改过」的依据，删掉
   * 只会让下次同步把一切都当成没同步过。要彻底忘掉云端用「清空配置 / 断开云端」，
   * 那条路（`forgetGist`）会连记账一起清掉。
   *
   * 重新打开时按「打开页面」的规格对一次账：冲突如果还在，会重新报出来。
   */
  private onConfigChanged(config: SyncConfig): void {
    if (!config.enabled) {
      this.clearDisabledState();
      return;
    }

    // 之前是关着的（状态还停在 disabled）→ 这是「重新打开」，先对一次账
    if (this.status.phase !== "disabled") return;
    this.setStatus("idle", this.idleMessage());
    if (config.token.length > 0 && config.autoSync) void this.sync();
  }

  /** 关掉总开关：把内存里的同步状态清空（盘上的基准线不动）。 */
  private clearDisabledState(): void {
    this.targetMissing = false;
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.resolutions.clear();
    this.lastConflictSignature = "";
    this.lastErrorSignature = "";

    this.status = {
      phase: "disabled",
      message: "云同步已关闭",
      at: Date.now(),
      lastSyncAt: this.status.lastSyncAt,
      remoteCount: 0,
      remoteBanks: 0,
      conflicts: [],
    };
  }

  /**
   * 钩子不生效时的兜底：定时比一遍「本地和上次同步的基准对不对得上」。
   *
   * 平时用不到（正常浏览器写入就会通知）。只在 `probeStorageHealth()` 报
   * `silent` 时装上，见 `SYNC_LOCAL_POLL_MS` 的说明。
   */
  private watchLocalChangesByPolling(): void {
    this.localChangeFallback = true;
    if (this.localPollTimer !== null) return;
    console.warn(
      "[sync] localStorage 钩子不生效，改用定时比对本地改动（iOS 上踩过）",
    );
    this.localPollTimer = setInterval(() => {
      this.pollLocalChanges();
    }, SYNC_LOCAL_POLL_MS);
  }

  /** 兜底轮询的一次检查：本地脏了就标黄并排队上传。 */
  private pollLocalChanges(): void {
    if (!this.isOn()) return;
    if (document.visibilityState !== "visible") return;
    if (!this.computePendingChanges()) return;
    this.pendingChanges = true;
    this.schedulePush();
  }

  private maybeCheckOnFocus(): void {
    if (!this.isOn()) return;
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

  /** 收集本地文件，顺便清掉已删除键留下的 mtime。 */
  private collectLocal(): CollectedState {
    pruneStaleMtimes();
    return collectLocalState(mtimeOf);
  }

  /**
   * 把 Gitee 的文件内容解成 `RemoteFile`。
   *
   * 哈希算在**解码后的内容**上，不是压缩后的字符串上——因为要和本地快照的
   * `stableHash` 比，两侧必须是同一套口径（不然「内容其实一样」永远比不出来，
   * 就会退化成只看 mtime，而 mtime 会把「应用启动时规范化了配置」误判成改动）。
   *
   * 解不出来的文件（不是我们的格式）回落到对原始字符串取哈希：那种文件本来就
   * 只该被跳过，哈希只用来判断「云端这份变没变」。
   */
  private async readRemoteFiles(
    files: Map<string, string>,
  ): Promise<RemoteFile[]> {
    const result: RemoteFile[] = [];
    for (const [name, content] of files) {
      const json = await decodePayload(content);
      let hash: string;
      if (json === null) {
        hash = await sha1Hex(content);
      } else {
        try {
          hash = stableHash(JSON.parse(json));
        } catch {
          hash = await sha1Hex(content);
        }
      }
      result.push({ name, hash, json });
    }
    result.sort((a, b) => (a.name < b.name ? -1 : 1));
    return result;
  }

  private async runOnce(mode: SyncMode): Promise<SyncOutcome> {
    // 总开关关着就什么都不做。别指望调用方都记得判断：`online` 事件、
    // 组件里的按钮、还有关开关那一瞬间已经排上队的防抖任务都会走到这里。
    if (!this.isOn()) {
      this.setStatus("disabled", "云同步已关闭");
      return IDLE_OUTCOME;
    }

    this.setStatus(
      "syncing",
      mode === "merge" ? "正在同步…" : mode === "push" ? "正在上传…" : "正在下载…",
    );

    try {
      const target = this.ensureTarget();
      if (!target) return IDLE_OUTCOME;

      const client = new GiteeClient(target);
      const local = this.collectLocal();

      // ── 还没有云端：建一条，把本地推上去 ──
      if (!client.id) {
        if (local.banks.size === 0 && !local.generalHasEdits) {
          this.setStatus("idle", "本地暂无题库");
          return IDLE_OUTCOME;
        }
        const files = filesOfState(local);
        const gist = await client.createGist(await this.encodeAll(files));
        this.targetMissing = false;
        this.patchConfig({ gistId: gist.id, gistUrl: gist.htmlUrl });
        saveSyncMeta(baselineMeta(local, gist.updatedAt));
        const outcome: SyncOutcome = {
          ...IDLE_OUTCOME,
          pushed: local.banks.size,
          // 云端刚建出来，这些题库对它来说全是「新增」
          newOnCloud: local.banks.size,
        };
        this.finishStatus(outcome, gist.files.size, local.banks.size);
        this.emit({
          kind: "synced",
          message: "已备份到云端",
          result: { pushed: outcome.pushed, pulled: 0 },
        });
        return outcome;
      }

      const gist = await client.getGist();
      if (!gist) {
        // 目标没了：卡片上会把那条 id 划掉标「已被删除」，这里只留一句给通知用的话
        this.targetMissing = true;
        this.setStatus("error", "目标仓库不存在");
        return IDLE_OUTCOME;
      }
      this.targetMissing = false;
      // 老版本只存过 id，顺手把网页地址补上（避免自己拼用户名拼错）
      if (!this.config.value.gistUrl && gist.htmlUrl) {
        this.patchConfig({ gistUrl: gist.htmlUrl });
      }

      const remote = buildRemoteState(await this.readRemoteFiles(gist.files));
      const meta = loadSyncMeta();

      let plan =
        mode === "push"
          ? forcePushPlan(local, remote, meta)
          : mode === "pull"
            ? forcePullPlan(local, remote, meta)
            : buildSyncPlan({ local, remote, meta });

      // ── 冲突裁决 ──
      //
      // 只要还有**没裁决**的冲突，这一轮就什么都不做：不拉、不推、不改本地
      // （所以也不会整页刷新），只把冲突摆到面板上问用户。
      // 早期版本会「冲突的题库不动、其余照常同步」，于是拉到别的题库之后
      // 立刻 `location.reload()`——冲突提示跟着内存状态一起没了，用户看到的
      // 就是「还没选就自己刷过去了」。宁可停一轮，也不能让用户的选择落空。
      if (mode === "merge" && plan.conflicts.length > 0) {
        // 把用户已经答过的那些裁决应用上去；用户没答过的仍然是 conflict
        plan = applyResolution(plan, this.resolutions);
        if (plan.conflicts.length > 0) {
          this.reportConflict(plan.conflicts, gist.files.size, remote.banks.size);
          // 裁决表**留着**：用户对「题库一」的选择不能因为这一轮又冒出
          // 「题库二」的新冲突而作废，等他答完题库二，两者一起生效。
          return {
            ...IDLE_OUTCOME,
            conflicts: plan.conflicts.map((conflict) => conflict.hash),
          };
        }
      }

      const outcome = await this.execute({
        client,
        plan,
        remote,
        meta,
        remoteUpdatedAt: gist.updatedAt,
        remoteFileCount: gist.files.size,
      });

      // 这一轮真的执行完了，裁决才算用掉。留着的话，同一个题库以后**再次**
      // 两边都改过时会被上一次的答案悄悄裁决掉——用户没见过那次冲突。
      this.resolutions.clear();
      return outcome;
    } catch (error) {
      return this.fail(error);
    }
  }

  /** 把本地文件编码成 Gitee 的文件表。 */
  private async encodeAll(
    local: readonly LocalFile[],
  ): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const file of local) {
      result[file.name] = await encodePayload(file.snapshot);
    }
    return result;
  }

  /**
   * 执行计划。顺序固定：**先拉取 → 再删云端垃圾 → 最后按「拉取之后」的本地
   * 状态重建分片上传**。
   *
   * 最后一步的顺序是关键：推上去的必须是应用完拉取之后重新收集的内容。
   * 拿同步开始时那份旧快照去推，就会把刚拉下来的东西又推回旧版本
   * （线上踩过：新设备拿空壳 general 覆盖了云端的题库列表）。
   */
  private async execute(ctx: {
    client: GiteeClient;
    plan: SyncPlan;
    remote: RemoteState;
    meta: SyncMeta;
    remoteUpdatedAt: number;
    remoteFileCount: number;
  }): Promise<SyncOutcome> {
    const { client, plan, remote, meta } = ctx;
    const now = Date.now();
    // 走到这里说明**所有**冲突都已裁决（没裁决的在上一步就 return 了），
    // 所以不会出现「一边有冲突一边还在写数据」的情况。
    const outcome: SyncOutcome = { ...IDLE_OUTCOME };

    // ── ① general 先落地，再落题库 ──
    //
    // 顺序不能反：题库列表在 general 里，先落题库会出现「内容在、列表里没有」
    // 的中间态（侧边栏是题库的唯一入口，那个中间态看起来就像丢数据）。
    if (plan.generalChangedLocal) {
      applyRemoteValue(STORAGE_KEY_GENERAL, JSON.stringify(plan.general));
      outcome.changedLocal = true;
    }

    for (const action of plan.actions) {
      if (action.verdict === "pull") {
        const bank = remote.banks.get(action.hash);
        if (!bank) continue;
        writeBankLocally(bank);
        outcome.changedLocal = true;
      } else if (action.verdict === "deleteLocal") {
        removeBankLocally(action.hash);
        outcome.changedLocal = true;
      }
    }

    // ── ② 回收云端的垃圾文件（空分片 / 旧格式残留）──
    let fileCount = ctx.remoteFileCount;
    if (plan.deleteRemoteFiles.length > 0) {
      await client.deleteFiles(plan.deleteRemoteFiles);
      fileCount -= plan.deleteRemoteFiles.length;
    }

    // ── ③ 按「拉取之后」的本地状态重建要上传的分片 ──
    const after = this.collectLocal();
    const uploads: Record<string, string> = {};
    for (const index of plan.pushShards) {
      const name = shardFileName(index);
      const banks = [...after.banks.values()].filter((bank) => bank.shard === index);
      if (banks.length === 0) continue;
      const snapshot = buildShardSnapshot(banks);
      const remoteFile = remote.files.find((file) => file.name === name);
      // 内容没变就不传（同片的别的题库可能刚好把内容凑回原样）
      if (remoteFile !== undefined && stableHash(snapshot) === remoteFile.hash) {
        continue;
      }
      uploads[name] = await encodePayload(snapshot);
    }
    if (plan.generalPush) {
      uploads[GIST_GENERAL_FILE] = await encodePayload(after.general);
    }

    if (Object.keys(uploads).length > 0) {
      const gist = await client.updateFiles(uploads);
      fileCount = gist.files.size;
    }

    // ── ④ 记基准线 ──
    saveSyncMeta(
      nextMeta({
        previous: meta,
        state: after,
        plan,
        remoteUpdatedAt: ctx.remoteUpdatedAt,
        now,
      }),
    );

    // 这一轮到底动了什么——四个数互斥：新题库只算「新增」，不算「上传 / 下载」。
    // 冲突冻住的分片不算（`settledThisRound`），和基准线的写法保持一致。
    for (const action of plan.actions) {
      if (!settledThisRound(plan, action)) continue;
      switch (action.verdict) {
        case "push":
          outcome.pushed += 1;
          // 云端原来没有这个题库 = 这台设备新导入的
          if (action.remoteHash === undefined) outcome.newOnCloud += 1;
          break;
        case "pull":
          outcome.pulled += 1;
          // 本地原来没有 = 别的设备新导入的
          if (action.localHash === undefined) outcome.newLocally += 1;
          break;
        case "deleteLocal":
        case "deleteRemote":
          outcome.removed += 1;
          break;
        default:
          break;
      }
    }
    outcome.settingsChanged = plan.settingsChanged;

    this.finishStatus(outcome, fileCount, remoteBankCount(plan));
    if (outcome.changedLocal) this.reloadForAppliedChanges();
    return outcome;
  }

  private finishStatus(
    outcome: SyncOutcome,
    remoteCount: number,
    remoteBanks: number,
  ): void {
    if (outcome.conflicts.length > 0) return; // reportConflict 已经写过状态

    // 走到这里说明这一轮正常收尾了：按真实数据重算「还有没有没推上去的东西」
    this.pendingChanges = this.computePendingChanges();

    const summary = describeSyncResult(outcome);

    this.status = {
      phase: "idle",
      message: summary,
      at: Date.now(),
      lastSyncAt: Date.now(),
      remoteCount,
      remoteBanks,
      conflicts: [],
    };
    this.lastConflictSignature = "";
    this.lastErrorSignature = "";

    // 「设置也动了」也算同步出了结果——否则拖一下顺序同步完，事件里什么都不报
    if (
      outcome.pushed > 0 ||
      outcome.pulled > 0 ||
      outcome.removed > 0 ||
      outcome.settingsChanged
    ) {
      this.emit({
        kind: "synced",
        message: summary,
        result: { pushed: outcome.pushed, pulled: outcome.pulled },
      });
    }
  }

  /**
   * 进入冲突状态：冲突的题库谁都不动，等用户在设置面板里选择。
   *
   * 冲突的单位是**题库**（不是分片文件），提示里直接写题库名。
   * 同一个冲突反复出现时不重复弹提示——轮询每 3 分钟一次，会刷屏。
   */
  private reportConflict(
    conflicts: readonly BankAction[],
    remoteCount: number,
    remoteBanks: number,
  ): void {
    const signature = conflicts
      .map((conflict) => conflict.hash)
      .sort()
      .join(",");

    this.status = {
      phase: "conflict",
      message: `${conflicts.length} 个题库存在冲突`,
      at: Date.now(),
      // 冲突这一轮什么都没写，当然也不算「同步过」
      lastSyncAt: this.status.lastSyncAt,
      remoteCount,
      remoteBanks,
      conflicts: conflicts.map(toConflict),
    };

    if (signature !== this.lastConflictSignature) {
      this.lastConflictSignature = signature;
      this.emit({
        kind: "conflict",
        message: `${conflicts.length} 个题库存在冲突`,
      });
    }
  }

  private fail(error: unknown): SyncOutcome {
    const offline =
      typeof navigator !== "undefined" && navigator.onLine === false;
    const message =
      error instanceof GiteeError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    this.status = {
      ...this.status,
      phase: offline ? "offline" : "error",
      message: offline ? "当前离线" : message,
      at: Date.now(),
    };
    if (!offline && message !== this.lastErrorSignature) {
      this.lastErrorSignature = message;
      this.emit({ kind: "error", message });
    }
    console.warn("Sync failed:", error);
    return IDLE_OUTCOME;
  }

  /**
   * 本地和「上次同步成功的基准」比，有没有对不上的地方。
   *
   * 比的是**内容哈希**而不是 mtime：应用启动时会把配置 / 进度原样重写一遍，
   * mtime 永远是新鲜的，只看 mtime 会让指示点一直黄着。
   * 只在同步收尾时调用（要遍历一遍本地题库，不适合每次写入都跑）。
   */
  private computePendingChanges(): boolean {
    const meta = loadSyncMeta();
    const local = collectLocalState(mtimeOf);

    // 从来没同步成功过 → 当然还没同步
    if (meta.generalBaseline === null) return true;
    if (stableHash(local.general) !== stableHash(meta.generalBaseline)) return true;

    const seen = new Set<string>();
    for (const bank of local.banks.values()) {
      const key = bankRowKey(bank.hash);
      seen.add(key);
      const row = meta.rows[key];
      // 没有基准 = 这个题库还没上去过；内容不一样 = 同步之后又改了
      if (row === undefined || row.remoteHash !== bank.contentHash) return true;
    }

    // 记账里还有、本地已经没有的题库 = 删除还没推到云端
    for (const key of Object.keys(meta.rows)) {
      if (key.startsWith("bank:") && !seen.has(key)) return true;
    }

    return false;
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

/**
 * 同步之后云端一共有几个题库。
 *
 * 不能直接用本地题库数：被冲突冻住的分片里，「本地已删、云端还在」的题库
 * 这一轮不会从云端消失，直接数本地会少报。
 */
function remoteBankCount(plan: SyncPlan): number {
  return plan.actions.filter((action) => {
    if (action.verdict === "deleteRemote") {
      // 没能删掉（分片被冲突冻住）→ 云端那份还在
      return !settledThisRound(plan, action);
    }
    if (action.verdict === "deleteLocal") return false; // 云端本来就没有
    return true;
  }).length;
}

/**
 * 这个题库这一轮真的对齐了吗？
 *
 * 「要上传」和「真的传上去了」不是一回事：含未裁决冲突的分片整体冻结，
 * 同一片里别的题库这一轮也就没上去——这时候绝不能给它写新基准线，
 * 否则下一次同步会把它误判成「云端改过」而把本地改动悄悄拉掉。
 */
function settledThisRound(plan: SyncPlan, action: BankAction): boolean {
  switch (action.verdict) {
    case "conflict":
      return false;
    case "push":
    case "deleteRemote":
      return plan.pushShards.includes(shardIndexOf(action.hash));
    default:
      return true;
  }
}

/**
 * `BankAction` → 给 UI 看的冲突条目。
 *
 * 冲突的单位是题库，所以提示里直接写题库名——用户看到 `banks-3.json`
 * 根本不知道自己在选什么。
 */
function toConflict(action: BankAction): SyncConflict {
  return {
    hash: action.hash,
    name: action.name,
    detail: "这个题库本机和云端都改过",
    localAt: action.localAt,
    remoteHash: action.remoteHash ?? "",
  };
}

// ── 落盘 ────────────────────────────────────────────────────────────────────

/**
 * 把一个题库写进 localStorage（拉取用）。
 *
 * 拉取**不碰 mtime**（见 `applyRemoteValue`）：这份内容来自云端，
 * 不是这台设备改的，记成「本地改动」会让下一次同步白推一遍甚至撞成冲突。
 */
function writeBankLocally(bank: {
  hash: string;
  snapshot: { questions: unknown[]; state?: unknown };
}): void {
  const questionsKey = `quiz_app_questions_${bank.hash}`;
  const stateKey = `quiz_app_state_${bank.hash}`;

  applyRemoteValue(questionsKey, JSON.stringify(bank.snapshot.questions));
  if (bank.snapshot.state === undefined) {
    // 云端这份没有进度 = 就是没有进度（跟着云端走，别留一份孤儿进度）
    removeLocal(stateKey);
  } else {
    applyRemoteValue(stateKey, JSON.stringify(bank.snapshot.state));
  }
  clearMtime(questionsKey);
  clearMtime(stateKey);
}

/** 删掉本地一个题库的题目与进度。 */
function removeBankLocally(hash: string): void {
  removeLocal(`quiz_app_questions_${hash}`);
  removeLocal(`quiz_app_state_${hash}`);
  clearMtime(`quiz_app_questions_${hash}`);
  clearMtime(`quiz_app_state_${hash}`);
}

/** 「本地就是云端」时的基准线（第一次创建云端之后写一次）。 */
function baselineMeta(state: CollectedState, remoteUpdatedAt: number): SyncMeta {
  const now = Date.now();
  const rows: Record<string, SyncRowMeta> = {};
  for (const bank of state.banks.values()) {
    rows[bankRowKey(bank.hash)] = {
      remoteHash: bank.contentHash,
      syncedAt: now,
      remoteUpdatedAt,
      shard: bank.shard,
    };
  }
  return {
    lastSyncedAt: now,
    bootstrapped: true,
    rows,
    generalBaseline: state.general,
  };
}

/**
 * 同步成功之后更新基准线。
 *
 * 只给「这次真的对齐了的」题库写新基准：冲突中的题库保持旧基准，
 * 否则下一次同步会误判成「云端改过」而把本地改动悄悄拉掉。
 * 已经删掉的题库连同它的行一起清掉。
 */
function nextMeta(params: {
  previous: SyncMeta;
  state: CollectedState;
  plan: SyncPlan;
  remoteUpdatedAt: number;
  now: number;
}): SyncMeta {
  const { previous, state, plan, remoteUpdatedAt, now } = params;
  const rows: Record<string, SyncRowMeta> = { ...previous.rows };

  for (const action of plan.actions) {
    const key = bankRowKey(action.hash);
    const bank = state.banks.get(action.hash);
    switch (action.verdict) {
      case "pull":
      case "push":
        if (!settledThisRound(plan, action)) break; // 分片被冲突冻住了，保持旧基准
        if (bank === undefined) {
          delete rows[key];
          break;
        }
        rows[key] = {
          remoteHash: bank.contentHash,
          syncedAt: now,
          remoteUpdatedAt,
          shard: bank.shard,
        };
        break;
      case "skip":
        // 两边内容一样，基准线怎么写都不会错
        if (bank !== undefined) {
          rows[key] = {
            remoteHash: bank.contentHash,
            syncedAt: now,
            remoteUpdatedAt,
            shard: bank.shard,
          };
        }
        break;
      case "deleteLocal":
      case "deleteRemote":
        if (!settledThisRound(plan, action)) break;
        delete rows[key];
        break;
      case "conflict":
        // 保持旧基准，等用户裁决
        break;
    }
  }

  // 本地已经不存在的题库（以及老格式遗留的分片行）不再留着
  for (const key of Object.keys(rows)) {
    if (key === GIST_GENERAL_FILE) {
      delete rows[key];
      continue;
    }
    if (!key.startsWith("bank:")) {
      // 老格式（banks-N.json）的行：新格式写完之后就没用了
      delete rows[key];
      continue;
    }
    const hash = key.slice("bank:".length);
    if (!state.banks.has(hash) && !plan.conflicts.some((c) => c.hash === hash)) {
      delete rows[key];
    }
  }

  return {
    lastSyncedAt: now,
    bootstrapped: true,
    rows,
    generalBaseline: state.general,
  };
}

/** 应用级单例。 */
export const syncEngine = new SyncEngine();
