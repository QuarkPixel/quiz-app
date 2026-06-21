import { describe, it, expect } from "vitest";
import {
  applyReviewFilter,
  createReviewFilterState,
  describeFilter,
  isFilterEmpty,
} from "../src/features/quiz/reviewFilters";
import type { LearningStatus } from "../src/features/quiz/questionClassification";
import {
  createActivePoolItem,
  createDefaultSettings,
  createDefaultUiPreferences,
} from "../src/store";
import type {
  ActivePoolItem,
  Question,
  QuestionType,
  RuntimeState,
  UserSettings,
} from "../src/types";

function makeQuestion(
  id: string,
  type: QuestionType = "judgment",
): Question {
  return { id, type, question: `q-${id}`, answer: true };
}

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  const defaultState: RuntimeState = {
    masteredIds: [],
    masteredMistakes: {},
    activePool: [],
    pendingIds: [],
    currentRound: 0,
    filterType: "all",
    settings: createDefaultSettings() as UserSettings,
    ui: createDefaultUiPreferences(),
  };
  return {
    ...defaultState,
    ...overrides,
    settings: overrides.settings ?? defaultState.settings,
    ui: overrides.ui ?? defaultState.ui,
  };
}

function poolItem(
  id: string,
  patch: Partial<ActivePoolItem> = {},
): ActivePoolItem {
  return { ...createActivePoolItem(id), ...patch };
}

// 题目布局：
//   m1 已掌握、曾错 → incorrect
//   m2 已掌握、未错 → correct
//   l1 学习中、曾错 → incorrect
//   l2 学习中、未错 → correct
//   u1 未学习 → none
//   u2 未学习 → none
function fixture(): { questions: Question[]; state: RuntimeState } {
  const questions = [
    makeQuestion("m1"),
    makeQuestion("m2"),
    makeQuestion("l1"),
    makeQuestion("l2"),
    makeQuestion("u1"),
    makeQuestion("u2"),
  ];
  const state = makeState({
    masteredIds: ["m1", "m2"],
    masteredMistakes: { m1: true, m2: false },
    activePool: [
      poolItem("l1", { hasEverMistaken: true }),
      poolItem("l2", { hasEverMistaken: false }),
    ],
  });
  return { questions, state };
}

function filter(
  learning: LearningStatus[] = [],
  correctness: { correct?: boolean; incorrect?: boolean } = {},
) {
  return {
    learning: new Set(learning),
    correctness: {
      correct: correctness.correct ?? false,
      incorrect: correctness.incorrect ?? false,
    },
  };
}

function ids(questions: Question[]): string[] {
  return questions.map((q) => q.id);
}

describe("applyReviewFilter", () => {
  it("无任何筛选 → 全部题目", () => {
    const { questions, state } = fixture();
    expect(ids(applyReviewFilter(questions, filter(), state))).toEqual([
      "m1",
      "m2",
      "l1",
      "l2",
      "u1",
      "u2",
    ]);
  });

  it("第一层 {已掌握}", () => {
    const { questions, state } = fixture();
    expect(ids(applyReviewFilter(questions, filter(["mastered"]), state))).toEqual([
      "m1",
      "m2",
    ]);
  });

  it("第一层 {学习中}", () => {
    const { questions, state } = fixture();
    expect(ids(applyReviewFilter(questions, filter(["learning"]), state))).toEqual([
      "l1",
      "l2",
    ]);
  });

  it("第一层 {未学习}", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter(["unlearned"]), state)),
    ).toEqual(["u1", "u2"]);
  });

  it("第一层 {已掌握, 学习中} 多选", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter(["mastered", "learning"]), state)),
    ).toEqual(["m1", "m2", "l1", "l2"]);
  });

  it("第二层 只看正确（第一层空）→ 未学习被排除", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter([], { correct: true }), state)),
    ).toEqual(["m2", "l2"]);
  });

  it("第二层 只看错误（第一层空）→ 未学习被排除", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter([], { incorrect: true }), state)),
    ).toEqual(["m1", "l1"]);
  });

  it("第二层 两个都勾选 == 都不勾选", () => {
    const { questions, state } = fixture();
    const both = applyReviewFilter(
      questions,
      filter([], { correct: true, incorrect: true }),
      state,
    );
    expect(ids(both)).toEqual(["m1", "m2", "l1", "l2", "u1", "u2"]);
  });

  // 规范的 4 个特殊逻辑例子（严格 AND，例1 已与用户确认修正）
  it("例1: {未学习} + 正确 → 仅所有未学习", () => {
    const { questions, state } = fixture();
    expect(
      ids(
        applyReviewFilter(
          questions,
          filter(["unlearned"], { correct: true }),
          state,
        ),
      ),
    ).toEqual(["u1", "u2"]);
  });

  it("例2: {学习中, 未学习} + 正确 → 学习中答对 + 所有未学习", () => {
    const { questions, state } = fixture();
    expect(
      ids(
        applyReviewFilter(
          questions,
          filter(["learning", "unlearned"], { correct: true }),
          state,
        ),
      ),
    ).toEqual(["l2", "u1", "u2"]);
  });

  it("例3: {已掌握, 未学习} + 错误 → 已掌握错误 + 所有未学习", () => {
    const { questions, state } = fixture();
    expect(
      ids(
        applyReviewFilter(
          questions,
          filter(["mastered", "unlearned"], { incorrect: true }),
          state,
        ),
      ),
    ).toEqual(["m1", "u1", "u2"]);
  });

  it("{已掌握, 未学习} + 正确 → 已掌握未错 + 所有未学习", () => {
    const { questions, state } = fixture();
    expect(
      ids(
        applyReviewFilter(
          questions,
          filter(["mastered", "unlearned"], { correct: true }),
          state,
        ),
      ),
    ).toEqual(["m2", "u1", "u2"]);
  });
});

describe("isFilterEmpty / describeFilter", () => {
  it("初始状态为空", () => {
    expect(isFilterEmpty(createReviewFilterState())).toBe(true);
  });

  it("describeFilter 无筛选返回空串", () => {
    expect(describeFilter(createReviewFilterState())).toBe("");
  });

  it("describeFilter 按固定顺序拼接", () => {
    expect(
      describeFilter(
        filter(["unlearned", "mastered", "learning"], { correct: true }),
      ),
    ).toBe("已掌握 学习中 未学习 正确");
  });

  it("describeFilter 仅正误", () => {
    expect(describeFilter(filter([], { incorrect: true }))).toBe("错误");
  });
});
