/**
 * 记忆模式总览的筛选状态。
 *
 * 与刷题模式的 `src/features/quiz/reviewFilters.ts` 对应，口径换成记忆模式：
 *   - `learning`：学习进度（未学习 / 学习中 / 已掌握），复习中的卡片不受它影响
 *   - `due`：复习中卡片的下次复习时间范围（今天 / 近期 / 以后）
 * 搜索是对编号、题干、答案的模糊匹配，和刷题模式一样由 `searchTerm` 单独承载。
 *
 * 另外两个导出用的纯函数（`hasMemoryScope` / `describeMemoryScope`）也放在这里，
 * 与刷题模式把「导出作用域是否有内容」「导出名后缀」放在 `reviewFilters.ts`
 * 的分工一致——导出按钮的显隐与题库名的生成必须用同一份判定。
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

/** 一道卡片的「学习进度」归类；复习中的卡片返回 null（它由复习进度管）。 */
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

/** 判断一道卡片是否落在筛选范围内。`daysUntilDue` 只对复习中的卡片有意义。 */
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

/**
 * 总览当前是否收窄了卡片范围（搜索和结构化筛选算同一级别）。
 * 与刷题模式的 `hasReviewScope` 同一口径：只敲了空格的搜索词不算收窄——
 * 它匹配的是全部卡片，标成「筛选生效」只会误导人。
 */
export function hasMemoryScope(
  state: MemoryFilterState,
  searchTerm: string,
): boolean {
  return (
    state.learning.size > 0 || state.due.size > 0 || searchTerm.trim() !== ""
  );
}

/** 导出题库名里的标签与顺序都跟着筛选栏的选项排，读起来与界面一致 */
const LEARNING_LABELS: [MemoryLearningStatus, string][] = [
  ["mastered", "已掌握"],
  ["learning", "学习中"],
  ["unlearned", "未学习"],
];

const DUE_LABELS: [MemoryDueStatus, string][] = [
  ["today", "今天复习"],
  ["tomorrow", "明天复习"],
  ["soon", "近期复习"],
  ["later", "以后复习"],
];

/**
 * 生成导出题库名里的筛选描述后缀，如「已掌握+今天复习」。
 *
 * 分隔符与「搜索：」前缀沿用刷题模式的 `describeReviewScope`：两种模式的导出
 * 结果并排躺在侧边栏的题库列表里，名字形状应当是同一种。无筛选时返回空串，
 * 调用方据此不加后缀（名字就是原题库名）。
 */
export function describeMemoryScope(
  state: MemoryFilterState,
  searchTerm: string,
): string {
  const parts: string[] = [];
  for (const [key, label] of LEARNING_LABELS) {
    if (state.learning.has(key)) parts.push(label);
  }
  for (const [key, label] of DUE_LABELS) {
    if (state.due.has(key)) parts.push(label);
  }

  // 搜索词按刷题模式的做法折成一行：换行 / 连续空格会让题库名看起来断掉
  const query = searchTerm.trim().replace(/\s+/g, " ");
  if (query) parts.push(`搜索：${query}`);

  return parts.join("+");
}
