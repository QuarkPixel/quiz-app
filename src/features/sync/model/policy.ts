import type { GeneralSnapshot } from "../types";
import type { MemoryProgress, MemoryStoredState, StoredState } from "@/types";

/**
 * **每个可同步字段的归属与合并算子——同步层规矩的唯一真相。**
 *
 * 以前这些规矩散在各处：`currentRound` 用 `Math.max`、`activePool` 用
 * `local ?? remote`、`masteredIds` 用「并集减去两边都删的」、`settings` 用三方挑，
 * 没有统一的词汇，也没有一处写下来"这个字段为什么这么合"。更要紧的是其中
 * `local ?? remote` 这类写法**违反交换律**（谁在本地谁赢），于是两台设备各算出
 * 各的结果、互相覆盖——这正是「换个设备就不对」那类隐形 bug 的来源。
 *
 * 所以现在：**新增可同步字段必须在这里登记**，否则
 * `tests/syncPolicy.test.ts` 会红（它拿一份真实的完整 `StoredState` 逐字段比对）。
 *
 * ── 归属一览 ────────────────────────────────────────────────────────────────
 *
 * | 归属           | 语义                     | 算子                        |
 * |----------------|--------------------------|-----------------------------|
 * | `cardMap`      | 记忆模式每张卡           | `mergeCard`（全序取大）     |
 * | `highWaterSet` | 只涨不落的集合           | 并集 - 两边都不再含的       |
 * | `max`          | 计数 / 只涨不落的数值    | 取大                        |
 * | `scalar`       | 单值，三方比较           | `pickScalar`                |
 * | `dayScoped`    | 带 `day` 的当天状态      | `day` 大的整条赢            |
 * | `deviceLocal`  | **不同步**，本机自己留着 | ——                          |
 */

/** 一份题库状态里**参与同步**的字段（路径形式，`memory.` 前缀表示在 `memory` 段里）。 */
export const SYNCED_BANK_FIELDS = [
  "masteredIds", // highWaterSet（记忆模式下由 progress 推导，见 merge.ts）
  "masteredMistakes", // 逐键 max（答错次数只涨）
  "currentRound", // max
  "settings", // scalar（按库设置）
  "memory.progress", // cardMap
  "memory.settings", // scalar（记忆模式的按库设置）
  "memory.retry", // dayScoped（跨天不合）
  "memory.review", // dayScoped（跨天不合）
  "memory.learnedDay", // max（「最近一次学完一轮」只前进）
] as const;

/**
 * **明确不参与同步**的字段：都是设备本地的 UI / 会话状态。
 *
 * 为什么把它们排除，而不是给它们编一条合并规矩：
 *   - `ui` / `filterType` 是纯 UI 状态，跨设备传只会让"我在手机上收起的面板
 *     在电脑上也是收起的"这种莫名其妙的行为；
 *   - `activePool` / `roundMastered` / `roundGoal` / `roundPoolIds` / `learningPool`
 *     是**本轮会话**的状态。它们没有语义上说得通的合并方式（两台设备各挑了一批题
 *     怎么办？），而原来那种「`local ?? remote`」写法谁在本地谁赢 ⇒
 *     **违反交换律** ⇒ 两台设备永远算不出同一个结果。
 *
 * 排除它们之后，拉取 / 合并写回本地时**必须原样保留本机那份**（见 `attachDeviceLocal`），
 * 否则一次同步就会把本机的 UI 状态和会话池子清空。
 */
/**
 * 装载期检查：登记表里的路径**只能有一层**（`x` 或 `memory.x`）。
 *
 * `stripDeviceLocal` 剥 `memory` 段时是按 `path.slice("memory.".length)` 取**一层**
 * 字段名的，所以登记成 `memory.review.total` 这种两层的路径会**过得了编译期护栏、
 * 却永远匹配不上**——表现成"登记了却从来不同步"，而且没有任何报错。
 *
 * 只在开发/测试期抛（`import.meta.env.DEV`）：这纯粹是给改这张表的人当场一个耳光，
 * 不该让生产环境的用户在启动时炸掉。
 */
if (import.meta.env.DEV) {
  for (const path of SYNCED_BANK_FIELDS) {
    const segments = path.split(".");
    const ok = segments.length === 1 || (segments.length === 2 && segments[0] === "memory");
    if (!ok) {
      throw new Error(
        `SYNCED_BANK_FIELDS 里的路径只能有一层（\`x\` 或 \`memory.x\`），收到：${path}`,
      );
    }
  }
}

export const DEVICE_LOCAL_BANK_FIELDS = [
  "ui",
  "filterType",
  "activePool",
  "roundMastered",
  "roundGoal",
  "roundPoolIds",
  "learningPool",
] as const;

/** general 里参与同步的字段。`activeBank` 是设备本地的（各设备看自己的题库）。 */
export const SYNCED_GENERAL_FIELDS = [
  "library", // list：三方 + 顺序合并
  "defaultSettings", // scalar
  "globalSettings", // scalar
] as const;

export const DEVICE_LOCAL_GENERAL_FIELDS = [
  "activeBank", // 当前在看哪个题库是设备本地的事（URL 才是它的第二个真相）
] as const;

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

/**
 * 从一份完整状态里**摘出可同步的部分**（收集 / 上传时用）。
 *
 * 只认登记过的字段：没登记的字段**不会**被同步出去，这是有意的——
 * 新加字段时忘了登记，表现是"这个字段不参与同步"（可见、可查），
 * 而不是"它以一种没人想清楚的方式参与同步"（隐形、难查）。
 */
export function stripDeviceLocal(state: unknown): Json | undefined {
  if (state === undefined) return undefined;
  if (state === null || typeof state !== "object" || Array.isArray(state)) return undefined;
  const all = state as Json;
  // **白名单，不是黑名单**：只放行登记过的字段。
  //
  // 以前是「拷一份、删掉设备本地的那几个」，于是**没登记**的字段（新加的、或者
  // 属于设备本地的）会**原样被同步出去**，还会进 `bankProgressHash` / `bankFullHash`
  // ——与这段代码上面的注释（"没登记的字段不会被同步出去"）正好相反，而且是隐形的。
  const rest: Json = {};
  for (const path of SYNCED_BANK_FIELDS) {
    if (path.startsWith("memory.")) continue;
    if (path in all) rest[path] = all[path];
  }

  const memory = asRecord(all.memory);
  if (memory !== undefined) {
    const kept: Json = {};
    for (const path of SYNCED_BANK_FIELDS) {
      if (!path.startsWith("memory.")) continue;
      const key = path.slice("memory.".length);
      if (key in memory) kept[key] = memory[key];
    }
    rest.memory = kept;
  }
  return rest;
}

/**
 * 把「可同步的部分」写回本地时，**保留本机的设备本地字段**。
 *
 * 拉取 / 合并的结果里没有 `ui` / `activePool` 这些字段；直接覆盖会让本机的
 * UI 状态和当前这一轮的池子凭空消失。所以写回前先把本机那份贴回去。
 */
export function attachDeviceLocal(
  syncable: unknown,
  existingLocal: unknown,
): Json | undefined {
  if (syncable === null || typeof syncable !== "object" || Array.isArray(syncable)) {
    return undefined;
  }
  const local = asRecord(existingLocal);
  const next: Json = { ...(syncable as Json) };
  if (local !== undefined) {
    for (const field of DEVICE_LOCAL_BANK_FIELDS) {
      if (field in local) next[field] = local[field];
    }
  }
  // `memory` 段：**进来那份没有就保持没有**，不要凭空造一个 `{}`。
  //
  // 以前无条件写 `next.memory = {...}`，于是「syncable 里没有 memory」会被变成
  // `memory: {}`——把本机的进度段换成一个空壳（审计复现）。而 `memory: {}` 与
  // 「没有 memory 键」在下游不是一回事（`hasMemory` 之类的判断会因此翻面）。
  //
  // 注意：`DEVICE_LOCAL_BANK_FIELDS` 里目前**没有**任何字段住在 `memory` 段内
  // （`retry` / `review` 都是要同步的），所以这里没有"贴回设备本地字段"的动作；
  // 哪天有了，在这里按 `localMemory` 贴回去。
  return next;
}

// ── 编译期穷尽护栏 ──────────────────────────────────────────────────────────
//
// 下面这几行**故意放在 `src/` 里**（而不是测试文件）：`pnpm check` 只检查
// `src/**`，`tests/` 根本不参与类型检查——写在测试里等于没有护栏。
//
// 作用：给状态加字段却忘了在上面的表里登记，**类型检查直接不过**。
// 这比运行时断言强，不依赖测试有没有跑到那一条。
//
// ── 覆盖边界（**别以为它管得比这更多**）────────────────────────────────────
//
// 它盯的是这四处的**顶层**字段名：
//
//   `StoredState` / `MemoryStoredState` / `MemoryProgress` / `GeneralSnapshot`
//
// **管不到**的地方（审计逐条验证过，此处如实记着，免得下次又以为有护栏）：
//
//   - `settings` / `memory.settings` / `defaultSettings` / `globalSettings` 里的
//     新字段：这几个是**整块**同步的（走 `pickScalar`），所以新字段会自动跟着走
//     ——"会不会同步"不需要护栏；但如果它是**设备本地**的（不该跨设备），它就
//     悄悄跟着走了，这一层没人拦。
//   - `library[*]`（`LibraryEntry`）里的新字段：同理，条目整体进比较与合并。
//   - `masteredMistakes[*]`：值一律取大，加键没问题。
//   - 落盘那一侧还有第二个白名单（`store.ts` 的 `persistedState`），
//     它有自己的护栏 `STORED_STATE_COVERAGE`——**那和这张表是两回事**：
//     登记成"可同步"却忘了进 `persistedState`，就是"登记了却永远存不进本地"。
//   - 路径**深度**由装载期检查兜（只能 `x` 或 `memory.x`）。

type SyncedField = (typeof SYNCED_BANK_FIELDS)[number];
type DeviceLocalField = (typeof DEVICE_LOCAL_BANK_FIELDS)[number];

/** `memory.progress` → `progress`；顶层字段原样。 */
type StripMemoryPrefix<T> = T extends `memory.${infer Rest}` ? Rest : T;

/** 顶层字段：`memory` 是容器，单独放行。 */
type CoveredTopLevel =
  | Exclude<SyncedField, `memory.${string}`>
  | DeviceLocalField
  | "memory";
/** `memory` 段里的字段。 */
type CoveredMemory = StripMemoryPrefix<SyncedField> | DeviceLocalField;

/**
 * 卡片字段：`mergeCard` 是**整条取赢家**，所以每个字段都要明确
 * "跟着赢家走"还是"单独算"（`lapses` 取大）。
 */
const CARD_FIELDS_FROM_WINNER = ["state", "level", "streak", "nextDue", "rev"] as const;
const CARD_FIELDS_SEPARATE = ["lapses"] as const;

type UncoveredCard = Exclude<
  keyof MemoryProgress,
  (typeof CARD_FIELDS_FROM_WINNER)[number] | (typeof CARD_FIELDS_SEPARATE)[number]
>;
type UncoveredTopLevel = Exclude<keyof StoredState, CoveredTopLevel>;
type UncoveredMemory = Exclude<keyof MemoryStoredState, CoveredMemory>;
type UncoveredGeneral = Exclude<
  keyof GeneralSnapshot,
  (typeof SYNCED_GENERAL_FIELDS)[number] | (typeof DEVICE_LOCAL_GENERAL_FIELDS)[number]
>;

/** 有漏登记的字段时，下面每个常量的类型都会变成 `never`，赋值 `true` 立刻编译不过。 */
type Covered<T> = [T] extends [never] ? true : never;

/* eslint-disable @typescript-eslint/no-unused-vars */
const CARD_FIELDS_COVERED: Covered<UncoveredCard> = true;
const TOP_LEVEL_FIELDS_COVERED: Covered<UncoveredTopLevel> = true;
const MEMORY_FIELDS_COVERED: Covered<UncoveredMemory> = true;
const GENERAL_FIELDS_COVERED: Covered<UncoveredGeneral> = true;
/* eslint-enable @typescript-eslint/no-unused-vars */

/** 给测试用的锚点（顺带让上面几个常量不至于"声明未使用"）。 */
export const POLICY_COVERAGE = {
  card: CARD_FIELDS_COVERED,
  topLevel: TOP_LEVEL_FIELDS_COVERED,
  memory: MEMORY_FIELDS_COVERED,
  general: GENERAL_FIELDS_COVERED,
} as const;
