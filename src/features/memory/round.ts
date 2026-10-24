/**
 * 记忆模式「学习轮」的模型 —— **纯函数，不碰 Svelte、不碰存储**。
 *
 * ── 为什么单独一个文件 ──────────────────────────────────────────────────────
 *
 * 「一轮」原先没有模型，它是**六份各自落盘的字段**拼出来的：
 *
 *   `roundGoal`（本轮目标）、`roundMastered`（已掌握几道）、`activePool`（池子）、
 *   `learningPool`（复习期间池子的暂存位）、`roundPoolIds`（锁定模式下这一批是谁）、
 *   以及每道卡的 `progress.streak`（轮内连对）。
 *
 * 这六份字段**谁也不知道谁**：改设置只改目标、毕业只加计数、`endRound` 要记得
 * 把五样一起清零……漏一样就是一个 bug。用户报的那条正是其中之一：
 *
 *   > 每轮设 5 题。学了两题后「结束本轮」，下次开新一轮时界面说还有 5 题，
 *   > 但学到第三题就突然结束了。
 *
 * 因为 `roundGoal` 是**设置值的快照**（5），而这一轮实际能学几道是**题库的事实**
 * （剩下 3 道）。两个数没有一处负责对账，于是「目标 5」配着「池子 3」，
 * 池子一空本轮就收尾 —— 进度条停在 3 / 5。
 *
 * 现在把这一轮收成一个对象 `MemoryRoundState`（类型在 `@/types`），并规定三条
 * **构造即成立**的不变式：
 *
 *   1. `masteredIds ⊆ cardIds`（掌握的一定在这一批里）
 *   2. `1 ≤ goal ≤ cardIds.length`（目标不会超过这一批能学出来的数量）
 *   3. `remaining = cardIds - masteredIds`（池子就是这个差集，见 `MemorySession.syncPoolToRound`）
 *
 * 第 2 条是治本的那一条：**目标从"设置"变成"这一轮真的能做到的事"**。
 * 题库只剩 3 道可学，这一轮的目标就是 3（界面 0/3、结束 3/3），
 * 而不是顶着 5 的帽子学到第 3 道就莫名其妙收尾。
 */

import type { MemoryRoundState } from "@/types";

/** 目标的下界：一轮至少要有 1 道，否则「本轮完成」没有意义。 */
const MIN_GOAL = 1;

function uniqueIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/**
 * 开一轮：`cardIds` 是这一批卡（顺序即挑选顺序），`target` 是设置里的
 * 「每轮学几题」。目标取两者的小值 —— 见文件头的不变式 2。
 *
 * 一道卡都没有时返回 `null`：那时根本开不出一轮，调用方该回首页而不是
 * 造一个 0 目标的空轮。
 */
export function createMemoryRound(
  cardIds: readonly string[],
  target: number,
): MemoryRoundState | null {
  const ids = uniqueIds(cardIds);
  if (ids.length === 0) return null;
  const wanted = Number.isFinite(target) ? Math.floor(target) : ids.length;
  return {
    goal: Math.min(Math.max(MIN_GOAL, wanted), ids.length),
    cardIds: ids,
    masteredIds: [],
  };
}

/**
 * 往这一轮里补卡（「每掌握一题就补一题」时用）。
 *
 * **目标不跟着涨**：目标是开轮时对用户许下的数量，补卡只是让池子别空着。
 * 已经在这一批里的 id 不会重复加入。
 */
export function addMemoryRoundCards(
  round: MemoryRoundState,
  ids: readonly string[],
): MemoryRoundState {
  const known = new Set(round.cardIds);
  const added = uniqueIds(ids).filter((id) => !known.has(id));
  if (added.length === 0) return round;
  return { ...round, cardIds: [...round.cardIds, ...added] };
}

/**
 * 记一道卡「本轮已掌握」。
 *
 * 不在这批里的卡（例如总览里标熟了本轮之外的一道）**原样返回**：
 * 它不属于这一轮，不该把这一轮的进度顶上去。
 */
export function markMemoryRoundMastered(
  round: MemoryRoundState,
  id: string,
): MemoryRoundState {
  if (!round.cardIds.includes(id) || round.masteredIds.includes(id)) {
    return round;
  }
  return { ...round, masteredIds: [...round.masteredIds, id] };
}

/** 本轮还没掌握的卡（池子就是它，顺序与 `cardIds` 一致）。 */
export function memoryRoundRemaining(round: MemoryRoundState): string[] {
  const mastered = new Set(round.masteredIds);
  return round.cardIds.filter((id) => !mastered.has(id));
}

/** 本轮已掌握几道。 */
export function memoryRoundDone(round: MemoryRoundState): number {
  return round.masteredIds.length;
}

/** 这一轮学完了没有。 */
export function isMemoryRoundComplete(round: MemoryRoundState): boolean {
  return memoryRoundDone(round) >= round.goal;
}

/**
 * 净化一份落盘的轮（`localStorage` / 旧版本 / 手改过的数据）。
 *
 * - `validIds`：题库里真实存在的题目 id。传了就只保留这些（题被删 / id 改过
 *   之后，留在这一批里只会让这一轮少几道卡、甚至永远学不完）
 * - 目标重新按 `cardIds.length` 收敛：不变式 2 在**每一次读盘时**都成立，
 *   不依赖写入方记不记得
 * - 学不出来的空轮（`cardIds` 被删空）返回 `undefined`，调用方按「没有进行中的一轮」处理
 */
export function normalizeMemoryRound(
  raw: unknown,
  validIds?: ReadonlySet<string>,
): MemoryRoundState | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const value = raw as Partial<Record<keyof MemoryRoundState, unknown>>;

  const cardIds = uniqueIds(Array.isArray(value.cardIds) ? value.cardIds : []).filter(
    (id) => validIds === undefined || validIds.has(id),
  );
  if (cardIds.length === 0) return undefined;

  const inBatch = new Set(cardIds);
  const masteredIds = uniqueIds(
    Array.isArray(value.masteredIds) ? value.masteredIds : [],
  ).filter((id) => inBatch.has(id));

  const rawGoal =
    typeof value.goal === "number" && Number.isFinite(value.goal)
      ? Math.floor(value.goal)
      : cardIds.length;

  return {
    goal: Math.min(Math.max(MIN_GOAL, rawGoal), cardIds.length),
    cardIds,
    masteredIds,
  };
}

/**
 * 把这一批里「已经不属于本轮」的卡剔掉，并把目标重新收敛（不变式 2）。
 *
 * 什么卡会掉出去：题库被改（题没了）、卡在别处被标熟 / 学出来了（`progress`
 * 已经不是 `learning`）。**已掌握的那几张始终留着**——它们算在本轮进度里，
 * 剔掉的话这一轮的 `done` 会凭空变少、永远学不完。
 *
 * 一张都不剩时返回 `null`：这一轮已经名存实亡，调用方按「没有进行中的一轮」处理。
 */
export function pruneMemoryRound(
  round: MemoryRoundState,
  keep: (id: string) => boolean,
): MemoryRoundState | null {
  const mastered = new Set(round.masteredIds);
  return (
    normalizeMemoryRound({
      goal: round.goal,
      cardIds: round.cardIds.filter((id) => mastered.has(id) || keep(id)),
      masteredIds: round.masteredIds,
    }) ?? null
  );
}

/**
 * 从旧版本的三份字段拼出一轮（一次性迁移，`store.ts` 读盘时用）。
 *
 * 旧版把「目标」「已掌握几道」「这一批是谁」分开存，而且**没记哪几道已掌握**
 * ——所以只能近似：把池子里还没学完的卡当作这一批，已掌握数丢弃（进度条从
 * 0 重新数）。宁可少算，也不要凭空造出「已掌握」的卡。
 *
 * 候选按「离这一轮有多近」排：复习期间暂存的 `learningPool`（那时 `activePool`
 * 是到期队列）> 锁定模式记下的 `roundPoolIds` > 当前的 `activePool`。
 *
 * 目标同样收敛到 `cardIds.length`：迁移完的一轮必须学得完。
 */
export function migrateLegacyMemoryRound(input: {
  roundGoal?: unknown;
  roundPoolIds?: unknown;
  learningPoolIds?: readonly string[];
  activePoolIds: readonly string[];
  validIds?: ReadonlySet<string>;
}): MemoryRoundState | undefined {
  const firstNonEmpty = (...candidates: readonly unknown[]): readonly unknown[] =>
    candidates.find(
      (ids): ids is readonly unknown[] => Array.isArray(ids) && ids.length > 0,
    ) ?? [];

  const rawIds = firstNonEmpty(
    input.learningPoolIds ?? [],
    input.roundPoolIds,
    input.activePoolIds,
  );
  const cardIds = uniqueIds(rawIds).filter(
    (id) => input.validIds === undefined || input.validIds.has(id),
  );
  if (cardIds.length === 0) return undefined;

  const goal =
    typeof input.roundGoal === "number" && Number.isFinite(input.roundGoal)
      ? Math.floor(input.roundGoal)
      : cardIds.length;

  return {
    goal: Math.min(Math.max(MIN_GOAL, goal), cardIds.length),
    cardIds,
    masteredIds: [],
  };
}
