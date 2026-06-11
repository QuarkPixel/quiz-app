import { describe, it, expect } from "vitest";
import { multipleType } from "../../src/quiz/types/multiple";
import type { Question } from "../../src/types";
import type { QuestionCopyContext, ShuffledOption } from "../../src/quiz/types/types";

describe("multipleType 元信息", () => {
  it("id / name 正确", () => {
    expect(multipleType.id).toBe("multiple");
    expect(multipleType.name).toBe("多选题");
  });
});

describe("multipleType.validate", () => {
  const ctx = "第 1 题（id=m1）";

  it("合法 multiple（长度 2）通过", () => {
    const item = { options: [{ text: "a" }, { text: "b" }, { text: "c" }], answer: [0, 2] };
    expect(multipleType.validate(item as Record<string, unknown>, ctx)).toEqual([]);
  });

  it("answer 长度 = 1 也合法（区别于 single）", () => {
    const item = { options: [{ text: "a" }, { text: "b" }], answer: [0] };
    expect(multipleType.validate(item as Record<string, unknown>, ctx)).toEqual([]);
  });

  it("answer 长度 = 3 合法", () => {
    const item = {
      options: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }],
      answer: [0, 1, 2],
    };
    expect(multipleType.validate(item as Record<string, unknown>, ctx)).toEqual([]);
  });

  it("answer 长度 != 1 不会报「单选题」相关错误", () => {
    const item = { options: [{ text: "a" }, { text: "b" }], answer: [0, 1] };
    const errs = multipleType.validate(item as Record<string, unknown>, ctx);
    expect(errs.every((e) => !e.includes("单选题"))).toBe(true);
  });

  it("options 缺失报错", () => {
    const errs = multipleType.validate({ answer: [0] } as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：选择题 options 必须是非空数组。`);
  });

  it("answer 含非整数报错", () => {
    const item = { options: [{ text: "a" }, { text: "b" }], answer: [0, 0.5] };
    const errs = multipleType.validate(item as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：选择题 answer 必须是整数数组。`);
  });

  it("answer 索引越界报错", () => {
    const item = { options: [{ text: "a" }, { text: "b" }], answer: [0, 5] };
    const errs = multipleType.validate(item as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：answer 索引 5 超出 options 范围。`);
  });
});

describe("multipleType.evaluateAnswer", () => {
  const q: Question = {
    id: "m1",
    type: "multiple",
    question: "?",
    options: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }],
    answer: [0, 2],
  };

  it("全对 → true", () => {
    expect(multipleType.evaluateAnswer(q, [0, 2], [])).toBe(true);
  });

  it("顺序无关：[2, 0] → true", () => {
    expect(multipleType.evaluateAnswer(q, [2, 0], [])).toBe(true);
  });

  it("多选一个 → false", () => {
    expect(multipleType.evaluateAnswer(q, [0, 2, 3], [])).toBe(false);
  });

  it("少选一个 → false", () => {
    expect(multipleType.evaluateAnswer(q, [0], [])).toBe(false);
  });

  it("选错一个 → false", () => {
    expect(multipleType.evaluateAnswer(q, [0, 1], [])).toBe(false);
  });

  it("空选 → false", () => {
    expect(multipleType.evaluateAnswer(q, [], [])).toBe(false);
  });
});

describe("multipleType.formatAnswerText", () => {
  it("多个正确选项按索引升序，' / ' 拼接", () => {
    const q: Question = {
      id: "m1",
      type: "multiple",
      question: "?",
      options: [{ text: "甲" }, { text: "乙" }, { text: "丙" }, { text: "丁" }],
      answer: [2, 0],
    };
    // answer 顺序 [2, 0]，但 formatChoiceAnswerText 会先按索引升序排
    expect(multipleType.formatAnswerText(q)).toBe("甲 / 丙");
  });
});

describe("multipleType.formatCopyText", () => {
  const q: Question = {
    id: "m1",
    type: "multiple",
    question: "请选择所有正确项",
    options: [{ text: "甲" }, { text: "乙" }, { text: "丙" }, { text: "丁" }],
    answer: [0, 2],
  };
  const shuffled: ShuffledOption[] = [
    { text: "丙", originalIndex: 2 },
    { text: "乙", originalIndex: 1 },
    { text: "甲", originalIndex: 0 },
    { text: "丁", originalIndex: 3 },
  ];
  const baseContext: QuestionCopyContext = {
    showResult: false,
    isCorrect: false,
    shuffledOptions: shuffled,
    selectedAnswers: [],
    blankAnswerInputs: [],
  };

  it("未作答时复制题干和当前选项顺序", () => {
    expect(multipleType.formatCopyText(q, baseContext)).toBe(
      ["多选题：", "请选择所有正确项", "A. 丙", "B. 乙", "C. 甲", "D. 丁"].join(
        "\n",
      ),
    );
  });

  it("答对时正确答案按当前选项字母顺序拼接", () => {
    expect(
      multipleType.formatCopyText(q, {
        ...baseContext,
        showResult: true,
        isCorrect: true,
        selectedAnswers: [2, 0],
      }),
    ).toBe(
      [
        "多选题：",
        "请选择所有正确项",
        "A. 丙",
        "B. 乙",
        "C. 甲",
        "D. 丁",
        "",
        "答案：AC",
      ].join("\n"),
    );
  });

  it("答错时我的答案也按当前选项字母顺序拼接", () => {
    expect(
      multipleType.formatCopyText(q, {
        ...baseContext,
        showResult: true,
        selectedAnswers: [3, 2],
      }),
    ).toBe(
      [
        "多选题：",
        "请选择所有正确项",
        "A. 丙",
        "B. 乙",
        "C. 甲",
        "D. 丁",
        "",
        "我的答案：AD",
        "实际答案：AC",
      ].join("\n"),
    );
  });
});

describe("multipleType.getCorrectChoiceLetters", () => {
  it("多字母按字母序拼接", () => {
    const q: Question = {
      id: "m1",
      type: "multiple",
      question: "?",
      options: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }],
      answer: [0, 2],
    };
    // 不打乱：originalIndex 0 → 位置 0 → A；originalIndex 2 → 位置 2 → C
    const shuffled: ShuffledOption[] = [
      { text: "A", originalIndex: 0 },
      { text: "B", originalIndex: 1 },
      { text: "C", originalIndex: 2 },
      { text: "D", originalIndex: 3 },
    ];
    expect(multipleType.getCorrectChoiceLetters(q, shuffled)).toBe("AC");
  });

  it("打乱后仍按字母序拼接", () => {
    const q: Question = {
      id: "m1",
      type: "multiple",
      question: "?",
      options: [{ text: "A" }, { text: "B" }, { text: "C" }, { text: "D" }],
      answer: [0, 2],
    };
    // 把 origIdx=2 → 位置 0 (A)，把 origIdx=0 → 位置 2 (C)
    const shuffled: ShuffledOption[] = [
      { text: "C", originalIndex: 2 },
      { text: "B", originalIndex: 1 },
      { text: "A", originalIndex: 0 },
      { text: "D", originalIndex: 3 },
    ];
    expect(multipleType.getCorrectChoiceLetters(q, shuffled)).toBe("AC");
  });
});
