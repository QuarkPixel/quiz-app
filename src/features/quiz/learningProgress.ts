import { getRequiredStreak } from "@/algorithm";
import type { ActivePoolItem, Question, RuntimeState } from "@/types";

/** 学习中进度条中的一段：level 是稳定身份，width 可为 0 用于平滑过渡 */
export interface LearningSegment {
  level: number;
  color: string;
  widthPercent: number;
}

function mixLearningColor(
  t: number,
  from: string = "var(--learning-color-high)",
  to: string = "var(--learning-color-low)",
): string {
  const highPercent = Math.max(0, Math.min(100, t * 100));
  const lowPercent = 100 - highPercent;
  return `color-mix(in oklch, ${to} ${lowPercent.toFixed(2)}%, ${from} ${highPercent.toFixed(2)}%)`;
}

function toBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.round(numberValue));
}

export function getMaxLearningLevel(state: RuntimeState): number {
  return Math.max(
    toBoundedInteger(state.settings.correctStreakToMaster, 1, 1),
    toBoundedInteger(state.settings.correctStreakAfterMistake, 1, 1),
  );
}

export function getRemainingCorrectLevel(
  item: ActivePoolItem,
  state: RuntimeState,
): number {
  const maxLevel = getMaxLearningLevel(state);
  const requiredStreak = toBoundedInteger(
    getRequiredStreak(item, state),
    maxLevel,
    1,
  );
  const consecutiveCorrect = toBoundedInteger(item.consecutiveCorrect, 0, 0);
  return Math.min(maxLevel, Math.max(1, requiredStreak - consecutiveCorrect));
}

export function getLearningLevelColor(
  level: number,
  maxLevel: number,
  mistake: boolean = false,
): string {
  const normalizedMaxLevel = Math.max(
    0,
    Number.isFinite(maxLevel) ? Math.round(maxLevel) : 0,
  );
  const normalizedLevel = Math.min(
    normalizedMaxLevel,
    Math.max(0, Number.isFinite(level) ? Math.round(level) : 0),
  );
  const t =
    normalizedMaxLevel <= 0 ? 0.5 : normalizedLevel / normalizedMaxLevel;
  return mixLearningColor(
    t,
    undefined,
    mistake ? "var(--destructive)" : undefined,
  );
}

/**
 * 计算学习中进度条的颜色分段。
 *
 * 每道学习中的题目按"还需答对次数"（level = requiredStreak - consecutiveCorrect）
 * 归类，level 越小越接近掌握。按 level 升序排列，相同 level 合并成一段。
 *
 * 颜色规则：
 *   - maxLevel = 1：所有题目共享两端点中点色
 *   - maxLevel > 1：level 在 [1, maxLevel] 间用 OKLCH 线性插值
 */
export function computeLearningSegments(
  questions: Question[],
  state: RuntimeState,
): LearningSegment[] {
  const questionIds = new Set(questions.map((q) => q.id));
  const items = state.activePool.filter((item) => questionIds.has(item.id));

  if (items.length === 0) return [];

  const maxLevel = Math.max(1, getMaxLearningLevel(state));

  const counts = new Map<number, number>();
  for (const item of items) {
    const level = getRemainingCorrectLevel(item, state);
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }

  const total = items.length;

  return Array.from({ length: maxLevel }, (_, index) => {
    const level = index + 1;
    return {
      level,
      color: getLearningLevelColor(level, maxLevel),
      widthPercent: ((counts.get(level) ?? 0) / total) * 100,
    };
  });
}
