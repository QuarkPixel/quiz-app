import { describe, it, expect } from "vitest";
import { judgmentType } from "../../src/quiz/types/judgment";
import type { Question } from "../../src/types";
import {
  QuestionCopyPattern,
  type QuestionCopyContext,
} from "../../src/quiz/types/types";

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

describe("judgmentType.formatCopyText", () => {
  const q: Question = { id: "j1", type: "judgment", question: "地球是圆的", answer: true };
  const baseContext: QuestionCopyContext = {
    shuffledOptions: [],
    selectedAnswers: [],
    blankAnswerInputs: [],
  };

  it("未作答时复制判断题选项", () => {
    expect(
      judgmentType.formatCopyText(
        q,
        baseContext,
        QuestionCopyPattern.QuestionOnly,
      ),
    ).toBe(
      ["判断题：", "地球是圆的"].join("\n"),
    );
  });

  it("答错时追加我的答案和正确答案", () => {
    expect(
      judgmentType.formatCopyText(q, {
        ...baseContext,
        selectedAnswers: [1],
      }, QuestionCopyPattern.QuestionWithMyAnswerAndAnswer),
    ).toBe(
      ["判断题：", "地球是圆的", "", "我的答案：错误", "实际答案：正确"].join(
        "\n",
      ),
    );
  });
});

describe("judgmentType.getCorrectChoiceLetters", () => {
  it("返回空串", () => {
    const q: Question = { id: "j1", type: "judgment", question: "?", answer: true };
    expect(judgmentType.getCorrectChoiceLetters(q, [])).toBe("");
  });
});

describe("judgmentType.getKeyboardAction", () => {
  const q: Question = { id: "j1", type: "judgment", question: "?", answer: true };
  const baseContext = {
    question: q,
    showResult: false,
    autoSubmitOnSelection: true,
    shuffledOptions: [],
    selectedAnswers: [],
    blankAnswerInputs: [],
  };

  it("A/B 分别映射正确/错误，并默认自动提交", () => {
    expect(
      judgmentType.getKeyboardAction(baseContext, {
        key: "a",
        code: "KeyA",
        scope: "global",
      }),
    ).toEqual({
      kind: "set-selected-answers",
      value: [0],
      autoSubmit: true,
    });

    expect(
      judgmentType.getKeyboardAction(baseContext, {
        key: "b",
        code: "KeyB",
        scope: "global",
      }),
    ).toEqual({
      kind: "set-selected-answers",
      value: [1],
      autoSubmit: true,
    });
  });

  it("1/2 也分别映射正确/错误", () => {
    expect(
      judgmentType.getKeyboardAction(baseContext, {
        key: "1",
        code: "Digit1",
        scope: "global",
      }),
    ).toEqual({
      kind: "set-selected-answers",
      value: [0],
      autoSubmit: true,
    });

    expect(
      judgmentType.getKeyboardAction(baseContext, {
        key: "2",
        code: "Digit2",
        scope: "global",
      }),
    ).toEqual({
      kind: "set-selected-answers",
      value: [1],
      autoSubmit: true,
    });
  });

  it("结果页 Enter → 下一题", () => {
    expect(
      judgmentType.getKeyboardAction(
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
