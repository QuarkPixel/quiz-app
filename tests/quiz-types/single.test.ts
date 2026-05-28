import { describe, it, expect } from "vitest";
import { singleType } from "../../src/quiz/types/single";
import type { Question } from "../../src/types";
import type { ShuffledOption } from "../../src/quiz/types/types";

describe("singleType 元信息", () => {
  it("id / name / exportPrefix 正确", () => {
    expect(singleType.id).toBe("single");
    expect(singleType.name).toBe("单选题");
    expect(singleType.exportPrefix).toBe("s");
  });
});

describe("singleType.validate", () => {
  const ctx = "第 1 题（id=s1）";

  it("合法 single 通过", () => {
    const item = { options: [{ text: "a" }, { text: "b" }], answer: [0] };
    expect(singleType.validate(item as Record<string, unknown>, ctx)).toEqual([]);
  });

  it("options 缺失报错", () => {
    const errs = singleType.validate({ answer: [0] } as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：选择题 options 必须是非空数组。`);
  });

  it("options 空数组报错", () => {
    const errs = singleType.validate({ options: [], answer: [0] } as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：选择题 options 必须是非空数组。`);
  });

  it("子项无 text 字段报错", () => {
    const item = { options: [{ text: "a" }, { notText: "b" }], answer: [0] };
    const errs = singleType.validate(item as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：选项 1 缺少 text 字段。`);
  });

  it("answer 不是数组报错", () => {
    const item = { options: [{ text: "a" }], answer: 0 };
    const errs = singleType.validate(item as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：选择题 answer 必须是整数数组。`);
  });

  it("answer 含非整数报错", () => {
    const item = { options: [{ text: "a" }, { text: "b" }], answer: [0.5] };
    const errs = singleType.validate(item as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：选择题 answer 必须是整数数组。`);
  });

  it("answer 长度 != 1 报错", () => {
    const item = { options: [{ text: "a" }, { text: "b" }], answer: [0, 1] };
    const errs = singleType.validate(item as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：单选题 answer 必须只有一个索引。`);
  });

  it("answer 长度 = 0 报错", () => {
    const item = { options: [{ text: "a" }], answer: [] };
    const errs = singleType.validate(item as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：单选题 answer 必须只有一个索引。`);
  });

  it("answer 索引越界报错", () => {
    const item = { options: [{ text: "a" }, { text: "b" }], answer: [5] };
    const errs = singleType.validate(item as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：answer 索引 5 超出 options 范围。`);
  });
});

describe("singleType.evaluateAnswer", () => {
  const q: Question = {
    id: "s1",
    type: "single",
    question: "?",
    options: [{ text: "A" }, { text: "B" }, { text: "C" }],
    answer: [1],
  };

  it("唯一正确索引 → true", () => {
    expect(singleType.evaluateAnswer(q, [1], [])).toBe(true);
  });

  it("错误索引 → false", () => {
    expect(singleType.evaluateAnswer(q, [0], [])).toBe(false);
    expect(singleType.evaluateAnswer(q, [2], [])).toBe(false);
  });

  it("空选择 → false", () => {
    expect(singleType.evaluateAnswer(q, [], [])).toBe(false);
  });
});

describe("singleType.formatAnswerText", () => {
  it("返回正确选项的 text", () => {
    const q: Question = {
      id: "s1",
      type: "single",
      question: "?",
      options: [{ text: "A 选项" }, { text: "B 选项" }, { text: "C 选项" }],
      answer: [1],
    };
    expect(singleType.formatAnswerText(q)).toBe("B 选项");
  });
});

describe("singleType.getCorrectChoiceLetters", () => {
  it("基于 shuffled 位置返回字母（正确选项被打乱到首位 → 'A'）", () => {
    const q: Question = {
      id: "s1",
      type: "single",
      question: "?",
      options: [{ text: "A" }, { text: "B" }, { text: "C" }],
      answer: [2],
    };
    // 把 originalIndex=2 的选项洗到位置 0
    const shuffled: ShuffledOption[] = [
      { text: "C", originalIndex: 2 },
      { text: "A", originalIndex: 0 },
      { text: "B", originalIndex: 1 },
    ];
    expect(singleType.getCorrectChoiceLetters(q, shuffled)).toBe("A");
  });

  it("正确选项被打乱到第 2 位 → 'B'", () => {
    const q: Question = {
      id: "s1",
      type: "single",
      question: "?",
      options: [{ text: "A" }, { text: "B" }, { text: "C" }],
      answer: [2],
    };
    // 把 originalIndex=2 的选项洗到位置 1
    const shuffled: ShuffledOption[] = [
      { text: "A", originalIndex: 0 },
      { text: "C", originalIndex: 2 },
      { text: "B", originalIndex: 1 },
    ];
    expect(singleType.getCorrectChoiceLetters(q, shuffled)).toBe("B");
  });
});
