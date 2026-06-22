import type { Question, RuntimeState } from "@/types";
import { QUESTION_TYPES_LOGIC } from "@/quiz/types/registry-logic";
import {
  getCorrectness,
  getLearningStatus,
  type Correctness,
  type LearningStatus,
} from "./questionClassification";

/**
 * 复习页的两层筛选状态。
 *
 * - `learning`：第一层（学习进度）多选，空集 = 全部。
 * - `correctness`：第二层（正误）两个独立开关。
 * - `types`：第三层（题型）多选，空集 = 全部。
 */
export interface ReviewFilterState {
  learning: Set<LearningStatus>;
  correctness: Set<Correctness>;
  types: Set<Question["type"]>;
}

export function createReviewFilterState(): ReviewFilterState {
  return {
    learning: new Set(),
    correctness: new Set(),
    types: new Set(),
  };
}

/** 第二层的有效模式：两个都不选或都选 = 不过滤；只选一个 = 那一个。 */
function correctnessMode(state: ReviewFilterState): "all" | Correctness {
  const hasCorrect = state.correctness.has("correct");
  const hasIncorrect = state.correctness.has("incorrect");
  if (hasCorrect === hasIncorrect) return "all"; // 都不选或都选
  return hasCorrect ? "correct" : "incorrect";
}

/**
 * 应用两层筛选。
 *
 * 严格 AND 模型（已与用户确认）：
 * 1. 第一层非空时，仅保留选中的学习状态；空集 = 全部。
 * 2. 第二层 mode === "all" 时不过滤正误。
 * 3. 第二层为 exactly-one 时：
 *    - 已掌握 / 学习中：正误需匹配 mode。
 *    - 未学习：仅当「未学习」在第一层被显式选中时展示（忽略第二层）；
 *      否则排除。等价于「未学习既是正确也是错误，但仅在未学习被选中时生效」。
 */
export function applyReviewFilter(
  questions: Question[],
  state: ReviewFilterState,
  runtime: RuntimeState,
): Question[] {
  const learningFilter = state.learning;
  const hasLearningFilter = learningFilter.size > 0;
  const mode = correctnessMode(state);
  const unlearnedSelected = learningFilter.has("unlearned");

  const typeFilter = state.types;
  const hasTypeFilter = typeFilter.size > 0;

  return questions.filter((question) => {
      // 第三层：题型筛选（最先判断，短路掉不匹配的题）
      if (hasTypeFilter && !typeFilter.has(question.type)) return false;

      const status = getLearningStatus(question, runtime);

      // 第一层：非空时按状态硬筛
      if (hasLearningFilter && !learningFilter.has(status)) return false;

      // 第二层：mode === "all" 时不过滤
      if (mode === "all") return true;

      // 未学习：仅在被显式选中时展示，忽略第二层
      if (status === "unlearned") return unlearnedSelected;

      // 已掌握 / 学习中：按正误匹配
      return getCorrectness(question, runtime) === mode;
  });
}

export function normalizeReviewSearchTerm(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function matchesReviewSearch(question: Question, query: string): boolean {
  if (query.length === 0) return true;
  const typeDef = QUESTION_TYPES_LOGIC[question.type];
  return [
    question.id,
    question.question,
    typeDef.formatAnswerText(question),
  ].some((text) => String(text ?? "").toLocaleLowerCase().includes(query));
}

/**
 * 复习页的完整作用域：
 * 先应用结构化筛选，再应用搜索文本。
 */
export function applyReviewScope(
  questions: Question[],
  state: ReviewFilterState,
  runtime: RuntimeState,
  searchTerm: string,
): Question[] {
  const query = normalizeReviewSearchTerm(searchTerm);
  return applyReviewFilter(questions, state, runtime).filter((question) =>
    matchesReviewSearch(question, query),
  );
}

/** 筛选是否处于「无任何过滤」的初始状态。 */
export function isFilterEmpty(state: ReviewFilterState): boolean {
  return Object.values(state).every((filter: Set<any>) => filter.size === 0);
}

/** 复习页当前是否收窄了题目范围（搜索和结构化筛选算同一级别）。 */
export function hasReviewScope(
  state: ReviewFilterState,
  searchTerm: string,
): boolean {
  return !isFilterEmpty(state) || normalizeReviewSearchTerm(searchTerm) !== "";
}

/**
 * 生成用于导出题库名的筛选描述后缀，如「已掌握 学习中 正确」。
 * 无任何筛选时返回空串。
 */
export function describeFilter(state: ReviewFilterState): string {
  const parts: string[] = [];
  {
    const labelMap: [
      Set<LearningStatus | Correctness | Question["type"]>,
      Record<string, string>,
      string[],
    ][] = [
      [
        state.learning,
        { mastered: "已掌握", learning: "学习中", unlearned: "未学习" },
        ["mastered", "learning", "unlearned"],
      ],
      [
        state.correctness,
        { correct: "正确", incorrect: "错误", none: "" },
        ["correct", "incorrect", "none"],
      ],
      [
        state.types,
        {
          judgment: "判断题",
          single: "单选题",
          multiple: "多选题",
          blank: "填空题",
        },
        ["single", "multiple", "judgment", "blank"],
      ],
    ];
    for (const [filterSet, labels, order] of labelMap) {
      for (const key of order) {
        if (filterSet.has(key as any)) parts.push(labels[key]);
      }
    }
  }

  return parts.join("+");
}

function compactSearchTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * 生成用于导出题库名的完整作用域描述。
 * 例如「已掌握+正确+搜索:foo」。
 */
export function describeReviewScope(
  state: ReviewFilterState,
  searchTerm: string,
): string {
  const parts: string[] = [];
  const filterDescription = describeFilter(state);
  const query = compactSearchTerm(searchTerm);

  if (filterDescription) parts.push(filterDescription);
  if (query) parts.push(`搜索：${query}`);

  return parts.join("+");
}
