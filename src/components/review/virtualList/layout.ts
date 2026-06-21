import type { Question } from "@/types";
import type {
  FlatItem,
  FlatHeader,
  FlatQuestion,
  QuestionGroup,
  Section,
  SectionLayout,
} from "./types";

/** sticky 题型头的估算高度（未测量时用）。 */
export const ESTIMATED_HEADER_HEIGHT = 41;

/** 视口上下额外预渲染的缓冲像素。 */
export const BUFFER_PX = 400;

/**
 * 按题型估算题目高度（未测量时用）。
 * 单选 / 多选按选项数 62 + n*31.25，默认 4 项 = 187px。
 */
export function estimateQuestionHeight(question: Question): number {
  switch (question.type) {
    case "single":
    case "multiple": {
      const n = question.options?.length ?? 4;
      return 62 + n * 31.25;
    }
    case "judgment":
    case "blank":
      return 86;
  }
}

/** 把按题型分组的题目扁平化成 header + questions 序列。 */
export function buildFlatItems(grouped: QuestionGroup[]): FlatItem[] {
  return grouped.flatMap((group) => {
    const header: FlatHeader = {
      type: "header",
      id: `header-${group.type}`,
      questionType: group.type,
      count: group.items.length,
    };
    const questions: FlatQuestion[] = group.items.map((item) => ({
      type: "question",
      id: item.question.id,
      question: item.question,
      indicator: item.indicator,
    }));
    return [header, ...questions];
  });
}

/** 把扁平序列重新按 header 切分成 section。 */
export function buildSections(flatItems: FlatItem[]): Section[] {
  const result: Section[] = [];
  let current: Section | null = null;
  for (const item of flatItems) {
    if (item.type === "header") {
      current = { header: item, questionItems: [] };
      result.push(current);
    } else {
      current?.questionItems.push(item);
    }
  }
  return result;
}

/**
 * 高度解析函数：优先用真实测量值，缺失时回退到 fallback。
 * 由控制器注入，封装 actualHeights / measuredHeights / 估算的优先级。
 */
export type ResolveHeight = (id: string, fallback: number) => number;

/** 计算每个 section 的绝对位置与内部题目偏移。 */
export function buildSectionLayouts(
  sections: Section[],
  resolveHeight: ResolveHeight,
): SectionLayout[] {
  let y = 0;
  return sections.map((section) => {
    const headerHeight = resolveHeight(
      section.header.id,
      ESTIMATED_HEADER_HEIGHT,
    );
    const questionHeights = section.questionItems.map((q) =>
      resolveHeight(q.id, estimateQuestionHeight(q.question)),
    );
    const questionsTotalHeight = questionHeights.reduce((a, b) => a + b, 0);

    const questionOffsets: number[] = [];
    let offset = 0;
    for (const h of questionHeights) {
      questionOffsets.push(offset);
      offset += h;
    }

    const layout: SectionLayout = {
      ...section,
      y,
      headerHeight,
      questionsTotalHeight,
      questionOffsets,
    };
    y += headerHeight + questionsTotalHeight;
    return layout;
  });
}

/**
 * 计算某个 section 内当前应渲染的题目下标范围。
 * 不在视口（含缓冲）内返回 null。
 */
export function getVisibleRange(
  section: SectionLayout,
  scrollTop: number,
  viewportHeight: number,
  resolveHeight: ResolveHeight,
): { start: number; end: number } | null {
  const qStart = section.y + section.headerHeight;
  const qEnd = qStart + section.questionsTotalHeight;

  if (
    qEnd <= scrollTop - BUFFER_PX ||
    qStart >= scrollTop + viewportHeight + BUFFER_PX
  ) {
    return null;
  }

  if (section.questionItems.length === 0) return null;

  const viewStart = scrollTop - BUFFER_PX;
  const viewEnd = scrollTop + viewportHeight + BUFFER_PX;

  let startIdx = section.questionItems.length;
  let endIdx = -1;

  for (let i = 0; i < section.questionItems.length; i++) {
    const qItem = section.questionItems[i];
    const itemTop = qStart + section.questionOffsets[i];
    const itemH = resolveHeight(
      qItem.id,
      estimateQuestionHeight(qItem.question),
    );
    const itemBottom = itemTop + itemH;

    if (itemBottom > viewStart && itemTop < viewEnd) {
      if (i < startIdx) startIdx = i;
      if (i > endIdx) endIdx = i;
    }
  }

  if (startIdx > endIdx) return null;
  return { start: startIdx, end: endIdx };
}

/** 某道题在滚动容器中的目标 scrollTop（让其落在视口中央）。 */
export function findQuestionTop(
  layouts: SectionLayout[],
  id: string,
  viewportHeight: number,
  resolveHeight: ResolveHeight,
): number | null {
  for (const section of layouts) {
    const qIdx = section.questionItems.findIndex((q) => q.id === id);
    if (qIdx === -1) continue;

    const height = resolveHeight(
      id,
      estimateQuestionHeight(section.questionItems[qIdx].question),
    );
    const questionY =
      section.y + section.headerHeight + section.questionOffsets[qIdx];
    return questionY - viewportHeight / 2 + height / 2;
  }
  return null;
}

/** 题目全局序号：跳转收敛时用「真实挂载顺序」判断方向，绕开累积估算误差。 */
export function buildIdToRank(flatItems: FlatItem[]): Map<string, number> {
  const map = new Map<string, number>();
  flatItems.forEach((item, i) => map.set(item.id, i));
  return map;
}
