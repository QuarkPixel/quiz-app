import { describe, it, expect } from "vitest";
import { matchAnswer } from "../src/features/quiz/answerMatcher";

describe("括号可选 (xxx)", () => {
  it("括号内容存在时匹配", () => {
    expect(matchAnswer("on (an) average", "on an average")).toBe(true);
  });
  it("括号内容省略时匹配", () => {
    expect(matchAnswer("on (an) average", "on average")).toBe(true);
  });
  it("错误内容不匹配", () => {
    expect(matchAnswer("on (an) average", "in average")).toBe(false);
  });
  it("全角括号自动转半角", () => {
    expect(matchAnswer("on （an） average", "on an average")).toBe(true);
  });
  it("多个括号组合", () => {
    expect(matchAnswer("(be) (very) happy", "be very happy")).toBe(true);
    expect(matchAnswer("(be) (very) happy", "be happy")).toBe(true);
    expect(matchAnswer("(be) (very) happy", "very happy")).toBe(true);
    expect(matchAnswer("(be) (very) happy", "happy")).toBe(true);
  });
});

describe("括号内斜杠 (A/B)：词级选择", () => {
  it("选第一项", () => {
    expect(matchAnswer("on (an/the) average", "on an average")).toBe(true);
  });
  it("选第二项", () => {
    expect(matchAnswer("on (an/the) average", "on the average")).toBe(true);
  });
  it("括号整体省略", () => {
    expect(matchAnswer("on (an/the) average", "on average")).toBe(true);
  });
  it("错误选项不匹配", () => {
    expect(matchAnswer("on (an/the) average", "on a average")).toBe(false);
  });
  it("(be/get) used to 词级选择", () => {
    expect(matchAnswer("(be/get) used to", "be used to")).toBe(true);
    expect(matchAnswer("(be/get) used to", "get used to")).toBe(true);
    expect(matchAnswer("(be/get) used to", "used to")).toBe(true); // 括号可省略
  });
});

describe("外层斜杠 A/B：带前缀共享的分支匹配", () => {
  it("完整匹配第一分支", () => {
    expect(matchAnswer("fall ill/sick", "fall ill")).toBe(true);
  });
  it("前缀共享后匹配第二分支（核心场景）", () => {
    expect(matchAnswer("fall ill/sick", "fall sick")).toBe(true);
  });
  it("直接匹配第二分支", () => {
    expect(matchAnswer("fall ill/sick", "sick")).toBe(true);
  });
  it("不完整输入不匹配", () => {
    expect(matchAnswer("fall ill/sick", "fall")).toBe(false);
  });
  it("多余词不匹配", () => {
    expect(matchAnswer("fall ill/sick", "fall ill quickly")).toBe(false);
  });
  it("三个外层分支", () => {
    expect(matchAnswer("A/B/C", "A")).toBe(true);
    expect(matchAnswer("A/B/C", "B")).toBe(true);
    expect(matchAnswer("A/B/C", "C")).toBe(true);
    expect(matchAnswer("A/B/C", "D")).toBe(false);
  });
  it("整句级分支（be/get used to）", () => {
    expect(matchAnswer("be/get used to", "be")).toBe(true);
    expect(matchAnswer("be/get used to", "get used to")).toBe(true);
    expect(matchAnswer("be/get used to", "be used to")).toBe(true);  // 宽松：be + 共享后缀
  });
});

describe("规范化：忽略大小写、空格、标点", () => {
  it("忽略大小写", () => {
    expect(matchAnswer("On (An) Average", "ON AN AVERAGE")).toBe(true);
  });
  it("忽略多余空格", () => {
    expect(matchAnswer("on (an) average", "on  an  average")).toBe(true);
  });
  it("全角斜杠转半角", () => {
    expect(matchAnswer("fall ill／sick", "fall sick")).toBe(true);
  });
});

describe("多词前缀共享（外层斜杠跨词传递）", () => {
  it("draw/reach/come to a conclusion — 选 draw", () => {
    expect(matchAnswer("draw/reach/come to a conclusion", "draw a conclusion")).toBe(true);
  });
  it("draw/reach/come to a conclusion — 选 reach", () => {
    expect(matchAnswer("draw/reach/come to a conclusion", "reach a conclusion")).toBe(true);
  });
  it("draw/reach/come to a conclusion — 选 come", () => {
    expect(matchAnswer("draw/reach/come to a conclusion", "come to a conclusion")).toBe(true);
  });
  it("draw/reach/come to a conclusion — 错误动词", () => {
    expect(matchAnswer("draw/reach/come to a conclusion", "make a conclusion")).toBe(false);
  });
  it("前缀跨多个分支传递：go/come back home", () => {
    expect(matchAnswer("go/come back home", "go back home")).toBe(true);
    expect(matchAnswer("go/come back home", "come back home")).toBe(true);
    expect(matchAnswer("go/come back home", "back home")).toBe(false);
  });
  it("三路分支共享后缀：eat/drink/sleep well", () => {
    expect(matchAnswer("eat/drink/sleep well", "eat well")).toBe(true);
    expect(matchAnswer("eat/drink/sleep well", "drink well")).toBe(true);
    expect(matchAnswer("eat/drink/sleep well", "sleep well")).toBe(true);
    expect(matchAnswer("eat/drink/sleep well", "run well")).toBe(false);
  });
  it("前缀词后跟括号可选：start/begin (to) work", () => {
    expect(matchAnswer("start/begin (to) work", "start to work")).toBe(true);
    expect(matchAnswer("start/begin (to) work", "start work")).toBe(true);
    expect(matchAnswer("start/begin (to) work", "begin to work")).toBe(true);
    expect(matchAnswer("start/begin (to) work", "begin work")).toBe(true);
  });
});

describe("sth / sb 占位词自动可选", () => {
  it("remind sb of sth", () => {
    expect(matchAnswer("remind sb of sth", "remind sb of sth")).toBe(true);
    expect(matchAnswer("remind sb of sth", "remind of")).toBe(true);
    expect(matchAnswer("remind sb of sth", "remind of sth")).toBe(true);
    expect(matchAnswer("remind sb of sth", "remind sb of")).toBe(true);
  });
  it("ask sb to do sth", () => {
    expect(matchAnswer("ask sb to do sth", "ask to do")).toBe(true);
    expect(matchAnswer("ask sb to do sth", "ask sb to do")).toBe(true);
  });
  it("make progress 不含 sb/sth，不受影响", () => {
    expect(matchAnswer("make progress", "make progress")).toBe(true);
    expect(matchAnswer("make progress", "make")).toBe(false);
  });
});

describe("边界情况", () => {
  it("空输入返回 false", () => {
    expect(matchAnswer("something", "")).toBe(false);
    expect(matchAnswer("something", "   ")).toBe(false);
  });
  it("纯括号可选词", () => {
    expect(matchAnswer("make (both) ends meet", "make ends meet")).toBe(true);
    expect(matchAnswer("make (both) ends meet", "make both ends meet")).toBe(true);
  });
});
