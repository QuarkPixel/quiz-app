import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBankFileJson } from "../src/lib/bankFile";

function readExample(name: string): string {
  // vitest 的 cwd 是项目根目录
  return readFileSync(resolve(process.cwd(), "assets/examples", name), "utf-8");
}

// 这两个文件是给用户看的示例，必须能真的被导入流程接受。
describe("assets/examples", () => {
  it("quiz.json 能通过解析（刷题模式）", () => {
    const result = parseBankFileJson(readExample("quiz.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("quiz");
    expect(result.title).toBe("示例题库（刷题）");
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it("memory.json 能通过解析（记忆模式，题目可省略 type）", () => {
    const result = parseBankFileJson(readExample("memory.json"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("memory");
    expect(result.title).toBe("示例题库（记忆）");
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.questions.every((q) => q.type === "memory")).toBe(true);
  });
});
