/**
 * 同步指示点的「为什么是这个颜色」——一组判别联合，外加一个纯投影函数。
 *
 * 以前这件事由四个互不相干的布尔 + `status.phase` 拼出来：
 *
 *   `pendingChanges` / `targetMissing` / `storageBlocked` / `localChangeFallback`
 *   （外加 `status.phase` 与 `status.conflicts`）
 *
 * 五个字段能拼出 2^4 × 7 种组合，而真实存在的状况只有十来种。拼不出来的那些
 * 组合此前全靠调用方的 `&&` 兜着：`inSync` 里那条 `!storageBlocked &&` 就是
 * 其中一条（「存储写不进去但显示已同步」本来是表示得出来的）。这里把它们收成
 * 三个小联合 + 一个投影：
 *
 *   - **delta**：本地和「上次同步成功的基准」差多少。三态而不是布尔——原来的
 *     `pendingChanges = true` 同时背着两件事：「确实有东西没推上去」和「还没算过，
 *     先当脏的」。默认值 `true` 就是后者，于是「刚打开页面」和「本地真改过」
 *     在类型上分不开，指示点只能都说「还没同步」。
 *   - **target**：目标仓库还在不在。`unverified` 是原来 `targetMissing = false`
 *     吞掉的那一态——换了目标 / 清空记账之后我们**并不知道**那条 Gist 还在不在，
 *     只是「没说它没了」。两者在面板上长得一样，语义却不一样。
 *   - **storage**：本机存储能不能写。三态**互斥**，因为探针只会给出一种结论；
 *     原来 `storageBlocked` 与 `localChangeFallback` 是两个独立布尔，
 *     「两个都 true」是一个表示得出来、但没有任何意义的组合。
 *
 * 三条约定：
 *   1. 这里全是纯函数 / 纯类型，不碰 `$state`、不碰 `localStorage`；
 *      引擎只负责把结果写回自己的字段（见 `SyncEngine` 的私有转移方法）。
 *   2. `indicatorOf` 的优先级**就是**页头那颗点的优先级（红 → 黄 → 绿），
 *      改这里等于改配色，别在 UI 里再排一遍。
 *   3. 这四个联合各自**只回答一个问题**。`storage` 与 `delta` 是正交的
 *      （存储坏了照样可能有没推上去的改动），所以不塞进同一个联合里——
 *      硬塞会丢掉其中一半信息，那是另一个方向的错。
 */

import type { SyncConflict, SyncStatus } from "./types";

/** 同步阶段。`SyncStatus["phase"]` 的别名，不另立一套枚举。 */
export type SyncPhase = SyncStatus["phase"];

/** 本地与基准的差距。 */
export type LocalDelta = "unknown" | "clean" | "dirty";

/** 目标仓库的状态。 */
export type TargetState = "unverified" | "alive" | "missing";

/** 本机存储的健康状况（三态互斥）。 */
export type StorageHealth = "ok" | "hook-silent" | "blocked";

/**
 * 指示点为什么是这个颜色。
 *
 * 一支一种理由，**同时只能是一支**——所以「正在 push 的同时又说目标已删除」
 * 这种自相矛盾的说法在类型上不存在了：那两件事都要求自己独占这个联合。
 */
export type SyncIndicator =
  /** 总开关关着（点不显示，但状态还在）。 */
  | { kind: "disabled" }
  /** 正在跑：`checking` 是自检，`syncing` 是 push / pull / merge。 */
  | { kind: "busy"; phase: "checking" | "syncing" }
  /** 有题库两边都改过，等用户在面板上拍板。 */
  | { kind: "conflict"; conflicts: readonly SyncConflict[] }
  /** 目标那条例代码片段已经不在了（被删 / 令牌换了账号）。 */
  | { kind: "target-missing" }
  /** 这一轮报错了（令牌失效、限流、云端有文件读不出来…）。 */
  | { kind: "failed"; message: string }
  /** 没网。不算「坏了」：联网后下一次同步自己就好，标红只会让人白紧张。 */
  | { kind: "offline"; message: string }
  /** 这台设备的本地存储写不进去，进度随时会丢。 */
  | { kind: "blocked" }
  /** 还没算过本地和基准差多少——一律说「还没同步」。 */
  | { kind: "unknown" }
  /** 本地有改动没推上去。 */
  | { kind: "pending" }
  /** 和云端一致。 */
  | { kind: "synced" };

/** 投影要用到的全部事实。 */
export interface SyncFacts {
  phase: SyncPhase;
  message: string;
  conflicts: readonly SyncConflict[];
  delta: LocalDelta;
  target: TargetState;
  storage: StorageHealth;
}

/**
 * 把几件事的现状压成「一个理由」。
 *
 * 优先级照搬页头那颗点：**红（disabled / busy / conflict / target-missing /
 * failed / blocked）→ 黄（offline / unknown / pending）→ 绿（synced）**。
 * 顺序不是随手排的：
 *   - `disabled` 最先：开关关着的时候其余状态已经清干净了，先认它不会错；
 *   - `busy` 在 `conflict` 之前：正在跑的时候那颗点是呼吸灯，颜色沿用跑之前那色
 *     （见 `AppShell` 的 `toneWhileRunning`），此时报「有冲突」只会闪一下；
 *   - `target-missing` 在 `failed` 之前：两者都是 error，但「目标没了」比
 *     「这一轮报了什么错」更具体，也更是用户要去处理的那件事；
 *   - `blocked` 排在所有「黄」之前：存储写不进去时**永远**不许显示已同步。
 */
export function indicatorOf(facts: SyncFacts): SyncIndicator {
  if (facts.phase === "disabled") return { kind: "disabled" };
  if (facts.phase === "checking" || facts.phase === "syncing") {
    return { kind: "busy", phase: facts.phase };
  }
  // 认 `phase` 而不只认列表：`reportConflict` 是同时写这两个字段的，正常路径上
  // 它们不会背离；但「摆了 phase 却没摆列表」的替身（测试 / 半截恢复的状态）
  // 也该落在红点上——否则它会一路滑到 `synced`，把冲突说成「已同步」。
  if (facts.phase === "conflict" || facts.conflicts.length > 0) {
    return { kind: "conflict", conflicts: facts.conflicts };
  }
  if (facts.target === "missing") return { kind: "target-missing" };
  if (facts.phase === "error") return { kind: "failed", message: facts.message };
  if (facts.phase === "offline") return { kind: "offline", message: facts.message };
  if (facts.storage === "blocked") return { kind: "blocked" };
  if (facts.delta === "unknown") return { kind: "unknown" };
  if (facts.delta === "dirty") return { kind: "pending" };
  return { kind: "synced" };
}

// ── 对外字段的投影 ──────────────────────────────────────────────────────────
//
// 引擎把这几个字段当只读视图暴露出去（名字与语义都不变，见 `SyncEngine`）。
// 写成函数而不是就地 `===`，是为了让「哪一支对应哪个值」只有这一处。

/** 本地有没有还没推上去的东西（`unknown` 也算「有」，宁可说还没同步）。 */
export function pendingChangesOf(delta: LocalDelta): boolean {
  return delta !== "clean";
}

/** 目标仓库是不是已经确认不在了。 */
export function targetMissingOf(target: TargetState): boolean {
  return target === "missing";
}

/** 本地存储是不是写不进去。 */
export function storageBlockedOf(health: StorageHealth): boolean {
  return health === "blocked";
}

/** 是不是在用「定时比对本地改动」的兜底。 */
export function localChangeFallbackOf(health: StorageHealth): boolean {
  return health === "hook-silent";
}

/** 「现在和云端一致吗」——只有 `synced` 这一支算。 */
export function inSyncOf(indicator: SyncIndicator): boolean {
  return indicator.kind === "synced";
}

// ── 投影到页头那颗点 ────────────────────────────────────────────────────────
//
// 页头只向这颗联合要两样东西：**什么颜色**、**一句话**。两样都只由 `indicator`
// 决定，这里就是唯一一处判断。
//
// 以前 `AppShell` 里另排了一遍优先级（`hasConflicts || failed || storageBlocked`
// 才红、`inSync` 才绿、其余黄），和这里平行存在。同一件事两处各算一遍，改一处
// 忘一处就会出现「红点配着『已同步』」这种自相矛盾的画面；而 `checking` 那一段
// 更是谁都没认领——它既不是 `syncing`（呼吸灯不亮）、也不算「同步过」，于是
// 掉进兜底文案里，说成了「还没同步」。
//
// 加这一层之后，每种状态都有确定的颜色和说法，兜底只剩「真的没有别的信息」
// 那一种。**不新增分支就不要再在 UI 里写 `if (xxx) 红`。**

/** 指示点的三种颜色。 */
export type SyncTone = "ok" | "pending" | "danger";

/**
 * 一支状态 → 一种颜色。
 *
 *   - 红（`danger`）**要用户动手**：去设置里拍板冲突、修令牌、换目标，
 *     或者处理「本地根本存不下来」这件事。再同步一次不会自己好。
 *   - 黄（`pending`）等一等就好：没配好、还没算过、有改动没推、离线。
 *   - 绿（`ok`）和云端一致。
 */
export function toneOf(indicator: SyncIndicator): SyncTone {
  switch (indicator.kind) {
    case "synced":
      return "ok";
    case "conflict":
    case "target-missing":
    case "failed":
    case "blocked":
      return "danger";
    // 关着 / 正在跑 / 离线 / 还没算过 / 有改动没推：都是「先别操心」
    case "disabled":
    case "busy":
    case "offline":
    case "unknown":
    case "pending":
      return "pending";
  }
}

/**
 * 一支状态 → 一句话（指示点的 `aria-label`，也是悬浮提示的主体）。
 *
 * 措辞统一成「暂未同步」而不是「还没同步」：后者太口语，作为无障碍标签念出来
 * 也不像一个状态名。同理 `busy` 分出「正在检查」——自检和真正推拉是两件事，
 * 原来它们都被兜底成「还没同步」，读屏用户完全不知道点下去之后在发生什么。
 */
export function labelOf(indicator: SyncIndicator): string {
  switch (indicator.kind) {
    case "disabled":
      return "云同步已关闭";
    case "busy":
      return indicator.phase === "checking" ? "正在检查" : "正在同步";
    case "conflict":
      return `${indicator.conflicts.length} 个题库存在冲突`;
    case "target-missing":
      return "目标仓库不存在";
    case "failed":
      return indicator.message;
    case "offline":
      return "云同步：当前离线";
    case "blocked":
      return "本地存储不可写";
    case "synced":
      return "已同步";
    // `unknown`（还没算过）与 `pending`（确实有改动没推）对用户是同一句话：
    // 都不该让人以为「已经传上去了」。区别只在引擎内部，不外露。
    case "unknown":
    case "pending":
      return "暂未同步";
  }
}

// ── 转移 ────────────────────────────────────────────────────────────────────

/**
 * 探针结论 → 存储健康。
 *
 * `silent`（写得进去但钩子不通知）和 `blocked`（根本写不进去）是同一根探针的
 * 两个不同结论，**不可能同时成立**——这正是原来两个布尔丢掉的那条不变式。
 */
export function storageHealthFromProbe(
  probe: "ok" | "silent" | "blocked",
): StorageHealth {
  if (probe === "blocked") return "blocked";
  if (probe === "silent") return "hook-silent";
  return "ok";
}

/**
 * 一次「按内容哈希比对」的结论 → delta。
 *
 * 只有真的算过才允许落到 `clean` / `dirty`；`unknown` 只属于「还没算过」，
 * 不该由任何一次比对产生。
 */
export function deltaAfterCheck(hasPending: boolean): LocalDelta {
  return hasPending ? "dirty" : "clean";
}

/** 一次「目标还在不在」的结论 → 目标状态。 */
export function targetAfterProbe(exists: boolean): TargetState {
  return exists ? "alive" : "missing";
}
