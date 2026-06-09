import { describe, it, expect } from "vitest";
import { validateQuestions } from "../src/lib/validateQuestions";

/** 一个最小合法的多题型题库，用于做正向测试与作为「合法基线」克隆。 */
function validBank(): unknown[] {
  return [
    { id: "j1", type: "judgment", question: "1+1=2", answer: true },
    {
      id: "s1",
      type: "single",
      question: "选一个",
      options: [{ text: "A" }, { text: "B" }],
      answer: [0],
    },
    {
      id: "m1",
      type: "multiple",
      question: "选多个",
      options: [{ text: "A" }, { text: "B" }, { text: "C" }],
      answer: [0, 2],
    },
    { id: "b1", type: "blank", question: "填空", answer: "ans" },
    { id: "b2", type: "blank", question: "多答案填空", answer: ["a", "b"] },
  ];
}

describe("validateQuestions 顶层结构", () => {
  it("非数组返回错误", () => {
    const r = validateQuestions({ not: "array" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("题库必须是一个 JSON 数组"))).toBe(
        true,
      );
    }
  });

  it("null 返回错误", () => {
    const r = validateQuestions(null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("题库必须是一个 JSON 数组"))).toBe(
        true,
      );
    }
  });

  it("空数组返回错误", () => {
    const r = validateQuestions([]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("题库为空"))).toBe(true);
    }
  });
});

describe("validateQuestions 元素基本结构", () => {
  it("null 元素 → 不是对象", () => {
    const r = validateQuestions([null]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("不是对象"))).toBe(true);
    }
  });

  it("数组元素 → 不是对象", () => {
    const r = validateQuestions([[]]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("不是对象"))).toBe(true);
    }
  });

  it("字符串元素 → 不是对象", () => {
    const r = validateQuestions(["nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("不是对象"))).toBe(true);
    }
  });
});

describe("validateQuestions id 校验", () => {
  it("缺 id", () => {
    const r = validateQuestions([
      { type: "judgment", question: "q", answer: true },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("缺少 id 或 id 不是字符串"))).toBe(
        true,
      );
    }
  });

  it("id 不是字符串", () => {
    const r = validateQuestions([
      { id: 123, type: "judgment", question: "q", answer: true },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("缺少 id 或 id 不是字符串"))).toBe(
        true,
      );
    }
  });

  it("id 为空字符串", () => {
    const r = validateQuestions([
      { id: "", type: "judgment", question: "q", answer: true },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("缺少 id 或 id 不是字符串"))).toBe(
        true,
      );
    }
  });

  it("id 重复", () => {
    const r = validateQuestions([
      { id: "a", type: "judgment", question: "q", answer: true },
      { id: "a", type: "judgment", question: "q2", answer: false },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("id 重复"))).toBe(true);
    }
  });

  it("id 允许以 ^ 开头", () => {
    const r = validateQuestions([
      { id: "^bad", type: "judgment", question: "q", answer: true },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("validateQuestions type 校验", () => {
  it("type 不在合法集合", () => {
    const r = validateQuestions([
      { id: "x", type: "essay", question: "q", answer: "a" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("type 不合法"))).toBe(true);
    }
  });

  it("type 不是字符串", () => {
    const r = validateQuestions([{ id: "x", type: 1, question: "q", answer: 0 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("type 不合法"))).toBe(true);
    }
  });
});

describe("validateQuestions question 校验", () => {
  it("question 不是字符串", () => {
    const r = validateQuestions([
      { id: "j1", type: "judgment", question: 123, answer: true },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("question 不是字符串"))).toBe(true);
    }
  });
});

describe("validateQuestions judgment 校验", () => {
  it("answer 不是 boolean", () => {
    const r = validateQuestions([
      { id: "j1", type: "judgment", question: "q", answer: "yes" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("判断题 answer 必须是布尔值")),
      ).toBe(true);
    }
  });
});

describe("validateQuestions single/multiple 校验", () => {
  it("options 缺失", () => {
    const r = validateQuestions([
      { id: "s1", type: "single", question: "q", answer: [0] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("选择题 options 必须是非空数组")),
      ).toBe(true);
    }
  });

  it("options 空数组", () => {
    const r = validateQuestions([
      { id: "s1", type: "single", question: "q", options: [], answer: [0] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("选择题 options 必须是非空数组")),
      ).toBe(true);
    }
  });

  it("选项缺 text 字段", () => {
    const r = validateQuestions([
      {
        id: "s1",
        type: "single",
        question: "q",
        options: [{ text: "A" }, {}],
        answer: [0],
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("缺少 text 字段"))).toBe(true);
    }
  });

  it("选项是 null", () => {
    const r = validateQuestions([
      {
        id: "s1",
        type: "single",
        question: "q",
        options: [{ text: "A" }, null],
        answer: [0],
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("缺少 text 字段"))).toBe(true);
    }
  });

  it("answer 不是整数数组（非数组）", () => {
    const r = validateQuestions([
      {
        id: "s1",
        type: "single",
        question: "q",
        options: [{ text: "A" }],
        answer: "0",
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("选择题 answer 必须是整数数组")),
      ).toBe(true);
    }
  });

  it("answer 含非整数", () => {
    const r = validateQuestions([
      {
        id: "s1",
        type: "single",
        question: "q",
        options: [{ text: "A" }, { text: "B" }],
        answer: [0.5],
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("选择题 answer 必须是整数数组")),
      ).toBe(true);
    }
  });

  it("single answer 长度 != 1（多个索引）", () => {
    const r = validateQuestions([
      {
        id: "s1",
        type: "single",
        question: "q",
        options: [{ text: "A" }, { text: "B" }],
        answer: [0, 1],
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("单选题 answer 必须只有一个索引")),
      ).toBe(true);
    }
  });

  it("single answer 长度 != 1（空数组）", () => {
    const r = validateQuestions([
      {
        id: "s1",
        type: "single",
        question: "q",
        options: [{ text: "A" }],
        answer: [],
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) => e.includes("单选题 answer 必须只有一个索引")),
      ).toBe(true);
    }
  });

  it("answer 索引越界（正数）", () => {
    const r = validateQuestions([
      {
        id: "m1",
        type: "multiple",
        question: "q",
        options: [{ text: "A" }, { text: "B" }, { text: "C" }],
        answer: [0, 5],
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("超出 options 范围"))).toBe(true);
    }
  });

  it("answer 索引越界（负数）", () => {
    const r = validateQuestions([
      {
        id: "m1",
        type: "multiple",
        question: "q",
        options: [{ text: "A" }, { text: "B" }],
        answer: [-1],
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("超出 options 范围"))).toBe(true);
    }
  });
});

describe("validateQuestions blank 校验", () => {
  it("answer 不是 string 或 string[]（数字）", () => {
    const r = validateQuestions([
      { id: "b1", type: "blank", question: "q", answer: 123 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) =>
          e.includes("填空题 answer 必须是字符串或字符串数组"),
        ),
      ).toBe(true);
    }
  });

  it("answer 是混合数组（含非 string）", () => {
    const r = validateQuestions([
      { id: "b1", type: "blank", question: "q", answer: ["ok", 1] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(
        r.errors.some((e) =>
          e.includes("填空题 answer 必须是字符串或字符串数组"),
        ),
      ).toBe(true);
    }
  });

  it("answer 是字符串数组 → 通过", () => {
    const r = validateQuestions([
      { id: "b1", type: "blank", question: "q", answer: ["a", "b"] },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("validateQuestions 合法题库", () => {
  it("每种题型一个有效样本 → ok=true，结构保留", () => {
    const bank = validBank();
    const r = validateQuestions(bank);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.questions).toHaveLength(bank.length);
      expect(r.questions[0].id).toBe("j1");
      expect(r.questions[1].type).toBe("single");
      expect(r.questions[2].type).toBe("multiple");
      expect(r.questions[3].type).toBe("blank");
    }
  });

  it("single answer 长度为 1 且索引合法 → 通过", () => {
    const r = validateQuestions([
      {
        id: "s1",
        type: "single",
        question: "q",
        options: [{ text: "A" }, { text: "B" }],
        answer: [1],
      },
    ]);
    expect(r.ok).toBe(true);
  });

  it("multiple answer 长度 > 1 且索引合法 → 通过", () => {
    const r = validateQuestions([
      {
        id: "m1",
        type: "multiple",
        question: "q",
        options: [{ text: "A" }, { text: "B" }, { text: "C" }],
        answer: [0, 1, 2],
      },
    ]);
    expect(r.ok).toBe(true);
  });
});
