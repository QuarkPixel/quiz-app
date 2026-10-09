/**
 * 题库快照的合并：题目一样、**进度两边都动过**时，把两边合起来。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 *
 * 冲突判定的粒度曾经是**整个题库**（题目 + 全部进度算成一个哈希），于是
 * 「你在两台设备上先后做了同一份题库」和「两边把题目改得不一样了」在判定里长得
 * 一模一样：报冲突 → 用户在「保留本地 / 保留云端」里二选一 → 无论选哪边都要丢掉
 * 另一边的进度。而前者恰恰是刷题应用最日常的用法，不该需要人来裁决。
 *
 * ── 规矩（与业界「按卡片合并」的做法一致：内容冲突给人、进度冲突自动解）──────
 *
 *   - **题目本身**不一样 → 真冲突，交给用户（这里不掺和，调用方保证题目一致）
 *   - **进度**不一样     → 每张卡各取各的，更靠前的那一份留下
 *
 * 「更靠前」怎么定：有上次同步成功的快照（`base`）时，谁相对它变了就听谁的
 * （三方比较，和 `mergeGeneral` 同一套规矩）；两边都变了（同一张卡两边都答过）
 * 才按掌握程度取更高的那一档。时间戳在这里**不参与**——两台设备的钟对不齐，
 * 而「掌握到哪一档」是单调的、与时钟无关的判据。
 *
 * 与 `merge.ts` 一样是**纯函数**：不碰网络、不碰 localStorage。
 */

import { stableHash } from "./collect";

type Json = Record<string, unknown>;

/** 记忆模式的一张卡（`MemoryProgress` 的结构版）。 */
interface ProgressEntry {
  state?: string;
  level?: number;
  streak?: number;
  nextDue?: number;
  lapses?: number;
}

/** 状态档位：数字越大越靠前。 */
const STATE_PRIORITY: Record<string, number> = {
  learning: 0,
  reviewing: 1,
  mastered: 2,
};

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function asEntries(value: unknown): Record<string, ProgressEntry> | undefined {
  return asRecord(value) as Record<string, ProgressEntry> | undefined;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * 两个值一样吗。
 *
 * **必须与全项目同一个口径**（`merge.ts` 的 `same()`、`collect.ts` 的 `stableHash`）：
 * 以前这里用 `JSON.stringify` 比，而它比的是**键的插入顺序**——本地这份是内存对象、
 * 云端那份是解码出来的 JSON 文本，键序天然可能不同（`stableHash` 的开头就写着这件事，
 * 它为此专门递归排序键名）。用 stringify 比会带来两类误判：
 *
 *   - 「其实一模一样」被判成「变了」→ 多写一次盘、多传一次分片，
 *     `planProgressMerge` 还会把它报成一次「合并进度」；
 *   - `pickField` 里若本地那份只是键序不同、却被判成「本地改过」，
 *     「两边都改过 → 听本地」那条分支就会**丢掉云端真正的改动**。
 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return stableHash(a ?? null) === stableHash(b ?? null);
}

/**
 * 一份字段的三方选择：谁相对 `base` 改了听谁的；都改了 / 都没改听本地的。
 *
 * 与 `mergeGeneral` 的 `pick()` 同一套规矩，别写成两套。
 */
function pickField<T>(base: T | undefined, local: T | undefined, remote: T | undefined): T | undefined {
  const localChanged = !sameValue(local, base);
  const remoteChanged = !sameValue(remote, base);
  if (localChanged && !remoteChanged) return local;
  if (!localChanged && remoteChanged) return remote;
  return local ?? remote;
}

/**
 * 一张卡有多靠前：先比档位，再比 `level`。
 *
 * **已掌握是终态**，给一个不可能被超过的分值：同一张卡在一边已经掌握、另一边
 * 还在学习中时，取后者就是**降级**——用户明明已经在别的设备上把它拿下了。
 * （`nextDue` / `streak` 这些跟随的字段也一并取掌握那一份，它们此时本来就该归零。）
 */
function rank(entry: ProgressEntry): number {
  if (entry.state === "mastered") return Number.MAX_SAFE_INTEGER;
  return (STATE_PRIORITY[entry.state ?? "learning"] ?? 0) * 1000 + num(entry.level);
}

/**
 * 「已掌握」这份终态该不该压过一切：该压就返回那一份，不该压返回 `undefined`。
 *
 * 掌握是**单向**的（`advanceReview` 走完 M 才给，`resetReview` / `fuzzyReview`
 * 只在本地答错时发生），跨设备合并时永远不该倒退。所以只要两边 mastered 状态
 * 不同，mastered 那份赢——**压过下面「谁改了听谁」那条规矩**。
 *
 * 注意它只在两边 mastered 状态**不同**时给答案；相同时返回 `undefined`，
 * 把选择权交回给调用方（都掌握了或都没掌握，就没有「终态」可言了）。
 */
function pickTerminal(
  inLocal: ProgressEntry,
  inRemote: ProgressEntry,
): ProgressEntry | undefined {
  const localMastered = inLocal.state === "mastered";
  const remoteMastered = inRemote.state === "mastered";
  if (localMastered === remoteMastered) return undefined;
  return localMastered ? inLocal : inRemote;
}

/**
 * 按卡合并记忆模式的进度表。
 *
 * 三种情形，各一条规矩：
 *   1. 只有一边还有这张卡（另一边删过）→ 留着还在的那份，进度不该因为一次合并消失；
 *   2. 一边相对基准改了、另一边没动 → **听改了的那边**（三方比较），
 *      但**已掌握那一份永远赢**（见 `pickTerminal`）；
 *   3. 两边都改了（同一张卡两边都答过）→ 取更靠前的档位；`lapses` 取两边最大值
 *      （累计答错次数只会涨，取大不丢数据）。
 */
export function mergeProgressMap(
  base: Record<string, ProgressEntry> | undefined,
  local: Record<string, ProgressEntry> | undefined,
  remote: Record<string, ProgressEntry> | undefined,
): Record<string, ProgressEntry> {
  const result: Record<string, ProgressEntry> = {};
  const ids = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(local ?? {}),
    ...Object.keys(remote ?? {}),
  ]);

  for (const id of ids) {
    const inBase = base?.[id];
    const inLocal = local?.[id];
    const inRemote = remote?.[id];

    if (inLocal === undefined || inRemote === undefined) {
      const kept = inLocal ?? inRemote;
      if (kept !== undefined) result[id] = kept;
      continue;
    }

    const localChanged = !sameValue(inLocal, inBase);
    const remoteChanged = !sameValue(inRemote, inBase);

    // 选择的优先级，别把顺序写反（写反过一次，见下面第 ② 条）：
    //   ① 已掌握是终态，两边 mastered 状态不同时它赢，压过「谁改了听谁」；
    //   ② 只有一边相对基准改过 → **听改了的那边**；
    //   ③ 都改过 / 都没改过 → 取更靠前的档位。
    const terminal = pickTerminal(inLocal, inRemote);
    let winner: ProgressEntry;
    if (terminal !== undefined) {
      winner = terminal;
    } else if (localChanged && !remoteChanged) {
      // 只有本地改过 → 听本地的。
      //
      // **这一格绝不能改用 `rank` 去挑**（踩过）：复习时答「模糊 / 忘记」就是
      // 故意把档位**往下退**（退一级 / 归零），同时把 `nextDue` 推到将来。
      // 按档位挑的话，云端那份「还没动过的旧高档位」会赢，于是**连同它旧的
      // `nextDue`（今天）一起被拿回来**——刚复习完的卡立刻又变成「待复习」，
      // 而且每同步一次就复发一次。三方比较的意义正是「改过的那边说了算」，
      // 与档位高低无关。
      winner = inLocal;
    } else if (!localChanged && remoteChanged) {
      winner = inRemote;
    } else {
      winner = rank(inLocal) >= rank(inRemote) ? inLocal : inRemote;
    }

    result[id] = {
      ...winner,
      lapses: Math.max(num(inLocal.lapses), num(inRemote.lapses)),
    };
  }

  return result;
}

/**
 * 合并记忆模式那一段（`StoredState.memory`）。
 *
 * - `progress`：按卡合并（本模块的主角）
 * - `settings`：三方选（改过的那边说了算）
 * - `retry` / `review`：**带 `day` 的当天状态**，两边不是同一天就不合——合了会把
 *   昨天的「还要重新连对几次」搬到今天，或者让进度条的分子分母对不上；
 *   同一天则取并集 / 较大值
 * - `learnedDay`：取大的那个（「最近一次学完一轮」只前进不后退）
 */
function mergeMemoryState(
  base: Json | undefined,
  local: Json | undefined,
  remote: Json | undefined,
): Json {
  const merged: Json = {
    progress: mergeProgressMap(
      asEntries(base?.progress),
      asEntries(local?.progress),
      asEntries(remote?.progress),
    ),
    settings: pickField(base?.settings, local?.settings, remote?.settings) ?? local?.settings ?? {},
  };

  const learnedDay = Math.max(
    num(base?.learnedDay),
    num(local?.learnedDay),
    num(remote?.learnedDay),
  );
  if (learnedDay > 0) merged.learnedDay = learnedDay;

  const localDay = num(local?.day);
  const remoteDay = num(remote?.day);
  if (localDay > 0 && localDay === remoteDay) {
    merged.retry = mergeRetry(local, remote);
    merged.review = mergeReview(local, remote);
  } else if (local !== undefined || remote !== undefined) {
    // 不是同一天（或者只有一边有）→ 听本地的，别把两天混在一起
    const kept = local ?? remote;
    if (kept?.retry !== undefined) merged.retry = kept.retry;
    if (kept?.review !== undefined) merged.review = kept.review;
  }

  return merged;
}

/** 「答错后本轮还要重新连对几次」：同一天取**更大的要求**（更严格的那条）。 */
function mergeRetry(local: Json | undefined, remote: Json | undefined): unknown {
  const localTargets = asRecord(local?.targets) ?? {};
  const remoteTargets = asRecord(remote?.targets) ?? {};
  const targets: Json = { ...remoteTargets };
  for (const [id, value] of Object.entries(localTargets)) {
    targets[id] = Math.max(num(targets[id]), num(value));
  }
  return { day: local?.day ?? remote?.day, targets };
}

/**
 * 复习进度条的分子分母：分子取并集、分母取最大值。
 *
 * 两台设备今天各复习了一批不同的卡时，合起来才是「今天一共过了几道」；
 * 分母跟着涨，进度条才不会出现 6 / 5。
 */
function mergeReview(local: Json | undefined, remote: Json | undefined): unknown {
  const reviewed = [
    ...new Set([...strArray(local?.reviewedIds), ...strArray(remote?.reviewedIds)]),
  ];
  return {
    day: local?.day ?? remote?.day,
    reviewedIds: reviewed,
    total: Math.max(num(local?.total), num(remote?.total), reviewed.length),
  };
}

/**
 * 合并刷题模式的状态：掌握集合取并集、轮次取最大值、设置三方选，
 * 设备本地的界面偏好与活动池听本地的。
 *
 * 掌握集合用并集而不是「谁改听谁」：一边多掌握几张是纯粹的进步。只有**两边都
 * 删掉**的 id 才跟着删——那是用户在总览里主动取消了掌握。
 */
function mergeQuizState(
  base: Json | undefined,
  local: Json | undefined,
  remote: Json | undefined,
): Json {
  const merged: Json = { ...(local ?? {}) };

  const baseIds = strArray(base?.masteredIds);
  const localIds = strArray(local?.masteredIds);
  const remoteIds = strArray(remote?.masteredIds);
  const removedEverywhere = new Set(
    baseIds.filter((id) => !localIds.includes(id) && !remoteIds.includes(id)),
  );
  merged.masteredIds = [...new Set([...localIds, ...remoteIds, ...baseIds])].filter(
    (id) => !removedEverywhere.has(id),
  );

  merged.masteredMistakes = {
    ...(asRecord(base?.masteredMistakes) ?? {}),
    ...(asRecord(remote?.masteredMistakes) ?? {}),
    ...(asRecord(local?.masteredMistakes) ?? {}),
  };

  merged.currentRound = Math.max(
    num(base?.currentRound),
    num(local?.currentRound),
    num(remote?.currentRound),
  );
  merged.settings =
    pickField(base?.settings, local?.settings, remote?.settings) ?? local?.settings ?? {};
  merged.activePool = local?.activePool ?? remote?.activePool ?? [];
  merged.filterType = local?.filterType ?? remote?.filterType ?? "all";
  return merged;
}

/**
 * 「题目一样、进度两边都动过」时，这一轮到底要做什么。
 *
 * 判定（`judgeBank`）只说了一句 `push`，真正该怎么合在这里定——单独拎出来是因为
 * 这三种情形很容易写混，而它们对用户的意义完全不同：
 *
 *   - `skip`  本地那份就是两者中更靠前的那个，云端没有可取的 → 什么都不用做
 *   - `push`  直接推本地那份（云端那一份压根没有进度：全新的云端 / 别的设备还没做过题）
 *   - `merge` 两边各答过一些卡 → 合起来，同时写本地与云端，**两边都不丢**
 *
 * 只有 `merge` 会报「合并进度 N」：另外两种情形云端没有任何东西被合进来，
 * 报成合并会让用户以为两边都做过题（他可能只在一台设备上做过）。
 */
export type ProgressMergePlan =
  | { kind: "skip" }
  | { kind: "push"; snapshot: unknown }
  | { kind: "merge"; snapshot: unknown };

export function planProgressMerge(params: {
  /** 上次同步成功的那份快照（三方参照；旧记账里可能没有） */
  base?: unknown;
  local: unknown;
  remote: unknown;
}): ProgressMergePlan {
  // 云端那份压根没有进度 → 这就是一次普通的「上传自己的进度」。
  // **不要走合并**：合并会把缺失的字段补成默认值，于是「只是上传」也变成一次改写。
  if (stateOf(params.remote) === undefined) {
    return { kind: "push", snapshot: params.local };
  }
  // 云端有 `state`、但记忆模式的进度表是空的（题库刚同步过去、还没人做过题）：
  // 同样是「上传自己的进度」。这一档不能省——空进度表算不出「合进了新东西」，
  // 落到下面就会被判成 skip，于是本地那份进度永远推不上去。
  if (isProgressEmpty(params.remote)) {
    return { kind: "push", snapshot: params.local };
  }

  // 「要不要合」只看**每张卡**：`mergeQuizState` 会顺手补齐几个缺省字段
  // （`activePool` / `settings` 之类），拿整段 `state` 去比会把「其实一张卡都没
  // 从云端取到」误判成一次合并——用户只在一台设备上做过题，却看到「合并进度 1」。
  const merged = mergeProgressMap(
    progressOf(params.base),
    progressOf(params.local),
    progressOf(params.remote),
  );
  if (sameValue(merged, progressOf(params.local) ?? {})) return { kind: "skip" };

  return { kind: "merge", snapshot: mergeBankSnapshots(params) };
}

/** 快照里的 `state` 段。 */
function stateOf(snapshot: unknown): Json | undefined {
  return asRecord(asRecord(snapshot)?.state) as Json | undefined;
}

/** 快照里的 `state.memory.progress`（记忆模式的每张卡）。 */
function progressOf(snapshot: unknown): Record<string, ProgressEntry> | undefined {
  return asEntries(asRecord(stateOf(snapshot)?.memory)?.progress);
}

/**
 * 这份快照在**记忆模式**下是不是「一张卡都没做过」。
 *
 * 只看记忆模式：`state.memory` 存在才谈得上空不空。刷题模式没有这个字段，
 * 走不到这里（那边的进度是掌握集合，空集合会被下面的比较正确判成 skip）。
 */
function isProgressEmpty(snapshot: unknown): boolean {
  const memory = asRecord(stateOf(snapshot)?.memory);
  if (memory === undefined) return false;
  const progress = asRecord(memory.progress);
  return progress !== undefined && Object.keys(progress).length === 0;
}

/**
 * 两份快照的**进度**是不是一模一样（只看 `state` 那一段）。
 *
 * 能走到这里的调用方已经比过题目了（题目一致才会合并），而合并结果里的题目
 * 取自本地、必然相同——所以只看进度就够，一样就不必写回去、也不必白传一次分片。
 */
export function sameProgress(a: unknown, b: unknown): boolean {
  return sameValue(asRecord(a)?.state ?? null, asRecord(b)?.state ?? null);
}

/**
 * 合并两份题库快照（题目一样、进度两边都动过时用）。
 *
 * 题目取本地那份——调用方保证两边题目内容一致（不一致是冲突，走不到这里）。
 * 进度从 `base`（上次同步成功的那份）出发三方合并；`base` 缺失时退化成
 * 「两边各取更靠前的」。
 */
export function mergeBankSnapshots(params: {
  /** 上次同步成功时这一份题库长什么样；第一次同步时没有 */
  base?: unknown;
  local: unknown;
  remote: unknown;
}): unknown {
  const local = asRecord(params.local) ?? {};
  const remote = asRecord(params.remote) ?? {};
  const base = asRecord(params.base);

  const localState = asRecord(local.state);
  const remoteState = asRecord(remote.state);
  const baseState = asRecord(base?.state);

  // 本地这份没有进度（例如刚导入、还没做过题）→ 直接听云端的
  if (localState === undefined) {
    return remoteState === undefined ? { ...local } : { ...remote };
  }
  if (remoteState === undefined) return { ...local };

  const localMemory = asRecord(localState.memory);
  const remoteMemory = asRecord(remoteState.memory);
  const merged: Json = {
    ...local,
    state:
      localMemory !== undefined || remoteMemory !== undefined
        ? {
            ...mergeQuizState(baseState, localState, remoteState),
            memory: mergeMemoryState(
              asRecord(baseState?.memory),
              localMemory,
              remoteMemory,
            ),
          }
        : mergeQuizState(baseState, localState, remoteState),
  };

  // 合出来的东西和本地那份**实质一样**（只是补齐了几个缺省字段）→ 原样返回本地
  // 那份，别把「其实没变」变成一次改写：既能少写一次盘，也不会把缺省值灌进
  // 本地那份本来就精简的状态里。
  return sameValue(stateOf(merged), localState) ? local : merged;
}
