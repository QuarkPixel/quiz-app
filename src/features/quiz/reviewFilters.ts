import type { Question, RuntimeState } from "@/types";
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
 */
export interface ReviewFilterState {
  learning: Set<LearningStatus>;
  correctness: { correct: boolean; incorrect: boolean };
}

export function createReviewFilterState(): ReviewFilterState {
  return {
    learning: new Set(),
    correctness: { correct: false, incorrect: false },
  };
}

/** 第二层的有效模式：两个都不选或都选 = 不过滤；只选一个 = 那一个。 */
function correctnessMode(state: ReviewFilterState): "all" | Correctness {
  const { correct, incorrect } = state.correctness;
  if (correct === incorrect) return "all"; // 都 false 或都 true
  return correct ? "correct" : "incorrect";
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

  return questions.filter((question) => {
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

/** 筛选是否处于「无任何过滤」的初始状态。 */
export function isFilterEmpty(state: ReviewFilterState): boolean {
  const correctness =
    state.correctness.correct === false &&
    state.correctness.incorrect === false;
  return state.learning.size === 0 && correctness;
}

/**
 * 生成用于导出题库名的筛选描述后缀，如「已掌握 学习中 正确」。
 * 无任何筛选时返回空串。
 */
export function describeFilter(state: ReviewFilterState): string {
  const parts: string[] = [];

  const learningLabels: Record<LearningStatus, string> = {
    mastered: "已掌握",
    learning: "学习中",
    unlearned: "未学习",
  };
  const order: LearningStatus[] = ["mastered", "learning", "unlearned"];
  for (const status of order) {
    if (state.learning.has(status)) parts.push(learningLabels[status]);
  }

  const { correct, incorrect } = state.correctness;
  if (correct !== incorrect) parts.push(correct ? "正确" : "错误");

  return parts.join(" ");
}
