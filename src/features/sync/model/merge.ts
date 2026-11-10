/**
 * 三方合并（基准 / 本地 / 云端）——**纯函数**，按 `policy.ts` 登记过的字段逐条合。
 *
 * 与旧实现的区别，一句话：旧的是"给每个字段现编一条规矩，而且有几条违反交换律"，
 * 新的是"字段在 `policy.ts` 里登记过，用登记的那个算子合"。
 *
 * 卡片用 `mergeCard`（全序取大，含修订戳）；其余见 `policy.ts` 的表。
 */

import type {
  ActivePoolItem,
  MemoryProgress,
  MemorySessionsState,
  QuizSessionState,
} from "@/types";
import { mergeCard } from "./card";
import { num, pickScalar, strArray } from "./operators";
import { stripDeviceLocal, SYNCED_BANK_FIELDS } from "./policy";
import { same } from "./same";
import { mergeSessionsWithBase } from "@/features/memory/session";
import { mergeQuizSession } from "@/quiz/session/quizSession";
import { revOf } from "@/lib/rev";

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function asCardMap(value: unknown): Record<string, MemoryProgress> | undefined {
  const record = asRecord(value);
  return record as Record<string, MemoryProgress> | undefined;
}

/**
 * 按卡合并进度表。
 *
 * 出现与否取**并集**（一边删过卡、另一边还有 → 留着还在的那份：进度不该因为
 * 一次合并消失，这是有意的取舍）。两边都在时才交给 `mergeCard`。
 */
export function mergeProgressMap(
  base: Record<string, MemoryProgress> | undefined,
  local: Record<string, MemoryProgress> | undefined,
  remote: Record<string, MemoryProgress> | undefined,
): Record<string, MemoryProgress> {
  const ids = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(local ?? {}),
    ...Object.keys(remote ?? {}),
  ]);

  const result: Record<string, MemoryProgress> = {};
  // **键要排序**：不然输出顺序随参数顺序变，两台设备算出不同的 `bankProgressHash`
  // ⇒ 互相认为对方"改过" ⇒ 来回推。（顺序不是语义，但对哈希是。）
  for (const id of [...ids].sort()) {
    const inLocal = local?.[id];
    const inRemote = remote?.[id];
    if (inLocal === undefined || inRemote === undefined) {
      const kept = inLocal ?? inRemote;
      if (kept !== undefined) result[id] = kept;
      continue;
    }
    result[id] = mergeCard(inLocal, inRemote);
  }
  return result;
}

/** 逐键取大（答错次数这类计数器只涨）。 */
function mergeNumberRecord(
  base: unknown,
  local: unknown,
  remote: unknown,
): Json {
  const merged: Json = {};
  const keys = new Set([
    ...Object.keys(asRecord(base) ?? {}),
    ...Object.keys(asRecord(local) ?? {}),
    ...Object.keys(asRecord(remote) ?? {}),
  ]);
  // 键排序：理由同上（对象键序会进哈希）
  for (const key of [...keys].sort()) {
    merged[key] = Math.max(
      num(asRecord(base)?.[key]),
      num(asRecord(local)?.[key]),
      num(asRecord(remote)?.[key]),
    );
  }
  return merged;
}

/**
 * 只涨不落的字符串集合：并集，减去「基准里有、但两边都不再包含」的
 * （那说明两边都执行过删除）。
 */
function mergeHighWaterSet(base: unknown, local: unknown, remote: unknown): string[] {
  const baseIds = strArray(base);
  const localIds = strArray(local);
  const remoteIds = strArray(remote);
  const removed = new Set(
    baseIds.filter((id) => !localIds.includes(id) && !remoteIds.includes(id)),
  );
  // **必须排序**：这些数组会进 `bankProgressHash` / `bankFullHash`，顺序随参数顺序变
  // 就意味着两台设备算出不同的哈希 → 互相认为对方"改过" → 来回推。
  // 集合本身没有顺序语义（只用来判成员），排序是安全的。
  return [...new Set([...localIds, ...remoteIds, ...baseIds])]
    .filter((id) => !removed.has(id))
    .sort();
}





function asSessions(value: unknown): MemorySessionsState | undefined {
  const record = asRecord(value);
  return record as MemorySessionsState | undefined;
}

function asQuizSession(value: unknown): QuizSessionState | undefined {
  const record = asRecord(value);
  return record as QuizSessionState | undefined;
}

function asPool(value: unknown): ActivePoolItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is ActivePoolItem =>
      asRecord(item) !== undefined && typeof (item as { id?: unknown }).id === "string",
  );
}

/**
 * 合并刷题模式的活动池（记忆模式不落盘池子，永远是空数组）。
 *
 * 按题目 id 合并，不做「谁在本地谁赢」：
 *   - `hasEverMistaken` / `hasBeenShown`：OR（做过就是做过）
 *   - `lastSelectedRound`：max（只前进）
 *   - `consecutiveCorrect`：条目带 `rev` 时取更新那侧；两边都是 0（老数据）时
 *     按「答错过的那侧更新、都答错过取小、都没答错过取大」裁决
 *   - 成员：local ∪ remote（两边都删掉的才真的消失）
 *
 * 结果按 id 排序：它会进 `bankProgressHash`，顺序不稳会让两台设备互相
 * 认为对方改过。
 */
function mergeActivePool(
  local: unknown,
  remote: unknown,
): ActivePoolItem[] {
  const localMap = new Map(asPool(local).map((item) => [item.id, item]));
  const remoteMap = new Map(asPool(remote).map((item) => [item.id, item]));
  const ids = [...new Set([...localMap.keys(), ...remoteMap.keys()])].sort();

  const result: ActivePoolItem[] = [];
  for (const id of ids) {
    const left = localMap.get(id);
    const right = remoteMap.get(id);
    if (!left) {
      if (right) result.push(right);
      continue;
    }
    if (!right) {
      result.push(left);
      continue;
    }

    const leftRev = left.rev ?? 0;
    const rightRev = right.rev ?? 0;
    let consecutiveCorrect: number;
    if (leftRev !== rightRev) {
      consecutiveCorrect =
        (leftRev > rightRev ? left : right).consecutiveCorrect;
    } else if (left.hasEverMistaken !== right.hasEverMistaken) {
      // 答错的那侧一定更新（会把连对清零）
      consecutiveCorrect =
        (left.hasEverMistaken ? left : right).consecutiveCorrect;
    } else if (left.hasEverMistaken) {
      // 都答错过：取小的那侧，别把一次清零抹掉
      consecutiveCorrect = Math.min(
        left.consecutiveCorrect,
        right.consecutiveCorrect,
      );
    } else {
      consecutiveCorrect = Math.max(
        left.consecutiveCorrect,
        right.consecutiveCorrect,
      );
    }

    result.push({
      id,
      consecutiveCorrect,
      hasEverMistaken: left.hasEverMistaken || right.hasEverMistaken,
      hasBeenShown: left.hasBeenShown || right.hasBeenShown,
      lastSelectedRound: Math.max(
        left.lastSelectedRound,
        right.lastSelectedRound,
      ),
      rev: Math.max(leftRev, rightRev),
    });
  }
  return result;
}

/**
 * 记忆模式那一小段。
 *
 * `reset` 描述「其中一台设备重置过进度」这件事（`winner` 是戳更大的那一侧）：
 * `memory.progress` 里 `rev <= reset.rev` 的条目一律丢掉——它们是重置之前的
 * 旧进度，并集会把它们复活。`winner` 自己那份的条目不受影响（它重置后可能
 * 又学了几张，那些条目带着更新的 `rev`）。
 */
function mergeMemorySection(
  base: Json | undefined,
  local: Json | undefined,
  remote: Json | undefined,
  reset?: { rev: number; winner: Json },
): Json {
  const progress = mergeProgressMap(
    asCardMap(base?.progress),
    asCardMap(local?.progress),
    asCardMap(remote?.progress),
  );

  if (reset && reset.rev > 0) {
    const kept = new Set(
      Object.keys(asCardMap(reset.winner.progress) ?? {}),
    );
    for (const [id, item] of Object.entries(progress)) {
      if (kept.has(id)) continue;
      if (revOf(item) <= reset.rev) delete progress[id];
    }
  }

  const merged: Json = {
    progress,
    settings: pickScalar(base?.settings, local?.settings, remote?.settings) ??
      local?.settings ??
      remote?.settings ??
      {},
  };

  // 「最近一次学完一轮」只前进不后退
  const learnedDay = Math.max(num(base?.learnedDay), num(local?.learnedDay), num(remote?.learnedDay));
  if (learnedDay > 0) merged.learnedDay = learnedDay;

  // 学习 / 复习会话：三方合并，**删除也算一种状态**（学完 / 复习完会删）。
  // 只看两边的旧实现会让已经结束的会话从另一台设备上「复活」——
  // 那正是以前「复习完又变回待复习」的同一族 bug。
  const sessions = mergeSessionsWithBase(
    asSessions(base?.sessions),
    asSessions(local?.sessions),
    asSessions(remote?.sessions),
  );
  if (sessions) merged.sessions = sessions;

  // 老的 `retry` / `review` / `round` 字段**原样丢掉**：它们已经迁进
  // `sessions`，照抄过来等于让旧快照把新记录盖回去。
  return merged;
}

/**
 * 合并一份题库的可同步状态。三个输入都可能是 `undefined`
 * （老数据没有 `state`、或某一边压根没有进度）。
 */
export function mergeBankState(params: {
  base?: unknown;
  local?: unknown;
  remote?: unknown;
  mode: "quiz" | "memory";
}): Json | undefined {
  const base = asRecord(params.base);
  const local = asRecord(params.local);
  const remote = asRecord(params.remote);
  if (local === undefined && remote === undefined && base === undefined) return undefined;

  // **按登记过的字段逐条构造**，不是"拷一份本地再改几个"。
  //
  // 以前是 `{...local}` 打底、只覆写 4 个硬编码字段，于是**没登记**的字段原样
  // 来自本地 ⇒ 合并**不满足交换律**（`merge(l,r)` 与 `merge(r,l)` 得到不同的值，
  // 也就是"A 算出 X、B 算出 Y"）。改成显式构造之后，没登记的字段既不会被同步，
  // 也不会影响结果。
  const hasMemory =
    asRecord(local?.memory) !== undefined ||
    asRecord(remote?.memory) !== undefined ||
    asRecord(base?.memory) !== undefined;

  /**
   * 「重置」是一条**会传播的删除**。
   *
   * `masteredIds` 是 highWaterSet（只涨不落），一次重置在合并时会被另一台设备的
   * 旧值原样复活——这就是「A 重置了进度，同步之后又全回来了」。现在重置会盖一个
   * `resetRev`，两边不一致时**戳大的那一侧整段赢**：它的 `masteredIds` /
   * `masteredMistakes` 作为基，另一侧只贡献「重置之后才动过」的池子条目
   * （条目上有 `rev`，所以能分出新旧）。
   *
   * 取舍（有意接受）：`masteredIds` 没有逐条时间戳，所以「重置后在**另一台**
   * 设备上新掌握的题」会被这一次覆盖丢掉。重置本来就是「清空一切」的强操作。
   */
  const localResetRev = num(local?.resetRev);
  const remoteResetRev = num(remote?.resetRev);
  const resetRev = Math.max(num(base?.resetRev), localResetRev, remoteResetRev);
  const resetWinner =
    localResetRev === remoteResetRev
      ? undefined
      : localResetRev > remoteResetRev
        ? local
        : remote;

  const mergedMemory = mergeMemorySection(
    asRecord(base?.memory),
    asRecord(local?.memory),
    asRecord(remote?.memory),
    resetWinner && resetRev > 0 ? { rev: resetRev, winner: resetWinner } : undefined,
  );

  const merged: Json = {};
  if (resetWinner) {
    // 重置过的那一侧整段赢：不再跟另一侧做并集 / 逐键取大
    merged.masteredIds = strArray(resetWinner.masteredIds);
    merged.masteredMistakes = asRecord(resetWinner.masteredMistakes) ?? {};
  } else {
    merged.masteredIds =
      params.mode === "memory" && hasMemory
        ? ((mergedMemory.masteredIds as string[] | undefined) ?? [])
        : // 记忆模式**但两边都没有 `memory` 段**时不能走上面那条：投影会得到 `[]`，
          // 把掌握的题抹掉。这种形状只在"题库模式变了"之类的边界上出现，退回集合合并。
          mergeHighWaterSet(base?.masteredIds, local?.masteredIds, remote?.masteredIds);
    merged.masteredMistakes = mergeNumberRecord(
      base?.masteredMistakes,
      local?.masteredMistakes,
      remote?.masteredMistakes,
    );
  }
  merged.currentRound = Math.max(
    num(base?.currentRound),
    num(local?.currentRound),
    num(remote?.currentRound),
  );
  // 活动池：记忆模式不落盘（学习轮 / 复习队列在 `memory.sessions` 里），
  // 只有刷题模式需要合。合完再把已掌握的题摘掉。
  const mergedActivePool =
    params.mode === "memory"
      ? []
      : mergeActivePool(local?.activePool, remote?.activePool);
  const mergedMastered = new Set((merged.masteredIds as string[]) ?? []);
  const winnerPoolIds = new Set(
    (resetWinner ? asPool(resetWinner.activePool) : []).map((item) => item.id),
  );
  merged.activePool = mergedActivePool.filter((item) => {
    if (mergedMastered.has(item.id)) return false;
    // 重置之后才动过的条目（`rev` 更大）留着；重置之前的旧池子别复活
    if (resetWinner && resetRev > 0 && !winnerPoolIds.has(item.id)) {
      return (item.rev ?? 0) > resetRev;
    }
    return true;
  });
  merged.settings = pickScalar(base?.settings, local?.settings, remote?.settings) ??
    local?.settings ??
    remote?.settings ??
    {};
  if (resetRev > 0) merged.resetRev = resetRev;
  // 屏上会话：整条 LWW。两边都没有时不留空壳
  const quizSession = mergeQuizSession(
    asQuizSession(local?.quizSession),
    asQuizSession(remote?.quizSession),
  );
  if (quizSession) merged.quizSession = quizSession;
  if (hasMemory) merged.memory = mergedMemory;

  return merged;
}

/** 合并一份题库快照（题目 + 可同步状态）。调用方保证题目一致（内容哈希相同）。 */
export function mergeBankSnapshot(params: {
  base?: unknown;
  local: Json;
  remote: unknown;
  mode: "quiz" | "memory";
}): Json {
  const remote = asRecord(params.remote);
  const state = mergeBankState({
    base: params.base,
    local: params.local.state,
    remote: remote?.state,
    mode: params.mode,
  });
  return {
    ...params.local,
    ...(state === undefined ? {} : { state }),
  };
}

/**
 * 两份快照的**可同步状态**一样吗（跳过写入 / 不报「合并进度」用）。
 *
 * 比的是 `state` 那一层，不是整个快照：拿整份快照进来会把 `mode` / `name` /
 * `questions` 也比进去（改个名就判成"进度变了"），而且 `state` 里的设备本地字段
 * 也得按同一套口径剥掉。以前这里剥错了层，只是当时没有调用方才没炸。
 */
export function sameProgress(a: unknown, b: unknown): boolean {
  return same(
    stripDeviceLocal(asRecord(a)?.state) ?? null,
    stripDeviceLocal(asRecord(b)?.state) ?? null,
  );
}

export { SYNCED_BANK_FIELDS };
