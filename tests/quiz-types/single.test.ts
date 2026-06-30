import { describe, it, expect } from "vitest";
import { singleType } from "../../src/quiz/types/single";
import type { Question } from "../../src/types";
import {
  QuestionCopyPattern,
  type QuestionCopyContext,
  type ShuffledOption,
} from "../../src/quiz/types/types";

describe("singleType 元信息", () => {
  it("id / name 正确", () => {
    expect(singleType.id).toBe("single");
    expect(singleType.name).toBe("单选题");
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

describe("singleType.formatCopyText", () => {
  const q: Question = {
    id: "s1",
    type: "single",
    question: "请选择正确说法",
    options: [{ text: "甲" }, { text: "乙" }, { text: "丙" }],
    answer: [2],
  };
  const shuffled: ShuffledOption[] = [
    { text: "丙", originalIndex: 2 },
    { text: "甲", originalIndex: 0 },
    { text: "乙", originalIndex: 1 },
  ];
  const baseContext: QuestionCopyContext = {
    shuffledOptions: shuffled,
    selectedAnswers: [],
    blankAnswerInputs: [],
  };

  it("未作答时只复制题干和当前选项顺序", () => {
    expect(
      singleType.formatCopyText(
        q,
        baseContext,
        QuestionCopyPattern.QuestionOnly,
      ),
    ).toBe(
      ["单选题：", "请选择正确说法", "A. 丙", "B. 甲", "C. 乙"].join("\n"),
    );
  });

  it("答对时追加正确答案字母", () => {
    expect(
      singleType.formatCopyText(q, {
        ...baseContext,
        selectedAnswers: [2],
      }, QuestionCopyPattern.QuestionWithAnswer),
    ).toBe(
      ["单选题：", "请选择正确说法", "A. 丙", "B. 甲", "C. 乙", "", "答案：A"].join(
        "\n",
      ),
    );
  });

  it("答错时追加我的答案和正确答案字母", () => {
    expect(
      singleType.formatCopyText(q, {
        ...baseContext,
        selectedAnswers: [0],
      }, QuestionCopyPattern.QuestionWithMyAnswerAndAnswer),
    ).toBe(
      [
        "单选题：",
        "请选择正确说法",
        "A. 丙",
        "B. 甲",
        "C. 乙",
        "",
        "我的答案：B",
        "实际答案：A",
      ].join("\n"),
    );
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

describe("singleType.getKeyboardAction", () => {
  const q: Question = {
    id: "s1",
    type: "single",
    question: "?",
    options: [{ text: "甲" }, { text: "乙" }, { text: "丙" }],
    answer: [1],
  };
  const baseContext = {
    question: q,
    showResult: false,
    autoSubmitOnSelection: true,
    shuffledOptions: [
      { text: "丙", originalIndex: 2 },
      { text: "甲", originalIndex: 0 },
      { text: "乙", originalIndex: 1 },
    ],
    selectedAnswers: [],
    blankAnswerInputs: [],
  };

  it("A 键按当前打乱顺序选择 A 选项并自动提交", () => {
    expect(
      singleType.getKeyboardAction(baseContext, {
        key: "a",
        code: "KeyA",
        scope: "global",
      }),
    ).toEqual({
      kind: "set-selected-answers",
      value: [2],
      autoSubmit: true,
    });
  });

  it("关闭自动提交后只返回选中动作", () => {
    expect(
      singleType.getKeyboardAction(
        {
          ...baseContext,
          autoSubmitOnSelection: false,
        },
        {
          key: "b",
          code: "KeyB",
          scope: "global",
        },
      ),
    ).toEqual({
      kind: "set-selected-answers",
      value: [0],
      autoSubmit: false,
    });
  });

  it("数字键按当前显示顺序选择选项", () => {
    expect(
      singleType.getKeyboardAction(baseContext, {
        key: "2",
        code: "Digit2",
        scope: "global",
      }),
    ).toEqual({
      kind: "set-selected-answers",
      value: [0],
      autoSubmit: true,
    });
  });

  it("Space / Enter 走提交或下一题", () => {
    expect(
      singleType.getKeyboardAction(baseContext, {
        key: " ",
        code: "Space",
        scope: "global",
      }),
    ).toEqual({ kind: "submit" });

    expect(
      singleType.getKeyboardAction(
        {
          ...baseContext,
          showResult: true,
        },
        {
          key: "enter",
          code: "Enter",
          scope: "global",
        },
      ),
    ).toEqual({ kind: "next" });
  });
});
