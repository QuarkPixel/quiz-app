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
 * 2. **本地默认是只读的**：只有"云端确实包含本地没有的内容"时才写本地
 *    （`BankSyncKind` 里的 `download` / `reconcile` / `remove-local`）。
 *    `upload` 那一支不许碰进度——这正是"我在同一台设备上做题，云端不该反过来
 *    覆盖我"的落点。判定只看内容，不看 mtime（见 `decision.ts`）。
 * 3. **冲突绝不自动选一边**：题目分叉且两边都改过时进入 conflict，弹窗 + 设置
 *    面板让用户选，决定前那个题库（连同它所在的分片）都不动。
 * 4. **云端要写本地、但用户正在做这个题库 → 先问一句**（`SyncPromptState` 的
 *    `remote-write`）。没在做就静默落地，不弹。
 * 5. **落盘之后不整页刷新**：写入走 `applyRemoteValue`，它广播键名
 *    （`@/lib/storageBus`），持有内存副本的（两个 Session / BankStore /
 *    GlobalSettingsStore）各自重读。以前那一版在这里 `location.reload()`，
 *    正在答题的人会看到页面自己跳一下，作答草稿与滚动位置一起丢——那是用
 *    暴力掩盖「内存与盘上没有通道」这件事，不是设计。
 *
 * ── 状态怎么表示 ───────────────────────────────────────────────────────────
 *
 * 以前「同步现在处于什么状况」是 `status.phase` 加上**四个独立布尔**拼的：
 *
 *   `pendingChanges` / `targetMissing` / `storageBlocked` / `localChangeFallback`
 *
 * 四个布尔能拼出 16 种组合，而真实存在的只有几种：探针只会给出一种存储结论，
 * 所以「存储写不进去」和「钩子不通知」不可能同时成立；「正在 push」和「目标已
 * 删除」同时说，读的人不知道该信哪句。此前全靠调用方的 `&&` 兜着——`inSync`
 * 里那条 `!storageBlocked &&` 就是在防「存储坏了还显示已同步」。
 *
 * 现在真相收在三个小联合里（见 `./indicator`）：`delta`（本地差多少，三态）、
 * `target`（目标还在不在，三态）、`storage`（存储能不能写，三态互斥）。
 * 对外那四个字段变成它们的**只读投影**，名字 / 类型 / 语义一个没变
 * （`pendingChanges` / `targetMissing` 另留了 setter：外部会直接给引擎摆姿势，
 * 写进来也只是换个联合值，仍然是同一份真相）：
 *
 *   pendingChanges  ← delta !== "clean"      （`unknown` 也算，宁可说还没同步）
 *   targetMissing   ← target === "missing"
 *   storageBlocked  ← storage === "blocked"
 *   localChangeFallback ← storage === "hook-silent"
 *
 * 再加一个 `indicator` getter，把「指示点为什么是这个颜色」压成一支判别联合，
 * `inSync` 就是它的 `kind === "synced"`——颜色只在一个地方算，UI 不必再排一遍
 * 优先级，也就不会排出「红点配着已同步文案」这种组合。
 *
 * `status` 仍是独立的一份**操作记录**（phase / message / at / lastSyncAt /
 * 三个计数 / conflicts），没有并进联合：它记的是「上一次操作干了什么」，
 * 而上面那三个联合记的是「世界现在是什么样」，两者生命周期不同
 * （自检也会写 `status`，却不改 delta / target 的判定基准）。
 */

import { STORAGE_KEY_GENERAL } from "@/config";
import {
  bankFullHash,
  buildShardSnapshot,
  collectLocalState,
  filesOfState,
  stableHash,
  type CollectedState,
  type LocalFile,
} from "./collect";
import { syncConfigStore, type SyncConfigStore } from "./config.svelte";
import { GiteeClient, GiteeError, type GistSummary } from "./gitee";
import { buildRemoteState, remoteReadDamage } from "./remote";
import {
  applyResolution,
  buildSyncPlan,
  forcePullPlan,
  forcePushPlan,
} from "./planner";
import type { RemoteState, SyncPlan } from "./types";
import {
  applyRemoteState,
  baselineMeta,
  ensureLibraryEntry,
  nextMeta,
  pruneConflictSeen,
  remoteBankCount,
  removeBankLocally,
  saveConflictSeen,
  settledThisRound,
  toConflict,
  writeBankLocally,
} from "./localwrite";
import {
  deltaAfterCheck,
  indicatorOf,
  inSyncOf,
  localChangeFallbackOf,
  pendingChangesOf,
  storageBlockedOf,
  storageHealthFromProbe,
  targetAfterProbe,
  targetMissingOf,
  type LocalDelta,
  type StorageHealth,
  type SyncIndicator,
  type TargetState,
} from "./indicator";
import { decodePayload, encodePayload } from "./payload";
import { describeSyncResult, type SyncTransferSummary } from "./summary";
import {
  applyRemoteValue,
  clearMtime,
  isSyncableKey,
  clearSyncMeta,
  installStorageHook,
  loadSyncMeta,
  mtimeOf,
  onLocalChange,
  probeStorageHealth,
  pruneStaleMtimes,
  saveSyncMeta,
} from "./storage";
import { resolveSyncTarget } from "./target";
import {
  SYNC_FOCUS_THROTTLE_MS,
  SYNC_LOCAL_POLL_MS,
  SYNC_POLL_INTERVAL_MS,
  SYNC_PUSH_DEBOUNCE_MS,
} from "@/config";
import {
  GIST_GENERAL_FILE,
  actionWritesLocal,
  bankRowKey,
  shardFileName,
  type BankAction,
  type ConflictResolution,
  type RemoteFile,
  type SyncMeta,
  type SyncConfig,
  type SyncPromptState,
  type SyncStatus,
  type SyncTarget,
  type SyncTransferResult,
} from "./types";
import { activeWork } from "./activeWork.svelte";
import { debugLog } from "@/lib/debug";

export type SyncMode = "merge" | "push" | "pull";

export interface SyncEvent {
  kind: "synced" | "conflict" | "error";
  message: string;
  result?: SyncTransferResult;
}

export interface SyncOutcome extends SyncTransferSummary {
  /** 没能自动解决的冲突（题库 hash） */
  conflicts: string[];
  /**
   * 这一轮本该写本地、但用户正在做那些题库而**暂时没写**（等他在弹窗里确认）。
   *
   * 和 `conflicts` 分开：冲突要选"留哪边"，这里只是"现在写还是等会儿"。
   */
  awaiting: string[];
  /** 有几份题库是「题目一样、进度两边都动过」自动合起来的 */
  progressMerged: number;
}

const IDLE_OUTCOME: SyncOutcome = {
  progressMerged: 0,
  pushed: 0,
  pulled: 0,
  newOnCloud: 0,
  newLocally: 0,
  removed: 0,
  settingsChanged: false,
  conflicts: [],
  awaiting: [],
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
   * 本地和「上次同步成功的基准」差多少（`pendingChanges` 的真相）。
   *
   * 默认 `unknown`：没验证过之前一律说「还没同步」，绝不上来就报「已同步」。
   * 本地一写入就置 `dirty`（便宜），每次同步成功后按真实数据重算
   * （`computePendingChanges`）。**唯一的写入口是 `markDelta`**。
   */
  private delta: LocalDelta = $state("unknown");

  /**
   * 目标仓库还在不在（`targetMissing` 的真相）。
   *
   * `unverified` 不是「还在」：换了目标 / 清空记账之后我们并不知道那条 Gist
   * 是否还存在，只是没有证据说它没了。**唯一的写入口是 `markTarget`**。
   */
  private target: TargetState = $state("unverified");

  /**
   * 本机存储能不能写（`storageBlocked` 与 `localChangeFallback` 的真相）。
   *
   * 三态互斥：探针只会给出一种结论，「既写不进去又只是钩子不生效」在类型上
   * 就不成立。**唯一的写入口是 `markStorage`**（只在 `init` 的探针那里调）。
   */
  private storage: StorageHealth = $state("ok");

  /**
   * 本地有没有还没推上去的东西（头部那个指示点靠它区分黄/绿）。
   *
   * 只读投影：真相是 `delta`。`set` 留着是因为**外部会直接把它摆成某个值**
   * （测试按「刚打开页面 / 上次同步成功」给引擎摆姿势）——写进来也只是换个
   * `delta`，仍然只有一份真相，不存在「字段和状态各说各话」。
   */
  get pendingChanges(): boolean {
    return pendingChangesOf(this.delta);
  }

  set pendingChanges(value: boolean) {
    this.markDelta(value ? "dirty" : "clean");
  }

  /**
   * 目标那条例代码片段已经不在了（被删 / 令牌换了账号）。
   *
   * 面板靠它把那条 id 划掉、旁边标「（已被删除）」——**不写一段说明文字**。
   * 同上：只读投影，`set` 只给外部摆姿势用（`targetMissing = true` 等价于
   * 「已确认它没了」）。
   */
  get targetMissing(): boolean {
    return targetMissingOf(this.target);
  }

  set targetMissing(value: boolean) {
    this.markTarget(value ? "missing" : "unverified");
  }

  /**
   * 这台设备的本地存储写不进去（隐私模式 / 系统拦截）。
   *
   * 那不是「同步坏了」而是「进度根本存不下来」，必须让用户看见，
   * 所以指示点会因此标红（见 `indicator` 与 `AppShell`）。
   * **没有 setter**：它是探针的结论，外部改不了（改了也没有意义）。
   */
  get storageBlocked(): boolean {
    return storageBlockedOf(this.storage);
  }

  /**
   * 是否在用「定时比对本地改动」的兜底（正常设备上永远是 false）。
   *
   * iOS 上见过覆盖 `localStorage.setItem` 不生效：写入照常落盘、但钩子一声不响，
   * 于是指示点永远不变黄、也不会自动上传。这时改用 `SYNC_LOCAL_POLL_MS` 定时比内容。
   * 它和 `storageBlocked` 是同一根探针的两个互斥结论，所以共用 `storage`。
   */
  get localChangeFallback(): boolean {
    return localChangeFallbackOf(this.storage);
  }

  // ── 三个联合的写入口 ──────────────────────────────────────────────────────
  //
  // 集中在这里，是为了让「这个字段还能被谁改」只有一个答案。它们都不做判断，
  // 只负责写——判断留给调用点（探针 / 比对 / 自检），因为只有那里知道依据是什么。

  /** 记下「本地和基准差多少」。 */
  private markDelta(next: LocalDelta): void {
    this.delta = next;
  }

  /** 记下「目标仓库还在不在」。 */
  private markTarget(next: TargetState): void {
    this.target = next;
  }

  /** 记下「本机存储能不能写」（只在 `init` 的探针那里调用）。 */
  private markStorage(next: StorageHealth): void {
    this.storage = next;
  }

  private localPollTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * 用户已经答过的冲突裁决：题库 hash → 保留哪一边。
   *
   * 按题库记账而不是「一次性开关」，是因为两次同步之间可能又冒出新的冲突：
   * 一刀切会把用户没见过的冲突也顺手裁决掉，而用户只对他**看见过**的负责。
   */
  private resolutions = new Map<string, ConflictResolution>();

  /**
   * 需要用户拍板的一件事（**只有两支**，见 `SyncPromptState`）。
   *
   * 弹窗由 `SyncPromptDialog` 渲染，引擎只负责"什么时候该问"：
   *   - 真正的冲突（题目分叉、两边都改过）→ `conflict`；
   *   - 云端有本地没有的内容、要写本地，但用户**正在做**这个题库 → `remote-write`。
   *
   * 其余情况一律不弹：云端更新而用户没在做 → 直接落地；本地是超集 → 只上传。
   */
  prompt: SyncPromptState | null = $state(null);

  /**
   * 用户对「现在覆盖本地」点过头的题库。
   *
   * 只对**当前这一轮**有效：执行完（成功或失败）就清空，下一轮重新判断。
   * 不能长期留着——那等于替用户把以后每一次覆盖都预先答应了。
   */
  private approvedWrites = new Set<string>();

  /**
   * 用户点了「稍后」的题库。
   *
   * 只要用户还在做这个题库就不再问（也不会写本地 / 上传，见 `runOnce`）；
   * 一旦不在做了，下一次同步按「云端更新、用户没在用」静默落地。
   * 这样既不会每 3 分钟弹一次，也不会把用户的选择悬在半空。
   */
  private dismissedWrites = new Set<string>();

  /** 关掉冲突弹窗后，同一批冲突不再每轮弹一次（签名变了才会再弹）。 */
  private dismissedConflictSignature = "";

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
    this.markStorage(storageHealthFromProbe(health));
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
        this.markDelta("dirty");
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
    this.markDelta(deltaAfterCheck(this.computePendingChanges()));

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
   * 指示点为什么是这个颜色——把上面那三个联合 + `status` 压成**一支**。
   *
   * 优先级在 `indicatorOf` 里定（红 → 黄 → 绿），这里只负责把事实递过去。
   * 之所以做成投影而不是再存一份：任何一份副本都要回答「什么时候同步它」，
   * 而那正是原来四个布尔各说各话的来源。
   */
  get indicator(): SyncIndicator {
    return indicatorOf({
      phase: this.status.phase,
      message: this.status.message,
      conflicts: this.status.conflicts,
      delta: this.delta,
      target: this.target,
      storage: this.storage,
    });
  }

  /**
   * 「现在和云端一致吗」——头部指示点用。
   *
   * 只有 `indicator` 落在 `synced` 这一支才算：正在跑 / 报错 / 离线 / 有冲突 /
   * 目标没了 / 存储写不进去 / 还有没推上去的改动，各是一支，谁也盖不住谁。
   */
  get inSync(): boolean {
    return inSyncOf(this.indicator);
  }

  /** 订阅同步结果（UI 用来弹提示）。 */
  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── 对外动作 ──────────────────────────────────────────────────────────────

  /**
   * 本地改动后的防抖上传。云同步关掉、或关掉自动同步时是空操作。
   *
   * 先看一眼「本地到底动过没有」（`mtime > 0`）：**拉取也会触发一次写入**，
   * 而拉取是清掉 mtime 的（见 `applyRemoteValue`），于是刚拉下来的题库不会被
   * 当成「本地改动」再传一遍。白跑一轮事小，把别的设备的改动捎带着推回去事大。
   */
  schedulePush(options: { force?: boolean } = {}): void {
    if (!this.isOn()) return;
    if (!this.config.value.autoSync) return;
    // `force`：调用方已经用**内容哈希**确认过"本地确实有没推上去的东西"了
    // （只有兜底轮询那条路）。那时**不能再过 mtime 这道门**——因为那道门正是
    // 失效的那个机制：iOS 上包装过的 `setItem` 没生效 ⇒ 一个 mtime 都没记下
    // ⇒ 这里永远早退 ⇒ 兜底轮询**只能把指示灯变黄，永远排不上上传**
    //（文档里写的"脏了就标黄并排队上传"，后半句是死的；审计复现：
    // 5 秒后 pendingChanges=true 但同步次数 0，25 秒后仍是 0）。
    if (!options.force && !this.hasLocalDirtyKeys()) return;
    if (this.pushTimer !== null) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      // 页面在后台时先不动，等重新可见时那次检查一并处理
      if (document.visibilityState !== "visible") return;
      void this.sync();
    }, SYNC_PUSH_DEBOUNCE_MS);
  }

  /**
   * 本地有没有「真的被本机改过」的可同步键。
   *
   * 判据是 mtime：`installStorageHook` 只给**真实写入**记时间，拉取走
   * `applyRemoteValue` 并顺手 `clearMtime`。随手扫一遍键，比全量收集便宜得多。
   */
  private hasLocalDirtyKeys(): boolean {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key === null) continue;
        if (!isSyncableKey(key)) continue;
        if (mtimeOf(key) > 0) return true;
      }
    } catch {
      // 读不了就当有改动：宁可多传一轮，也别把改动漏掉
      return true;
    }
    return false;
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
   * 「云端有更新，现在覆盖本地」——用户点了「立即更新」。
   *
   * 只对当前弹窗里那一个题库生效。随后重跑一轮：`runOnce` 看到它在
   * `approvedWrites` 里就跳过"用户正在做"的让路判断，直接把云端那份写下来。
   *
   * 返回这一轮的 outcome（UI 不需要它，测试与调用方要等它落完）。
   */
  async acceptRemoteWrite(): Promise<SyncOutcome> {
    const prompt = this.prompt;
    if (prompt?.kind !== "remote-write") return IDLE_OUTCOME;
    this.approvedWrites.add(prompt.hash);
    this.prompt = null;
    return this.run("merge");
  }

  /**
   * 关掉弹窗（「稍后」/ 点遮罩 / Esc）。
   *
   * - 冲突：记住这批冲突的签名，不再每轮弹；红点与设置面板里的选择项照旧留着。
   * - 远端覆盖：记住这个题库，用户还在做它期间不再问（也不动本地）。
   */
  dismissPrompt(): void {
    const prompt = this.prompt;
    if (prompt === null) return;
    if (prompt.kind === "conflict") {
      this.dismissedConflictSignature = prompt.signature;
    } else {
      this.dismissedWrites.add(prompt.hash);
    }
    this.prompt = null;
  }

  /**
   * 记下用户的选择，然后**重新**跑一次同步。
   *
   * 如果此刻正好有一次同步在跑，它已经读过裁决表了——必须先等它结束再跑，
   * 否则用户点了按钮却什么都没发生（裁决还躺在表里等下一轮）。
   */
  private async resolveConflicts(kind: ConflictResolution): Promise<SyncOutcome> {
    const hashes = this.status.conflicts.map((conflict) => conflict.hash);
    for (const hash of hashes) this.resolutions.set(hash, kind);

    // 如果此刻正好有一次同步在跑，它已经读过裁决表了——必须先等它结束再跑，
    // 否则用户点了按钮却什么都没发生（裁决还躺在表里等下一轮）。
    const running = this.running;
    if (running !== null) await running.catch(() => {});

    // 等它结束**之后**再记"已经批准覆盖"：那一轮的 finally 会把这张表清空，
    // 提前记会被顺手抹掉，于是「保留云端」又会被"你正在做题"拦一次。
    for (const hash of hashes) this.approvedWrites.add(hash);

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
    // 换了目标 = 还没验过这条新 Gist 在不在（不是「确认它还在」）
    this.markTarget("unverified");
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
    this.markTarget("unverified");
    // 「第一次看到冲突」的记录就在这本记账里，跟着一起删掉了
    clearSyncMeta();
    // 需要拍板的事也一起作废：换了目标 / 清了账，旧的覆盖请求没有意义
    this.prompt = null;
    this.approvedWrites.clear();
    this.dismissedWrites.clear();
    this.dismissedConflictSignature = "";
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
    if (draft === undefined) {
      this.markTarget(targetAfterProbe(result.missingTarget !== true));
    }

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
    // 关掉之后不再声称「目标没了」：这条判断属于同步，而同步已经停了
    this.markTarget("unverified");
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.resolutions.clear();
    // 关掉总开关就不该再有任何「等你拍板」的弹窗
    this.prompt = null;
    this.approvedWrites.clear();
    this.dismissedWrites.clear();
    this.dismissedConflictSignature = "";
    // 「第一次看到冲突」的记录在盘上的记账里，这里**不动它**：关掉再打开开关、
    // 或者刷新页面，那个时间还得是原来那个。真要连它一起忘掉，「清空配置」
    // 那条路会把整本记账删掉。
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
    // 这里不再记 `localChangeFallback = true`：探针的结论在 `init` 里已经一次
    // 记进 `storage`（`hook-silent`），再写一遍就成了两个可以各写各的字段。
    if (this.localPollTimer !== null) return;
    console.warn(
      "[sync] localStorage 钩子不生效，改用定时比对本地改动",
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
    this.markDelta("dirty");
    // 已经按内容哈希确认过脏了，绕开 mtime 那道门（见 `schedulePush`）
    this.schedulePush({ force: true });
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
      debugLog("sync:run", `${mode} · 本地 ${local.banks.size} 个题库`);

      // ── 还没有云端：建一条，把本地推上去 ──
      if (!client.id) {
        if (local.banks.size === 0 && !local.generalHasEdits) {
          this.setStatus("idle", "本地暂无题库");
          return IDLE_OUTCOME;
        }
        const files = filesOfState(local);
        const gist = await client.createGist(await this.encodeAll(files));
        // 刚建出来的这条当然还在
        this.markTarget("alive");
        this.patchConfig({ gistId: gist.id, gistUrl: gist.htmlUrl });
        // 基准线写失败要出声：云端已经建好了，但账本没记上，下一轮会以为
        // "还是第一次同步"——轻则白建一条 Gist，重则两边的题库列表对不上。
        const firstMetaSaved = saveSyncMeta(baselineMeta(local, gist.updatedAt));
        const outcome: SyncOutcome = {
          ...IDLE_OUTCOME,
          pushed: local.banks.size,
          // 云端刚建出来，这些题库对它来说全是「新增」
          newOnCloud: local.banks.size,
        };
        if (firstMetaSaved) {
          this.finishStatus(outcome, gist.files.size, local.banks.size);
        } else {
          // 账本没记上就不能报「已同步」：下一轮会以为"还是第一次同步"，
          // 轻则白建一条 Gist，重则两边的题库列表对不上。
          this.setStatus("error", "本地存储写不进去，同步记账失败");
        }
        this.emit({
          kind: "synced",
          message: "已备份到云端",
          result: { pushed: outcome.pushed, pulled: 0 },
        });
        return outcome;
      }

      const gist = await client.getGist();
      debugLog(
        "sync:remote",
        gist
          ? `云端 ${gist.files.size} 个文件`
          : "404：目标仓库不存在，整轮跳过（不会进入判定）",
      );
      if (!gist) {
        // 目标没了：卡片上会把那条 id 划掉标「已被删除」，这里只留一句给通知用的话
        this.markTarget("missing");
        this.setStatus("error", "目标仓库不存在");
        return IDLE_OUTCOME;
      }
      this.markTarget("alive");
      // 老版本只存过 id，顺手把网页地址补上（避免自己拼用户名拼错）
      if (!this.config.value.gistUrl && gist.htmlUrl) {
        this.patchConfig({ gistUrl: gist.htmlUrl });
      }

      const remote = buildRemoteState(await this.readRemoteFiles(gist.files));
      const meta = loadSyncMeta();

      // ── 远端有读不出来的文件 → **整轮停手**，一个字节都不动 ──
      //
      // 读不出来 ≠ 没有：某个分片解不开时，它里面的题库在 `remote.banks` 里根本
      // 不存在，判定会当成「云端删掉了」推出 `deleteLocal`，于是本地题库连题目带
      // 还没同步的进度一起被删掉（提示还写着「删除 1」，用户看不出是数据损坏）。
      // `_general.json` 解不开更糟：会被当成「云端没有 general」，拿空壳合并之后
      // 再把空壳推上去，两边的设置一起变成 `{}`。
      //
      // 三种模式都拦：`push` / `pull` 是用户显式要求覆盖，但"覆盖一个读不出来的
      // 文件"同样是在销毁看不见的数据，宁可让他先看清楚。
      const damage = remoteReadDamage(remote);
      if (damage !== null) {
        const what = [
          damage.general ? GIST_GENERAL_FILE : null,
          ...damage.shards,
        ].filter((name): name is string => name !== null);
        this.setStatus("error", "云端有文件读不出来，已停手");
        this.emit({
          kind: "error",
          message: `云端有文件读不出来，已停手（${what.join("、")}）`,
        });
        return IDLE_OUTCOME;
      }

      let plan =
        mode === "push"
          ? forcePushPlan(local, remote, meta)
          : mode === "pull"
            ? forcePullPlan(local, remote, meta)
            : buildSyncPlan({ local, remote, meta });

      // ── 冲突裁决 ──
      //
      // 只要还有**没裁决**的冲突，这一轮就什么都不做：不拉、不推、不改本地
      // （所以也不会碰任何会话状态），只把冲突摆到弹窗 / 面板上问用户。
      // 早期版本会「冲突的题库不动、其余照常同步」，于是其它题库被拉下来之后
      // 冲突提示跟着一次整页刷新没了，用户看到的就是「还没选就自己刷过去了」。
      // 宁可停一轮，也不能让用户的选择落空。
      if (mode === "merge" && plan.conflicts.length > 0) {
        // 把用户已经答过的那些裁决应用上去；用户没答过的仍然是 conflict
        plan = applyResolution(plan, this.resolutions);
        if (plan.conflicts.length > 0) {
          this.reportConflict(
            plan.conflicts,
            gist.files.size,
            remote.banks.size,
            gist.updatedAt,
          );
          // 裁决表**留着**：用户对「题库一」的选择不能因为这一轮又冒出
          // 「题库二」的新冲突而作废，等他答完题库二，两者一起生效。
          return {
            ...IDLE_OUTCOME,
            conflicts: plan.conflicts.map((conflict) => conflict.hash),
          };
        }
      }

      // ── 云端要写本地，但用户正在做这个题库 → 先问一句 ──
      //
      // 判定完全来自计划里的 `kind`（`actionWritesLocal`），不再看 mtime：
      // 只有 download / reconcile / remove-local 会碰本机进度。上传（`upload`）
      // 无论用户是否在做都不需要问——它对本地是只读的。
      //
      // 这一轮**不执行**（连别的题库也不动）：和冲突同一条规矩，宁可停一轮，
      // 也不要让"用户刚点的立即更新"和"别处已经写了一半"混在一起。
      if (mode === "merge") {
        this.pruneDismissedWrites();
        const busyWrites = plan.actions.filter(
          (action) =>
            actionWritesLocal(action) &&
            activeWork.isBusy(action.hash) &&
            !this.approvedWrites.has(action.hash),
        );
        const needsPrompt = busyWrites.filter(
          (action) => !this.dismissedWrites.has(action.hash),
        );
        if (needsPrompt.length > 0) {
          this.reportRemoteWrite(needsPrompt, gist.files.size, remote.banks.size);
          return {
            ...IDLE_OUTCOME,
            awaiting: needsPrompt.map((action) => action.hash),
          };
        }
        // 用户已经点了「稍后」：这一轮**什么都不写**（包括别的题库）。
        // 不能因为"没人要弹窗"就照常执行——那会把他说"等会儿"的那一份
        // 直接覆盖掉。等他不做了 / 下一轮再按正常路径落地。
        if (busyWrites.length > 0) {
          return {
            ...IDLE_OUTCOME,
            awaiting: busyWrites.map((action) => action.hash),
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
      debugLog(
        "sync:error",
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      );
      return this.fail(error);
    } finally {
      // 同意覆盖只对**这一轮**有效：执行完（无论成败）就作废，
      // 否则下一次同步会替用户把新的覆盖也预先答应了。
      this.approvedWrites.clear();
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
    /** 账本有没有记成功。失败时收尾**不能用成功状态盖掉那个错误**（见第 ⑤ 步）。 */
    let metaWritten = true;

    // ── ① general 先落地，再落题库 ──
    //
    // 顺序不能反：题库列表在 general 里，先落题库会出现「内容在、列表里没有」
    // 的中间态（侧边栏是题库的唯一入口，那个中间态看起来就像丢数据）。
    if (plan.generalChangedLocal) {
      applyRemoteValue(STORAGE_KEY_GENERAL, JSON.stringify(plan.general));
    }

    // ── ② 只有这三种 kind 会写本机的题库存储 ──
    //
    // `upload` / `in-sync` 到这里**什么都不做**：上传是只读本地的操作，
    // 这一支就是"本地进度已经是最新的，只把云端补上"的落点。
    for (const action of plan.actions) {
      if (action.kind === "reconcile") {
        // 两边都做过这同一个题库、题目却一样：合并出来的那一份**先落到本地**，
        // 后面第 ③ 步再从本地重建分片推上去——于是两台设备的进度都在，
        // 不需要用户去「保留本地 / 保留云端」里二选一。
        const hash = action.hash;
        const merged = action.merged as { questions: unknown[]; state?: unknown };
        applyRemoteValue(
          `quiz_app_questions_${hash}`,
          JSON.stringify(merged.questions),
        );
        applyRemoteState(hash, merged.state);
        clearMtime(`quiz_app_questions_${hash}`);
        clearMtime(`quiz_app_state_${hash}`);
        outcome.progressMerged += action.progressMerged === true ? 1 : 0;
      } else if (action.kind === "download") {
        const bank = remote.banks.get(action.hash);
        if (!bank) continue;
        writeBankLocally(bank);
        ensureLibraryEntry(action.hash, bank.snapshot.mode);
      } else if (action.kind === "remove-local") {
        removeBankLocally(action.hash);
      }
    }

    // ── ③ 回收云端的垃圾文件（空分片 / 旧格式残留）──
    let fileCount = ctx.remoteFileCount;
    if (plan.deleteRemoteFiles.length > 0) {
      await client.deleteFiles(plan.deleteRemoteFiles);
      fileCount -= plan.deleteRemoteFiles.length;
    }

    // ── ④ 按「拉取之后」的本地状态重建要上传的分片 ──
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

    // ── ⑤ 记基准线 ──
    //
    // 写不进去必须**说出来**：账本写失败 ⇒ `computePendingChanges` 一直读到旧行
    // ⇒ 指示灯永远黄、每轮基于陈旧基准重规划，而"内容没变就不传"又让这一轮什么
    // 都不做 ⇒ 静默空转。数据这一轮已经落好了，所以不是"失败"，但要明确告诉用户
    // 本地存储有问题。
    const metaSaved = saveSyncMeta(
      nextMeta({
        previous: meta,
        state: after,
        plan,
        remoteUpdatedAt: ctx.remoteUpdatedAt,
        now,
      }),
    );
    if (!metaSaved) {
      metaWritten = false;
      this.setStatus("error", "本地存储写不进去，同步记账失败");
      this.emit({
        kind: "error",
        message: "本地存储写不进去，同步记账失败（可能是空间已满）",
      });
    }

    // 这一轮到底动了什么——四个数互斥：新题库只算「新增」，不算「上传 / 下载」。
    // 冲突冻住的分片不算（`settledThisRound`），和基准线的写法保持一致。
    //
    // `reconcile` 只报「合并进度」：它合并的是进度，不是题目内容；再算一次
    // 「上传」会让一句「上传 1 · 合并进度 1」看起来像动了两件不同的事。
    for (const action of plan.actions) {
      if (!settledThisRound(plan, action)) continue;
      switch (action.kind) {
        case "upload":
          outcome.pushed += 1;
          // 云端原来没有这个题库 = 这台设备新导入的
          if (action.remoteHash === undefined) outcome.newOnCloud += 1;
          break;
        case "download":
          outcome.pulled += 1;
          // 本地原来没有 = 别的设备新导入的
          if (action.localHash === undefined) outcome.newLocally += 1;
          break;
        case "remove-local":
        case "remove-remote":
          outcome.removed += 1;
          break;
        default:
          break;
      }
    }
    outcome.settingsChanged = plan.settingsChanged;

    // ── ⑥ 收尾 ──
    //
    // 这里**没有整页刷新**：落盘走的是 `applyRemoteValue`，它会广播键名，
    // 持有内存副本的（两个会话 / 题库仓库 / 全局设置）各自重读。
    // 以前那一版在这里 `location.reload()`，正在答题的人会看到页面自己跳一下，
    // 作答草稿与滚动位置一起丢——用暴力掩盖缺失的通道。
    // 数据这一轮已经落好了，但**账本没记上**——那就不能报「已同步」：
    // 指示点会一直黄、下一轮还会基于陈旧基准重规划，得让用户看到"本地存储满了"。
    if (metaWritten) this.finishStatus(outcome, fileCount, remoteBankCount(plan));
    return outcome;
  }

  private finishStatus(
    outcome: SyncOutcome,
    remoteCount: number,
    remoteBanks: number,
  ): void {
    if (outcome.conflicts.length > 0) return; // reportConflict 已经写过状态

    // 走到这里说明这一轮正常收尾了：按真实数据重算「还有没有没推上去的东西」
    this.markDelta(deltaAfterCheck(this.computePendingChanges()));

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
    // 这一轮正常收尾 = 该做的都做了：之前挂着的「要不要覆盖」和「这批冲突」
    // 都失效了（冲突已裁决 / 用户已确认 / 不再需要）。
    this.prompt = null;
    this.dismissedConflictSignature = "";

    // 「设置也动了」也算同步出了结果——否则拖一下顺序同步完，事件里什么都不报
    if (
      outcome.pushed > 0 ||
      outcome.pulled > 0 ||
      outcome.removed > 0 ||
      outcome.settingsChanged ||
      outcome.progressMerged > 0
    ) {
      this.emit({
        kind: "synced",
        message: summary,
        result: { pushed: outcome.pushed, pulled: outcome.pulled },
      });
    }
  }

  /**
   * 「稍后」只对"用户还在做这个题库"这段时间有效。
   *
   * 一旦他离开了（屏上没题了），下一次同步就该按「云端更新、用户没在用」
   * 静默落地——所以这里把已经不在做的那些从"别再问"的名单里摘掉。
   * 不做这一步的话，用户点过一次「稍后」，之后每次开始做题都会静默跳过更新。
   */
  private pruneDismissedWrites(): void {
    for (const hash of [...this.dismissedWrites]) {
      if (!activeWork.isBusy(hash)) this.dismissedWrites.delete(hash);
    }
  }

  /**
   * 云端要写本地，但用户正在做这个题库：停下来问一句。
   *
   * **什么都不执行**（连同别的题库也不动）：和冲突同一条规矩——宁可停一轮，
   * 也不要把"用户还没确认的覆盖"和"别处已经写了一半"混在一起。
   * 所以这里既不动 `lastSyncAt`，也不重算 delta（本地确实还没同步）。
   */
  private reportRemoteWrite(
    actions: readonly BankAction[],
    remoteCount: number,
    remoteBanks: number,
  ): void {
    const action = actions[0];
    const operation: "replace" | "merge" | "remove" =
      action.kind === "reconcile"
        ? "merge"
        : action.kind === "remove-local"
          ? "remove"
          : "replace";

    this.prompt = {
      kind: "remote-write",
      hash: action.hash,
      name: action.name,
      operation,
    };
    this.status = {
      ...this.status,
      phase: "awaiting",
      message: "云端有更新，等你确认",
      at: Date.now(),
      remoteCount,
      remoteBanks,
      conflicts: [],
    };
  }

  /**
   * 进入冲突状态：冲突的题库谁都不动，等用户在面板里选择。
   *
   * 冲突的单位是**题库**（不是分片文件），提示里直接写题库名。
   * 同一个冲突反复出现时不重复弹提示——轮询每 3 分钟一次，会刷屏。
   *
   * `remoteAt` 是云端快照的最后改动时间（Gist 的 `updated_at`）：面板上
   * 「上传时间」那行小字用它，让用户知道云端那份是什么时候传上去的。
   */
  private reportConflict(
    conflicts: readonly BankAction[],
    remoteCount: number,
    remoteBanks: number,
    remoteAt: number,
  ): void {
    const signature = conflicts
      .map((conflict) => conflict.hash)
      .sort()
      .join(",");

    // 第一次看见这个题库冲突时记下时间，之后每一轮对账都不再改它——
    // 否则用户一边答题，面板上那个时间就一边往前跑，等于什么都没说。
    //
    // 记录就在同步记账（`quiz_app_sync_meta` 的 `conflicts` 段）里，每次现读现写：
    // 它是**盘上的事实**，不另存一份内存副本——副本只会多出「什么时候同步它」
    // 这个问题（见过一次：副本类型对不上，关同步开关时直接抛异常）。
    const now = Date.now();
    const seen = pruneConflictSeen(loadSyncMeta());
    let added = false;
    for (const conflict of conflicts) {
      if (seen[conflict.hash] === undefined) {
        seen[conflict.hash] = now;
        added = true;
      }
    }
    if (added) saveConflictSeen(seen);

    this.status = {
      phase: "conflict",
      message: `${conflicts.length} 个题库存在冲突`,
      at: now,
      // 冲突这一轮什么都没写，当然也不算「同步过」
      lastSyncAt: this.status.lastSyncAt,
      remoteCount,
      remoteBanks,
      conflicts: conflicts.map((conflict) =>
        toConflict(conflict, seen[conflict.hash], remoteAt),
      ),
    };

    if (signature !== this.lastConflictSignature) {
      this.lastConflictSignature = signature;
      this.emit({
        kind: "conflict",
        message: `${conflicts.length} 个题库存在冲突`,
      });
    }

    // 弹窗只在**第一次看到这批冲突**时出现；用户关掉之后靠红点与设置面板，
    // 直到这批冲突变了（新冲突冒出来 / 旧的解决了）才会再弹。
    // 轮询每 3 分钟一次，不这么做就是每 3 分钟糊用户一脸。
    if (signature !== this.dismissedConflictSignature) {
      this.prompt = {
        kind: "conflict",
        conflicts: this.status.conflicts,
        signature,
      };
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
      // 比的是**完整**哈希（题目 + 进度）：这个函数回答的是「还有没有没推上去的
      // 东西」，进度改了当然也算。冲突判定才只认内容哈希，两者别混。
      if (row === undefined || row.remoteHash !== bankFullHash(bank.snapshot)) return true;
    }

    // 记账里还有、本地已经没有的题库 = 删除还没推到云端
    for (const key of Object.keys(meta.rows)) {
      if (key.startsWith("bank:") && !seen.has(key)) return true;
    }

    return false;
  }
}

/** 应用级单例。 */
export const syncEngine = new SyncEngine();
