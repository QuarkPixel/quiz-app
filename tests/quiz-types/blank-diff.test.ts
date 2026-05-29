import { describe, it, expect } from "vitest";
import { computeBlankDiff } from "../../src/quiz/types/blank/diff";
import type { BlankDiffSegment } from "../../src/quiz/types/blank/diff";

/** 渲染必须逐字还原用户原始输入：equal + extra 拼起来 === userInput。 */
function visibleUserText(segs: BlankDiffSegment[]): string {
  return segs
    .filter((s) => s.type !== "missing")
    .map((s) => s.text)
    .join("");
}

describe("computeBlankDiff —— 展示条件", () => {
  it("含括号的答案不展示", () => {
    expect(computeBlankDiff("on average", "on (an) average")).toBeNull();
  });

  it("含斜杠的答案不展示", () => {
    expect(computeBlankDiff("fall sik", "fall ill/sick")).toBeNull();
  });

  it("含占位词 sb/sth 的答案不展示", () => {
    expect(computeBlankDiff("remind of", "remind sb of sth")).toBeNull();
  });

  it("含 one's 的答案不展示", () => {
    expect(computeBlankDiff("do homewrok", "do one's homework")).toBeNull();
  });

  it("空输入不展示", () => {
    expect(computeBlankDiff("", "hello")).toBeNull();
    expect(computeBlankDiff("   ", "hello")).toBeNull();
  });

  it("相似度低于阈值不展示", () => {
    expect(computeBlankDiff("xyz", "accommodate")).toBeNull();
  });
});

describe("computeBlankDiff —— diff 片段", () => {
  it("漏字符：accomodate → accommodate", () => {
    expect(computeBlankDiff("accomodate", "accommodate")).toEqual<
      BlankDiffSegment[]
    >([
      { type: "equal", text: "accom" },
      { type: "missing", text: "m" },
      { type: "equal", text: "odate" },
    ]);
  });

  it("多字符标 extra：helllo → hello", () => {
    const segs = computeBlankDiff("helllo", "hello");
    expect(segs).not.toBeNull();
    expect(segs!.some((s) => s.type === "extra")).toBe(true);
    expect(visibleUserText(segs!)).toBe("helllo");
  });
});

describe("computeBlankDiff —— 保留用户原始输入样貌", () => {
  it("大小写与标点原样保留、不计为差异", () => {
    expect(computeBlankDiff("Hello!", "hello")).toEqual<BlankDiffSegment[]>([
      { type: "equal", text: "Hello!" },
    ]);
  });

  it("前后空格原样保留", () => {
    expect(computeBlankDiff(" hello ", "hello")).toEqual<BlankDiffSegment[]>([
      { type: "equal", text: " hello " },
    ]);
  });

  it("多词答案保留词间空格，缺字符插在自然位置", () => {
    const segs = computeBlankDiff("make progres", "make progress");
    expect(segs).toEqual<BlankDiffSegment[]>([
      { type: "equal", text: "make progres" },
      { type: "missing", text: "s" },
    ]);
  });

  it("保留用户大小写的同时标出漏字符", () => {
    const segs = computeBlankDiff("Make Progres", "make progress");
    expect(segs).not.toBeNull();
    expect(visibleUserText(segs!)).toBe("Make Progres");
    expect(segs!.some((s) => s.type === "missing" && s.text === "s")).toBe(true);
  });

  it("缺失字符取答案原文大小写", () => {
    // 用户漏掉首字母 H；missing 段应显示答案里的大写 H
    const segs = computeBlankDiff("ello", "Hello");
    expect(segs).toEqual<BlankDiffSegment[]>([
      { type: "missing", text: "H" },
      { type: "equal", text: "ello" },
    ]);
  });
});
