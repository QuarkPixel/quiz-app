/**
 * 刷题模式的「屏上会话」——**纯函数，不碰 Svelte、不碰存储**。
 *
 * 它回答的问题只有一个：刷新 / 换设备之后，屏上该是哪一道题、答到哪一步。
 * 长期进度（连对、掌握、池子）不在这里，别把两者混成一个模型：
 *
 *   - `StoredState.masteredIds` / `activePool` → 「学到哪了」
 *   - `StoredState.quizSession`               → 「现在停在哪」
 *
 * 合并规则是**整条取赢家**（`rev` 大的那一侧）：它不是集合，也没有可以逐字段
 * 拼的语义——「A 停在 3 号题、B 停在 7 号题」只能留一条。`rev` 相同就按
 * `currentId` 字典序裁决，保证交换律（`merge(a,b)` 与 `merge(b,a)` 一致）。
 */

import type { QuizSessionState } from "@/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toNonNegativeInt(value: unknown, fallback = 0): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.floor(numberValue));
}

/** 整数数组（作答下标 / 选项顺序）；非法项按 0 处理，超长截断。 */
function intArray(value: unknown, max: number): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .map((item) => toNonNegativeInt(item, 0));
}

/** 字符串数组（填空作答）；非字符串项丢掉。 */
function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, max)
    .filter((item): item is string => typeof item === "string");
}

/** 作答草稿 / 选项顺序的合理上限：防止脏数据把一条记录撑爆。 */
const MAX_ANSWERS = 50;
const MAX_OPTIONS = 200;

export function createQuizSession(params: {
  currentId: string;
  phase?: "asking" | "judged";
  correct?: boolean;
  selectedAnswers?: readonly number[];
  blankAnswerInputs?: readonly string[];
  optionOrder?: readonly number[];
  lastAskedId?: string | null;
  rev?: number;
}): QuizSessionState {
  const phase = params.phase === "judged" ? "judged" : "asking";
  return {
    currentId: params.currentId,
    phase,
    ...(phase === "judged" ? { correct: params.correct === true } : {}),
    selectedAnswers: [...(params.selectedAnswers ?? [])],
    blankAnswerInputs: [...(params.blankAnswerInputs ?? [])],
    optionOrder: [...(params.optionOrder ?? [])],
    ...(params.lastAskedId ? { lastAskedId: params.lastAskedId } : {}),
    rev: toNonNegativeInt(params.rev),
  };
}

/**
 * 净化一条会话；`validIds` 传了就要求 `currentId` 还在题库里。
 *
 * 结构非法 / 题目已被删 → `undefined`（调用方按「没有会话」处理，正常出题）。
 */
export function normalizeQuizSession(
  raw: unknown,
  validIds?: ReadonlySet<string>,
): QuizSessionState | undefined {
  if (!isRecord(raw)) return undefined;
  const currentId = typeof raw.currentId === "string" ? raw.currentId.trim() : "";
  if (currentId.length === 0) return undefined;
  if (validIds !== undefined && !validIds.has(currentId)) return undefined;

  const phase = raw.phase === "judged" ? "judged" : "asking";
  const lastAskedRaw =
    typeof raw.lastAskedId === "string" ? raw.lastAskedId.trim() : "";
  const lastAskedId =
    lastAskedRaw.length > 0 && (validIds === undefined || validIds.has(lastAskedRaw))
      ? lastAskedRaw
      : undefined;

  return {
    currentId,
    phase,
    ...(phase === "judged" ? { correct: raw.correct === true } : {}),
    selectedAnswers: intArray(raw.selectedAnswers, MAX_ANSWERS),
    blankAnswerInputs: stringArray(raw.blankAnswerInputs, MAX_ANSWERS),
    optionOrder: intArray(raw.optionOrder, MAX_OPTIONS),
    ...(lastAskedId ? { lastAskedId } : {}),
    rev: toNonNegativeInt(raw.rev),
  };
}

/**
 * 合并两条会话：整条取 `rev` 大的那一侧。
 *
 * `rev` 相同（两台设备同一毫秒写的）时按 `currentId` 字典序裁决——不是为了
 * 「哪个更对」，只是为了让结果**可交换**（否则两台设备永远算不出同一份）。
 */
export function mergeQuizSession(
  local: QuizSessionState | undefined,
  remote: QuizSessionState | undefined,
): QuizSessionState | undefined {
  if (!local) return remote;
  if (!remote) return local;
  if (local.rev !== remote.rev) {
    return local.rev > remote.rev ? local : remote;
  }
  if (local.currentId !== remote.currentId) {
    return local.currentId < remote.currentId ? local : remote;
  }
  // 同一道题、同一毫秒：按内容的规范化字符串裁决。
  //
  // 不用「取本地 / 取远端」：那违反交换律（`merge(a,b)` 与 `merge(b,a)` 得到
  // 不同结果），两台设备会各算各的。`createQuizSession` / `normalizeQuizSession`
  // 产出的键顺序是固定的，所以 `JSON.stringify` 在这里是确定的全序。
  return JSON.stringify(local) >= JSON.stringify(remote) ? local : remote;
}
