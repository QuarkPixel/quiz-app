import { describe, it, expect } from "vitest";
import { judgmentType } from "../../src/quiz/types/judgment";
import type { Question } from "../../src/types";

describe("judgmentType 元信息", () => {
  it("id / name 正确", () => {
    expect(judgmentType.id).toBe("judgment");
    expect(judgmentType.name).toBe("判断题");
  });
});

describe("judgmentType.validate", () => {
  const ctx = "第 1 题（id=a）";

  it("answer=true 通过", () => {
    expect(judgmentType.validate({ answer: true } as Record<string, unknown>, ctx)).toEqual([]);
  });

  it("answer=false 通过", () => {
    expect(judgmentType.validate({ answer: false } as Record<string, unknown>, ctx)).toEqual([]);
  });

  it("answer=1（number）报错", () => {
    const errs = judgmentType.validate({ answer: 1 } as Record<string, unknown>, ctx);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toBe(`${ctx}：判断题 answer 必须是布尔值。`);
  });

  it("answer='x'（string）报错", () => {
    const errs = judgmentType.validate({ answer: "x" } as Record<string, unknown>, ctx);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toBe(`${ctx}：判断题 answer 必须是布尔值。`);
  });

  it("answer 缺失报错", () => {
    const errs = judgmentType.validate({} as Record<string, unknown>, ctx);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]).toBe(`${ctx}：判断题 answer 必须是布尔值。`);
  });
});

describe("judgmentType.evaluateAnswer", () => {
  const qTrue: Question = { id: "j1", type: "judgment", question: "?", answer: true };
  const qFalse: Question = { id: "j2", type: "judgment", question: "?", answer: false };

  it("答案=true，选「正确」(0) → true", () => {
    expect(judgmentType.evaluateAnswer(qTrue, [0], [])).toBe(true);
  });

  it("答案=true，选「错误」(1) → false", () => {
    expect(judgmentType.evaluateAnswer(qTrue, [1], [])).toBe(false);
  });

  it("答案=false，选「错误」(1) → true", () => {
    expect(judgmentType.evaluateAnswer(qFalse, [1], [])).toBe(true);
  });

  it("答案=false，选「正确」(0) → false", () => {
    expect(judgmentType.evaluateAnswer(qFalse, [0], [])).toBe(false);
  });

  it("空 selectedAnswers → false", () => {
    expect(judgmentType.evaluateAnswer(qTrue, [], [])).toBe(false);
    expect(judgmentType.evaluateAnswer(qFalse, [], [])).toBe(false);
  });
});

describe("judgmentType.formatAnswerText", () => {
  it("true → '正确'", () => {
    const q: Question = { id: "j1", type: "judgment", question: "?", answer: true };
    expect(judgmentType.formatAnswerText(q)).toBe("正确");
  });

  it("false → '错误'", () => {
    const q: Question = { id: "j2", type: "judgment", question: "?", answer: false };
    expect(judgmentType.formatAnswerText(q)).toBe("错误");
  });
});

describe("judgmentType.getCorrectChoiceLetters", () => {
  it("返回空串", () => {
    const q: Question = { id: "j1", type: "judgment", question: "?", answer: true };
    expect(judgmentType.getCorrectChoiceLetters(q, [])).toBe("");
  });
});
