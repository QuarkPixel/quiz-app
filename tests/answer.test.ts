import { describe, it, expect } from "vitest";
import {
  canSubmitCurrentAnswer,
  evaluateAnswer,
  getCorrectChoiceLetters,
  buildAnswerSet,
  normalizeBlankAnswer,
} from "../src/features/quiz/answer";
import type { Question, QuestionType } from "../src/types";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeQuestion(
  id: string,
  type: QuestionType,
  answer: Question["answer"],
  options?: { text: string }[],
): Question {
  return {
    id,
    type,
    question: `q-${id}`,
    answer,
    options,
  };
}

// ---------------------------------------------------------------------------
// canSubmitCurrentAnswer
// ---------------------------------------------------------------------------

describe("canSubmitCurrentAnswer", () => {
  it("null question → false", () => {
    expect(canSubmitCurrentAnswer(null, [], [])).toBe(false);
  });

  it("有 question → true（无论 selectedAnswers / blankAnswerInputs）", () => {
    const q = makeQuestion("a", "judgment", true);
    expect(canSubmitCurrentAnswer(q, [], [])).toBe(true);
    expect(canSubmitCurrentAnswer(q, [0], [])).toBe(true);
    expect(canSubmitCurrentAnswer(q, [], ["foo"])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// evaluateAnswer
// ---------------------------------------------------------------------------

describe("evaluateAnswer / judgment", () => {
  it("选「正确」（index 0）匹配 answer=true", () => {
    const q = makeQuestion("a", "judgment", true);
    expect(evaluateAnswer(q, [0], [])).toBe(true);
    expect(evaluateAnswer(q, [1], [])).toBe(false);
  });

  it("选「错误」（index 1）匹配 answer=false", () => {
    const q = makeQuestion("a", "judgment", false);
    expect(evaluateAnswer(q, [1], [])).toBe(true);
    expect(evaluateAnswer(q, [0], [])).toBe(false);
  });

  it("空选择 → false", () => {
    expect(evaluateAnswer(makeQuestion("a", "judgment", true), [], [])).toBe(
      false,
    );
  });
});

describe("evaluateAnswer / single", () => {
  const q = makeQuestion("s", "single", [1], [
    { text: "A" },
    { text: "B" },
    { text: "C" },
  ]);

  it("唯一正确索引匹配 → true", () => {
    expect(evaluateAnswer(q, [1], [])).toBe(true);
  });

  it("其他索引 → false", () => {
    expect(evaluateAnswer(q, [0], [])).toBe(false);
    expect(evaluateAnswer(q, [2], [])).toBe(false);
  });

  it("空选择 → false", () => {
    expect(evaluateAnswer(q, [], [])).toBe(false);
  });
});

describe("evaluateAnswer / multiple", () => {
  const q = makeQuestion("m", "multiple", [0, 2], [
    { text: "A" },
    { text: "B" },
    { text: "C" },
    { text: "D" },
  ]);

  it("全部正确且只选这些 → true（顺序无关）", () => {
    expect(evaluateAnswer(q, [0, 2], [])).toBe(true);
    expect(evaluateAnswer(q, [2, 0], [])).toBe(true);
  });

  it("多选 → false", () => {
    expect(evaluateAnswer(q, [0, 1, 2], [])).toBe(false);
  });

  it("少选 → false", () => {
    expect(evaluateAnswer(q, [0], [])).toBe(false);
  });

  it("选错 → false", () => {
    expect(evaluateAnswer(q, [0, 1], [])).toBe(false);
  });

  it("空选择 → false", () => {
    expect(evaluateAnswer(q, [], [])).toBe(false);
  });
});

describe("evaluateAnswer / blank", () => {
  it("单空匹配", () => {
    const q = makeQuestion("b", "blank", "apple");
    expect(evaluateAnswer(q, [], ["apple"])).toBe(true);
    expect(evaluateAnswer(q, [], ["pear"])).toBe(false);
  });

  it("单空：大小写、空格不影响（matchAnswer 已规范化）", () => {
    const q = makeQuestion("b", "blank", "on (an) average");
    expect(evaluateAnswer(q, [], ["on average"])).toBe(true);
    expect(evaluateAnswer(q, [], ["on an average"])).toBe(true);
  });

  it("多空全对 → true", () => {
    const q = makeQuestion("b", "blank", ["alpha", "beta"]);
    expect(evaluateAnswer(q, [], ["alpha", "beta"])).toBe(true);
  });

  it("多空：任一空字符串 → false", () => {
    const q = makeQuestion("b", "blank", ["alpha", "beta"]);
    expect(evaluateAnswer(q, [], ["alpha", ""])).toBe(false);
    expect(evaluateAnswer(q, [], ["", "beta"])).toBe(false);
    expect(evaluateAnswer(q, [], ["alpha", "   "])).toBe(false);
  });

  it("多空：某空错 → false", () => {
    const q = makeQuestion("b", "blank", ["alpha", "beta"]);
    expect(evaluateAnswer(q, [], ["alpha", "gamma"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCorrectChoiceLetters
// ---------------------------------------------------------------------------

describe("getCorrectChoiceLetters", () => {
  it("single：返回 shuffled 后正确项的位置字母", () => {
    const q = makeQuestion("s", "single", [2]);
    // shuffled: originalIndex 顺序 [1, 2, 0] → 题目位置 A=1, B=2, C=0
    const shuffled = [
      { originalIndex: 1 },
      { originalIndex: 2 },
      { originalIndex: 0 },
    ];
    expect(getCorrectChoiceLetters(q, shuffled)).toBe("B");
  });

  it("multiple：多选时按字母排序后拼接", () => {
    const q = makeQuestion("m", "multiple", [0, 2]);
    // shuffled: [1, 2, 0, 3] → originalIndex=2 在 B 位，originalIndex=0 在 C 位
    const shuffled = [
      { originalIndex: 1 },
      { originalIndex: 2 },
      { originalIndex: 0 },
      { originalIndex: 3 },
    ];
    expect(getCorrectChoiceLetters(q, shuffled)).toBe("BC");
  });

  it("multiple：输入顺序不影响输出（结果会被 sort）", () => {
    const q = makeQuestion("m", "multiple", [2, 0]);
    const shuffled = [
      { originalIndex: 1 },
      { originalIndex: 2 },
      { originalIndex: 0 },
      { originalIndex: 3 },
    ];
    expect(getCorrectChoiceLetters(q, shuffled)).toBe("BC");
  });

  it("judgment 题型返回空串", () => {
    const q = makeQuestion("j", "judgment", true);
    expect(getCorrectChoiceLetters(q, [])).toBe("");
  });

  it("blank 题型返回空串", () => {
    const q = makeQuestion("b", "blank", "ans");
    expect(getCorrectChoiceLetters(q, [])).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildAnswerSet
// ---------------------------------------------------------------------------

describe("buildAnswerSet", () => {
  it("括号可选 on (an) average → 含 onanaverage 和 onaverage", () => {
    const set = buildAnswerSet("on (an) average");
    expect(set.has("onanaverage")).toBe(true);
    expect(set.has("onaverage")).toBe(true);
  });

  it("外层斜杠 fall ill/sick → 含 fallill 和 sick", () => {
    const set = buildAnswerSet("fall ill/sick");
    expect(set.has("fallill")).toBe(true);
    expect(set.has("sick")).toBe(true);
  });

  it("括号内斜杠 on (an/the) average → 展开三种组合", () => {
    const set = buildAnswerSet("on (an/the) average");
    expect(set.has("onanaverage")).toBe(true);
    expect(set.has("ontheaverage")).toBe(true);
    expect(set.has("onaverage")).toBe(true);
  });

  it("不应包含空串", () => {
    const set = buildAnswerSet("apple");
    expect(set.has("")).toBe(false);
    expect(set.has("apple")).toBe(true);
  });

  it("全角符号被规范化", () => {
    const set = buildAnswerSet("on （an） average");
    expect(set.has("onanaverage")).toBe(true);
    expect(set.has("onaverage")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeBlankAnswer
// ---------------------------------------------------------------------------

describe("normalizeBlankAnswer", () => {
  it("转小写", () => {
    expect(normalizeBlankAnswer("Apple")).toBe("apple");
  });

  it("去除空格", () => {
    expect(normalizeBlankAnswer("on an average")).toBe("onanaverage");
  });

  it("去除标点", () => {
    expect(normalizeBlankAnswer("don't")).toBe("dont");
    expect(normalizeBlankAnswer("hello, world!")).toBe("helloworld");
  });

  it("去除非字母字符（数字也被去除）", () => {
    expect(normalizeBlankAnswer("abc123")).toBe("abc");
  });

  it("全角括号 / 斜杠先转半角再清理", () => {
    expect(normalizeBlankAnswer("on （an）average")).toBe("onanaverage");
  });

  it("空字符串返回空", () => {
    expect(normalizeBlankAnswer("")).toBe("");
    expect(normalizeBlankAnswer("  ")).toBe("");
  });
});
