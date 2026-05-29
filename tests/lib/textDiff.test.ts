import { describe, it, expect } from "vitest";
import { diffChars, similarityRatio } from "../../src/lib/textDiff";
import type { DiffOp } from "../../src/lib/textDiff";

/** equal+delete 应还原 from；equal+insert 应还原 to。任意 diff 都满足。 */
function assertReconstructs(from: string, to: string): void {
  const ops = diffChars(from, to);
  const rebuiltFrom = ops
    .filter((o) => o.type !== "insert")
    .map((o) => o.text)
    .join("");
  const rebuiltTo = ops
    .filter((o) => o.type !== "delete")
    .map((o) => o.text)
    .join("");
  expect(rebuiltFrom).toBe(from);
  expect(rebuiltTo).toBe(to);
}

describe("diffChars", () => {
  it("完全相同 → 单个 equal", () => {
    expect(diffChars("abc", "abc")).toEqual<DiffOp[]>([
      { type: "equal", text: "abc" },
    ]);
  });

  it("from 为空 → 全 insert", () => {
    expect(diffChars("", "abc")).toEqual<DiffOp[]>([
      { type: "insert", text: "abc" },
    ]);
  });

  it("to 为空 → 全 delete", () => {
    expect(diffChars("abc", "")).toEqual<DiffOp[]>([
      { type: "delete", text: "abc" },
    ]);
  });

  it("纯缺失：accomodate → accommodate 漏一个 m", () => {
    expect(diffChars("accomodate", "accommodate")).toEqual<DiffOp[]>([
      { type: "equal", text: "accom" },
      { type: "insert", text: "m" },
      { type: "equal", text: "odate" },
    ]);
  });

  it("连续同类字符合并为一段", () => {
    expect(diffChars("ab", "axxb")).toEqual<DiffOp[]>([
      { type: "equal", text: "a" },
      { type: "insert", text: "xx" },
      { type: "equal", text: "b" },
    ]);
  });

  it("有错有缺也能还原两端（recieve/receive）", () => {
    assertReconstructs("recieve", "receive");
  });

  it("毫不相关也能还原两端", () => {
    assertReconstructs("abc", "xyz");
  });
});

describe("similarityRatio", () => {
  it("完全相同 = 1", () => {
    expect(similarityRatio("hello", "hello")).toBe(1);
  });

  it("两个空串 = 1", () => {
    expect(similarityRatio("", "")).toBe(1);
  });

  it("一空一非空 = 0", () => {
    expect(similarityRatio("", "abc")).toBe(0);
    expect(similarityRatio("abc", "")).toBe(0);
  });

  it("毫不相关 = 0", () => {
    expect(similarityRatio("abc", "xyz")).toBe(0);
  });

  it("recieve/receive ≈ 0.857", () => {
    expect(similarityRatio("recieve", "receive")).toBeCloseTo(12 / 14, 5);
  });

  it("accomodate/accommodate ≈ 0.952", () => {
    expect(similarityRatio("accomodate", "accommodate")).toBeCloseTo(
      20 / 21,
      5,
    );
  });
});
