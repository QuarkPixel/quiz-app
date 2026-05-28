import { describe, it, expect } from "vitest";
import {
  getTypeName,
  getAvailableQuestionTypes,
  buildFilterOptions,
  normalizeFilterType,
} from "../src/features/quiz/filters";
import type { Question, QuestionType } from "../src/types";

function makeQuestion(id: string, type: QuestionType): Question {
  return { id, type, question: `q-${id}`, answer: true };
}

// ---------------------------------------------------------------------------
// getTypeName
// ---------------------------------------------------------------------------

describe("getTypeName", () => {
  it("四种题型对应正确标签", () => {
    expect(getTypeName("judgment")).toBe("判断题");
    expect(getTypeName("single")).toBe("单选题");
    expect(getTypeName("multiple")).toBe("多选题");
    expect(getTypeName("blank")).toBe("填空题");
  });
});

// ---------------------------------------------------------------------------
// getAvailableQuestionTypes
// ---------------------------------------------------------------------------

describe("getAvailableQuestionTypes", () => {
  it("按 QUESTION_TYPE_ORDER 返回，无论输入顺序", () => {
    const questions = [
      makeQuestion("a", "blank"),
      makeQuestion("b", "single"),
      makeQuestion("c", "judgment"),
      makeQuestion("d", "multiple"),
    ];
    expect(getAvailableQuestionTypes(questions)).toEqual([
      "judgment",
      "single",
      "multiple",
      "blank",
    ]);
  });

  it("只返回实际存在的题型", () => {
    const questions = [
      makeQuestion("a", "single"),
      makeQuestion("b", "single"),
      makeQuestion("c", "blank"),
    ];
    expect(getAvailableQuestionTypes(questions)).toEqual(["single", "blank"]);
  });

  it("空题库返回空数组", () => {
    expect(getAvailableQuestionTypes([])).toEqual([]);
  });

  it("题型去重", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "judgment"),
      makeQuestion("c", "judgment"),
    ];
    expect(getAvailableQuestionTypes(questions)).toEqual(["judgment"]);
  });
});

// ---------------------------------------------------------------------------
// buildFilterOptions
// ---------------------------------------------------------------------------

describe("buildFilterOptions", () => {
  it("空题库 → 空数组", () => {
    expect(buildFilterOptions([])).toEqual([]);
  });

  it("单一题型时不加 all 入口", () => {
    const questions = [
      makeQuestion("a", "single"),
      makeQuestion("b", "single"),
    ];
    expect(buildFilterOptions(questions)).toEqual([
      { key: "single", label: "单选题" },
    ]);
  });

  it("多题型时首项为 all、后续按 ORDER", () => {
    const questions = [
      makeQuestion("a", "blank"),
      makeQuestion("b", "judgment"),
      makeQuestion("c", "single"),
    ];
    expect(buildFilterOptions(questions)).toEqual([
      { key: "all", label: "全部" },
      { key: "judgment", label: "判断题" },
      { key: "single", label: "单选题" },
      { key: "blank", label: "填空题" },
    ]);
  });

  it("两种题型也会加 all 入口", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
    ];
    expect(buildFilterOptions(questions)).toEqual([
      { key: "all", label: "全部" },
      { key: "judgment", label: "判断题" },
      { key: "single", label: "单选题" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// normalizeFilterType
// ---------------------------------------------------------------------------

describe("normalizeFilterType", () => {
  it("题库为空 → 返回 all", () => {
    expect(normalizeFilterType("single", [])).toBe("all");
    expect(normalizeFilterType("all", [])).toBe("all");
  });

  it("单题型 → 始终返回该题型（即使传 all）", () => {
    const questions = [makeQuestion("a", "blank")];
    expect(normalizeFilterType("all", questions)).toBe("blank");
    expect(normalizeFilterType("blank", questions)).toBe("blank");
    expect(normalizeFilterType("single", questions)).toBe("blank");
  });

  it("多题型 + filterType 不在可用列表 → 返回 all", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
    ];
    expect(normalizeFilterType("blank", questions)).toBe("all");
    expect(normalizeFilterType("multiple", questions)).toBe("all");
  });

  it("多题型 + filterType 在可用列表 → 原值返回", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
      makeQuestion("c", "blank"),
    ];
    expect(normalizeFilterType("judgment", questions)).toBe("judgment");
    expect(normalizeFilterType("single", questions)).toBe("single");
    expect(normalizeFilterType("blank", questions)).toBe("blank");
  });

  it("多题型 + all → 返回 all", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
    ];
    expect(normalizeFilterType("all", questions)).toBe("all");
  });
});
