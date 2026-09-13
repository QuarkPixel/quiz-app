/**
 * 记忆模式总览的筛选状态。
 *
 * 与刷题模式的 `src/features/quiz/reviewFilters.ts` 对应，口径换成记忆模式：
 *   - `learning`：学习进度（未学习 / 学习中 / 已掌握），复习中的卡片不受它影响
 *   - `due`：复习中卡片的下次复习时间范围（今天 / 近期 / 以后）
 * 搜索是对编号、题干、答案的模糊匹配，和刷题模式一样由 `searchTerm` 单独承载。
 */

import type { MemoryProgress } from "@/types";

export type MemoryLearningStatus = "unlearned" | "learning" | "mastered";
export type MemoryDueStatus = "today" | "tomorrow" | "soon" | "later";

export interface MemoryFilterState {
  learning: Set<MemoryLearningStatus>;
  due: Set<MemoryDueStatus>;
}

/** 「近期复习」的窗口（天） */
export const NEAR_DUE_DAYS = 7;

export function createMemoryFilterState(): MemoryFilterState {
  return { learning: new Set(), due: new Set() };
}

/** 一张卡片的「学习进度」归类；复习中的卡片返回 null（它由复习进度管）。 */
export function learningStatusOf(
  item: MemoryProgress | undefined,
): MemoryLearningStatus | null {
  if (!item) return "unlearned";
  if (item.state === "mastered") return "mastered";
  if (item.state === "learning") return "learning";
  return null;
}

/** 复习中的卡片按「还有几天到期」归类；`days` 为负表示已逾期。 */
export function dueBucket(days: number): MemoryDueStatus {
  if (days <= 0) return "today";
  if (days <= 1) return "tomorrow";
  if (days <= NEAR_DUE_DAYS) return "soon";
  return "later";
}

/** 判断一张卡片是否落在筛选范围内。`daysUntilDue` 只对复习中的卡片有意义。 */
export function matchesMemoryFilter(options: {
  filter: MemoryFilterState;
  searchTerm: string;
  item: MemoryProgress | undefined;
  id: string;
  question: string;
  answer: string;
  daysUntilDue: number | null;
}): boolean {
  const { filter, searchTerm, item, id, question, answer } = options;

  if (filter.learning.size > 0) {
    const status = learningStatusOf(item);
    // 复习中的卡片不参与「学习进度」筛选
    if (status !== null && !filter.learning.has(status)) return false;
  }

  if (filter.due.size > 0) {
    if (item?.state !== "reviewing" || options.daysUntilDue === null) {
      return false;
    }
    if (!filter.due.has(dueBucket(options.daysUntilDue))) return false;
  }

  const term = searchTerm.trim().toLowerCase();
  if (!term) return true;
  return (
    id.toLowerCase().includes(term) ||
    question.toLowerCase().includes(term) ||
    answer.toLowerCase().includes(term)
  );
}
