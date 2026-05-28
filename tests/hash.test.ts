import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { hashQuestionsJson } from "../src/lib/hash";

function nodeHash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, 16);
}

describe("hashQuestionsJson / 基本性质", () => {
  it("同一输入 → 同一 hash（确定性）", async () => {
    const json = '[{"id":"q1","type":"judgment","question":"a","answer":true}]';
    const h1 = await hashQuestionsJson(json);
    const h2 = await hashQuestionsJson(json);
    expect(h1).toBe(h2);
  });

  it("不同输入 → 不同 hash", async () => {
    const h1 = await hashQuestionsJson("[]");
    const h2 = await hashQuestionsJson("[{}]");
    expect(h1).not.toBe(h2);
  });

  it("hash 是 16 字符 hex", async () => {
    const h = await hashQuestionsJson("[]");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("hashQuestionsJson / 与 Node 端 SHA-1 算法一致", () => {
  it("空字符串", async () => {
    const input = "";
    expect(await hashQuestionsJson(input)).toBe(nodeHash(input));
  });

  it("纯 ASCII", async () => {
    const input = '[{"id":"q1","type":"single","question":"hello","answer":[0]}]';
    expect(await hashQuestionsJson(input)).toBe(nodeHash(input));
  });

  it("含 Unicode（中文）", async () => {
    const input = '[{"id":"中1","type":"judgment","question":"测试题目","answer":true}]';
    expect(await hashQuestionsJson(input)).toBe(nodeHash(input));
  });

  it("含 Unicode（Emoji + 中英混排）", async () => {
    const input = '[{"id":"q-emoji","type":"blank","question":"答案是 hello 世界","answer":"hello 世界"}]';
    expect(await hashQuestionsJson(input)).toBe(nodeHash(input));
  });

  it("空 JSON 数组", async () => {
    const input = "[]";
    expect(await hashQuestionsJson(input)).toBe(nodeHash(input));
  });

  it("大体积输入（多题）", async () => {
    const questions = Array.from({ length: 200 }, (_, i) => ({
      id: `q${i}`,
      type: "single" as const,
      question: `题目 ${i}：选择正确答案`,
      answer: [i % 4],
    }));
    const input = JSON.stringify(questions);
    expect(await hashQuestionsJson(input)).toBe(nodeHash(input));
  });
});

describe("hashQuestionsJson / 敏感性", () => {
  it("单字符差异 → 不同 hash", async () => {
    const a = await hashQuestionsJson('{"a":1}');
    const b = await hashQuestionsJson('{"a":2}');
    expect(a).not.toBe(b);
  });

  it("空白差异 → 不同 hash（约定调用方先 minify）", async () => {
    // 这是设计意图：调用方负责传 canonical（minified）JSON；
    // 输入的空白差异会反映在 hash 上
    const minified = '[{"id":"q1"}]';
    const pretty = '[\n  {\n    "id": "q1"\n  }\n]';
    const a = await hashQuestionsJson(minified);
    const b = await hashQuestionsJson(pretty);
    expect(a).not.toBe(b);
  });
});
