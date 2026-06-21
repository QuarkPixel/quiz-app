import type { ActivePoolItem, Question, QuestionType } from "@/types";

/** 复习列表里每道题旁的进度指示器数据。 */
export interface ReviewIndicator {
  item: ActivePoolItem;
  requiredStreak: number;
  maxLevel: number;
}

/** 按题型分组后的单条条目。 */
export interface GroupedItem {
  question: Question;
  indicator: ReviewIndicator | null;
}

/** 按题型分组的题目组。 */
export interface QuestionGroup {
  type: QuestionType;
  items: GroupedItem[];
}

// ── 虚拟滚动扁平化结构 ────────────────────────────────────────────────

export interface FlatHeader {
  type: "header";
  id: string;
  questionType: QuestionType;
  count: number;
}

export interface FlatQuestion {
  type: "question";
  id: string;
  question: Question;
  indicator: ReviewIndicator | null;
}

export type FlatItem = FlatHeader | FlatQuestion;

/** 一个题型 section：sticky 头 + 该题型的题目列表。 */
export interface Section {
  header: FlatHeader;
  questionItems: FlatQuestion[];
}

/** 带绝对布局信息的 section，用于虚拟滚动定位。 */
export interface SectionLayout extends Section {
  y: number;
  headerHeight: number;
  questionsTotalHeight: number;
  questionOffsets: number[];
}
