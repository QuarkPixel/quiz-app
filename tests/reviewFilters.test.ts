import { describe, it, expect } from "vitest";
import {
  applyReviewFilter,
  createReviewFilterState,
  describeFilter,
  isFilterEmpty,
  type ReviewFilterState,
} from "../src/features/quiz/reviewFilters";
import type {
  Correctness,
  LearningStatus,
} from "../src/features/quiz/questionClassification";
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

function makeQuestion(id: string, type: QuestionType = "judgment"): Question {
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
//   m1 mastered + mistaken → incorrect  (judgment)
//   m2 mastered + correct → correct    (single)
//   l1 learning + mistaken → incorrect (multiple)
//   l2 learning + correct → correct    (judgment)
//   u1 unlearned → none                (single)
//   u2 unlearned → none                (blank)
function fixture(): { questions: Question[]; state: RuntimeState } {
  const questions = [
    makeQuestion("m1", "judgment"),
    makeQuestion("m2", "single"),
    makeQuestion("l1", "multiple"),
    makeQuestion("l2", "judgment"),
    makeQuestion("u1", "single"),
    makeQuestion("u2", "blank"),
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
  types: QuestionType[] = [],
): ReviewFilterState {
  return {
    learning: new Set(learning),
    correctness: new Set(
      [
        correctness.correct && "correct",
        correctness.incorrect && "incorrect",
      ].filter(Boolean) as Correctness[],
    ),
    types: new Set(types),
  };
}

function ids(questions: Question[]): string[] {
  return questions.map((q) => q.id);
}

describe("applyReviewFilter", () => {
  it("no filter -> all questions", () => {
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

  it("learning {mastered}", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter(["mastered"]), state)),
    ).toEqual(["m1", "m2"]);
  });

  it("learning {learning}", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter(["learning"]), state)),
    ).toEqual(["l1", "l2"]);
  });

  it("learning {unlearned}", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter(["unlearned"]), state)),
    ).toEqual(["u1", "u2"]);
  });

  it("learning {mastered, learning}", () => {
    const { questions, state } = fixture();
    expect(
      ids(
        applyReviewFilter(questions, filter(["mastered", "learning"]), state),
      ),
    ).toEqual(["m1", "m2", "l1", "l2"]);
  });

  it("correctness correct only -> unlearned excluded", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter([], { correct: true }), state)),
    ).toEqual(["m2", "l2"]);
  });

  it("correctness incorrect only -> unlearned excluded", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter([], { incorrect: true }), state)),
    ).toEqual(["m1", "l1"]);
  });

  it("correctness both selected == none selected", () => {
    const { questions, state } = fixture();
    const both = applyReviewFilter(
      questions,
      filter([], { correct: true, incorrect: true }),
      state,
    );
    expect(ids(both)).toEqual(["m1", "m2", "l1", "l2", "u1", "u2"]);
  });

  it("case1: {unlearned} + correct -> all unlearned", () => {
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

  it("case2: {learning, unlearned} + correct -> learning-correct + all unlearned", () => {
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

  it("case3: {mastered, unlearned} + incorrect -> mastered-incorrect + all unlearned", () => {
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

  it("{mastered, unlearned} + correct -> mastered-correct + all unlearned", () => {
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

  // type filter
  it("types {judgment} -> only judgment", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter([], {}, ["judgment"]), state)),
    ).toEqual(["m1", "l2"]);
  });

  it("types {single, blank} -> single + blank", () => {
    const { questions, state } = fixture();
    expect(
      ids(
        applyReviewFilter(
          questions,
          filter([], {}, ["single", "blank"]),
          state,
        ),
      ),
    ).toEqual(["m2", "u1", "u2"]);
  });

  it("types {single} + learning {mastered} -> mastered single", () => {
    const { questions, state } = fixture();
    expect(
      ids(
        applyReviewFilter(
          questions,
          filter(["mastered"], {}, ["single"]),
          state,
        ),
      ),
    ).toEqual(["m2"]);
  });

  it("types {judgment} + correctness {incorrect} -> judgment + incorrect", () => {
    const { questions, state } = fixture();
    expect(
      ids(
        applyReviewFilter(
          questions,
          filter([], { incorrect: true }, ["judgment"]),
          state,
        ),
      ),
    ).toEqual(["m1"]);
  });

  it("types empty set == all types", () => {
    const { questions, state } = fixture();
    expect(
      ids(applyReviewFilter(questions, filter([], {}, []), state)),
    ).toEqual(["m1", "m2", "l1", "l2", "u1", "u2"]);
  });
});

describe("isFilterEmpty / describeFilter", () => {
  it("initial state is empty", () => {
    expect(isFilterEmpty(createReviewFilterState())).toBe(true);
  });

  it("describeFilter no filter returns empty", () => {
    expect(describeFilter(createReviewFilterState())).toBe("");
  });

  it("describeFilter fixed order", () => {
    expect(
      describeFilter(
        filter(["unlearned", "mastered", "learning"], { correct: true }),
      ),
    ).toBe("已掌握+学习中+未学习+正确");
  });

  it("describeFilter only correctness", () => {
    expect(describeFilter(filter([], { incorrect: true }))).toBe("错误");
  });
});
