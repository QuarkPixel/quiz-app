import { describe, it, expect } from "vitest";
import { blankType } from "../../src/quiz/types/blank";
import type { Question } from "../../src/types";
import type { QuestionCopyContext } from "../../src/quiz/types/types";

describe("blankType 元信息", () => {
  it("id / name 正确", () => {
    expect(blankType.id).toBe("blank");
    expect(blankType.name).toBe("填空题");
  });
});

describe("blankType.validate", () => {
  const ctx = "第 1 题（id=b1）";

  it("answer 是 string 通过", () => {
    expect(blankType.validate({ answer: "hello" } as Record<string, unknown>, ctx)).toEqual([]);
  });

  it("answer 是 string[] 通过", () => {
    expect(blankType.validate({ answer: ["a", "b"] } as Record<string, unknown>, ctx)).toEqual([]);
  });

  it("answer 是空字符串数组也通过（类型校验层不限内容）", () => {
    expect(blankType.validate({ answer: [] } as Record<string, unknown>, ctx)).toEqual([]);
  });

  it("answer 是 number 报错", () => {
    const errs = blankType.validate({ answer: 42 } as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：填空题 answer 必须是字符串或字符串数组。`);
  });

  it("answer 是混合类型数组报错", () => {
    const errs = blankType.validate({ answer: ["a", 1] } as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：填空题 answer 必须是字符串或字符串数组。`);
  });

  it("answer 缺失报错", () => {
    const errs = blankType.validate({} as Record<string, unknown>, ctx);
    expect(errs).toContain(`${ctx}：填空题 answer 必须是字符串或字符串数组。`);
  });
});

describe("blankType.evaluateAnswer", () => {
  it("单空匹配 → true", () => {
    const q: Question = { id: "b1", type: "blank", question: "?", answer: "hello" };
    expect(blankType.evaluateAnswer(q, [], ["hello"])).toBe(true);
  });

  it("单空不匹配 → false", () => {
    const q: Question = { id: "b1", type: "blank", question: "?", answer: "hello" };
    expect(blankType.evaluateAnswer(q, [], ["world"])).toBe(false);
  });

  it("多空全对 → true", () => {
    const q: Question = { id: "b2", type: "blank", question: "?", answer: ["foo", "bar"] };
    expect(blankType.evaluateAnswer(q, [], ["foo", "bar"])).toBe(true);
  });

  it("多空任一错误 → false", () => {
    const q: Question = { id: "b2", type: "blank", question: "?", answer: ["foo", "bar"] };
    expect(blankType.evaluateAnswer(q, [], ["foo", "baz"])).toBe(false);
    expect(blankType.evaluateAnswer(q, [], ["x", "bar"])).toBe(false);
  });

  it("inputs 含空字符串 → false（即使其他空都对）", () => {
    const q: Question = { id: "b2", type: "blank", question: "?", answer: ["foo", "bar"] };
    expect(blankType.evaluateAnswer(q, [], ["foo", ""])).toBe(false);
    expect(blankType.evaluateAnswer(q, [], ["", "bar"])).toBe(false);
  });

  it("inputs 全为空字符串 → false", () => {
    const q: Question = { id: "b1", type: "blank", question: "?", answer: "hello" };
    expect(blankType.evaluateAnswer(q, [], [""])).toBe(false);
  });

  it("dispatch 到 matchAnswer：忽略大小写", () => {
    const q: Question = { id: "b1", type: "blank", question: "?", answer: "Hello" };
    expect(blankType.evaluateAnswer(q, [], ["hello"])).toBe(true);
  });
});

describe("blankType.formatAnswerText", () => {
  it("单字符串原样返回", () => {
    const q: Question = { id: "b1", type: "blank", question: "?", answer: "hello" };
    expect(blankType.formatAnswerText(q)).toBe("hello");
  });

  it("字符串数组用 ' | ' 拼接", () => {
    const q: Question = { id: "b2", type: "blank", question: "?", answer: ["a", "b", "c"] };
    expect(blankType.formatAnswerText(q)).toBe("a | b | c");
  });
});

describe("blankType.formatCopyText", () => {
  const q: Question = { id: "b1", type: "blank", question: "默写 hello", answer: "hello" };
  const baseContext: QuestionCopyContext = {
    showResult: false,
    isCorrect: false,
    shuffledOptions: [],
    selectedAnswers: [],
    blankAnswerInputs: [],
  };

  it("未作答时复制题干", () => {
    expect(blankType.formatCopyText(q, baseContext)).toBe(
      ["填空题：", "默写 hello"].join("\n"),
    );
  });

  it("答对时追加正确答案", () => {
    expect(
      blankType.formatCopyText(q, {
        ...baseContext,
        showResult: true,
        isCorrect: true,
        blankAnswerInputs: ["hello"],
      }),
    ).toBe(["填空题：", "默写 hello", "", "答案：hello"].join("\n"));
  });

  it("答错时追加我的答案和正确答案", () => {
    expect(
      blankType.formatCopyText(q, {
        ...baseContext,
        showResult: true,
        blankAnswerInputs: ["helo"],
      }),
    ).toBe(
      ["填空题：", "默写 hello", "", "我的答案：helo", "实际答案：hello"].join("\n"),
    );
  });
});

describe("blankType.getCorrectChoiceLetters", () => {
  it("返回空串", () => {
    const q: Question = { id: "b1", type: "blank", question: "?", answer: "hello" };
    expect(blankType.getCorrectChoiceLetters(q, [])).toBe("");
  });
});

describe("blankType.getKeyboardAction", () => {
  const q: Question = { id: "b1", type: "blank", question: "?", answer: "hello" };
  const baseContext = {
    question: q,
    showResult: false,
    autoSubmitOnSelection: true,
    shuffledOptions: [],
    selectedAnswers: [],
    blankAnswerInputs: ["hello"],
  };

  it("未聚焦输入框时，Space / Enter 都可提交", () => {
    expect(
      blankType.getKeyboardAction(baseContext, {
        key: " ",
        code: "Space",
        scope: "global",
      }),
    ).toEqual({ kind: "submit" });

    expect(
      blankType.getKeyboardAction(baseContext, {
        key: "enter",
        code: "Enter",
        scope: "global",
      }),
    ).toEqual({ kind: "submit" });
  });

  it("题型层不关心焦点位置，Space / Enter 都视作提交", () => {
    expect(
      blankType.getKeyboardAction(baseContext, {
        key: " ",
        code: "Space",
        scope: "blank-input",
      }),
    ).toEqual({ kind: "submit" });

    expect(
      blankType.getKeyboardAction(baseContext, {
        key: "enter",
        code: "Enter",
        scope: "blank-input",
      }),
    ).toEqual({ kind: "submit" });
  });

  it("设置关闭时，填空题仍然由 Enter 提交", () => {
    expect(
      blankType.getKeyboardAction(
        {
          ...baseContext,
          autoSubmitOnSelection: false,
        },
        {
          key: "enter",
          code: "Enter",
          scope: "blank-input",
        },
      ),
    ).toEqual({ kind: "submit" });
  });

  it("结果页 Enter → 下一题", () => {
    expect(
      blankType.getKeyboardAction(
        {
          ...baseContext,
          showResult: true,
        },
        {
          key: "enter",
          code: "Enter",
          scope: "blank-input",
        },
      ),
    ).toEqual({ kind: "next" });
  });
});
