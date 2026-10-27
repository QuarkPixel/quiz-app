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

/**
 * section 头。
 *
 * `null` = 这段没有分组头（记忆模式只有一种题型，用户不要那条标题条）：
 * 布局里它的高度按 0 算，渲染时跳过 sticky 头。
 */
export type SectionHeader = FlatHeader | null;

/** 一个 section：sticky 头（可能没有）+ 该段的题目列表。 */
export interface Section {
  header: SectionHeader;
  questionItems: FlatQuestion[];
}

/**
 * 自定义行渲染（`QuestionListSection` 的 `row` snippet）拿到的上下文。
 *
 * 传了 `row` 就由调用方画整行（记忆模式的「状态 + 题号」），列表只负责
 * 把它放进虚拟布局里、并在跳转时透传高亮。
 */
export interface QuestionRowContext {
  question: Question;
  /** 是不是刚从热力图跳过来的那一张（计时在调用方，列表只透传） */
  highlight: boolean;
}

/** 带绝对布局信息的 section，用于虚拟滚动定位。 */
export interface SectionLayout extends Section {
  y: number;
  headerHeight: number;
  questionsTotalHeight: number;
  questionOffsets: number[];
}
