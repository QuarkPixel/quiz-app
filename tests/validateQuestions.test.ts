import { describe, it, expect } from "vitest";
import { validateQuizQuestions } from "../src/lib/validateQuestions";
import { formatBankFile, parseBankFile } from "../src/lib/bankFile";

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

describe("validateQuizQuestions 顶层结构", () => {
  it("非数组返回错误", () => {
    const r = validateQuizQuestions({ not: "array" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("questions 必须是一个 JSON 数组"))).toBe(
        true,
      );
    }
  });

  it("null 返回错误", () => {
    const r = validateQuizQuestions(null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("questions 必须是一个 JSON 数组"))).toBe(
        true,
      );
    }
  });

  it("空数组返回错误", () => {
    const r = validateQuizQuestions([]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("题库为空"))).toBe(true);
    }
  });
});

describe("validateQuizQuestions 元素基本结构", () => {
  it("null 元素 → 不是对象", () => {
    const r = validateQuizQuestions([null]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("不是对象"))).toBe(true);
    }
  });

  it("数组元素 → 不是对象", () => {
    const r = validateQuizQuestions([[]]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("不是对象"))).toBe(true);
    }
  });

  it("字符串元素 → 不是对象", () => {
    const r = validateQuizQuestions(["nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("不是对象"))).toBe(true);
    }
  });
});

describe("validateQuizQuestions id 校验", () => {
  it("缺 id", () => {
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
      { id: "a", type: "judgment", question: "q", answer: true },
      { id: "a", type: "judgment", question: "q2", answer: false },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("id 重复"))).toBe(true);
    }
  });

  it("id 允许以 ^ 开头", () => {
    const r = validateQuizQuestions([
      { id: "^bad", type: "judgment", question: "q", answer: true },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("validateQuizQuestions type 校验", () => {
  it("type 不在合法集合", () => {
    const r = validateQuizQuestions([
      { id: "x", type: "essay", question: "q", answer: "a" },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("type 不合法"))).toBe(true);
    }
  });

  it("type 不是字符串", () => {
    const r = validateQuizQuestions([{ id: "x", type: 1, question: "q", answer: 0 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("type 不合法"))).toBe(true);
    }
  });
});

describe("validateQuizQuestions question 校验", () => {
  it("question 不是字符串", () => {
    const r = validateQuizQuestions([
      { id: "j1", type: "judgment", question: 123, answer: true },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("question 不是字符串"))).toBe(true);
    }
  });
});

describe("validateQuizQuestions judgment 校验", () => {
  it("answer 不是 boolean", () => {
    const r = validateQuizQuestions([
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

describe("validateQuizQuestions single/multiple 校验", () => {
  it("options 缺失", () => {
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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

describe("validateQuizQuestions blank 校验", () => {
  it("answer 不是 string 或 string[]（数字）", () => {
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
      { id: "b1", type: "blank", question: "q", answer: ["a", "b"] },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("validateQuizQuestions 合法题库", () => {
  it("每种题型一个有效样本 → ok=true，结构保留", () => {
    const bank = validBank();
    const r = validateQuizQuestions(bank);
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
    const r = validateQuizQuestions([
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
    const r = validateQuizQuestions([
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

describe("parseBankFile 统一题库格式", () => {
  it("裸数组 → 报错（不再支持）", () => {
    const r = parseBankFile(validBank());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("不再支持裸数组"))).toBe(true);
    }
  });

  it("非对象 → 报错", () => {
    expect(parseBankFile(null).ok).toBe(false);
    expect(parseBankFile("nope").ok).toBe(false);
  });

  it("缺少 questions 字段 → 报错", () => {
    const r = parseBankFile({ mode: "quiz" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("缺少 questions"))).toBe(true);
    }
  });

  it("省略 mode → 默认为 quiz", () => {
    const r = parseBankFile({ questions: validBank() });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe("quiz");
      expect(r.questions).toHaveLength(5);
      expect(r.state).toBeUndefined();
    }
  });

  it("显式 mode=quiz → 通过", () => {
    const r = parseBankFile({ mode: "quiz", questions: validBank() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mode).toBe("quiz");
  });

  it("非法 mode → 报错", () => {
    const r = parseBankFile({ mode: "essay", questions: validBank() });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("mode 不合法"))).toBe(true);
    }
  });

  it("state 透传", () => {
    const r = parseBankFile({
      questions: validBank(),
      state: "hash.payload",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toBe("hash.payload");
  });

  it("state 不是字符串 → 报错", () => {
    const r = parseBankFile({ questions: validBank(), state: 123 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("state 必须是字符串"))).toBe(true);
    }
  });

  it("recite 模式 → 接口已预留但尚未实现", () => {
    const r = parseBankFile({ mode: "recite", questions: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes("背诵模式尚未实现"))).toBe(true);
    }
  });

  it("questions 校验失败时透传错误", () => {
    const r = parseBankFile({ questions: [{ id: "x" }] });
    expect(r.ok).toBe(false);
  });
});

describe("formatBankFile 序列化", () => {
  it("输出 mode + questions，并在有 state 时一并输出", () => {
    const content = formatBankFile({
      mode: "quiz",
      questions: [{ id: "j1" }],
      state: "abc.def",
    });
    expect(JSON.parse(content)).toEqual({
      mode: "quiz",
      state: "abc.def",
      questions: [{ id: "j1" }],
    });
  });

  it("没有 state 时不输出 state 字段", () => {
    const content = formatBankFile({
      mode: "quiz",
      questions: [{ id: "j1" }],
    });
    expect(JSON.parse(content)).toEqual({
      mode: "quiz",
      questions: [{ id: "j1" }],
    });
  });
});

