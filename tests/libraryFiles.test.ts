import { describe, expect, it, vi } from "vitest";
import { LibraryImportSession } from "../src/features/libraryFiles";
import type {
  ApplyStateResult,
  BankSummary,
  ImportBankResult,
  QuizSource,
} from "../src/source/types";

function jsonFile(name: string): File {
  return new File(["[]"], name, { type: "application/json" });
}

function createSource(
  importResults: ImportBankResult[],
  applyResult: ApplyStateResult = { ok: true },
): QuizSource & {
  importBank: ReturnType<typeof vi.fn>;
  applyStateToBank: ReturnType<typeof vi.fn>;
} {
  const summaries: BankSummary[] = [
    { hash: "existing", name: "既有题库", count: 1, addedAt: 0 },
  ];
  const queue = [...importResults];

  return {
    mode: "library",
    getActiveBank: () => null,
    subscribe: () => () => undefined,
    listBanks: () => summaries,
    importBank: vi.fn(async () => {
      const result = queue.shift();
      if (result === undefined) throw new Error("unexpected import");
      return result;
    }),
    applyStateToBank: vi.fn(async () => applyResult),
  };
}

describe("library file import session", () => {
  it("summarizes multiple imports and lists each ordinary failure", async () => {
    const source = createSource([
      { kind: "ok", hash: "ok" },
      { kind: "invalid", errors: ["第 1 题缺少 question"] },
      { kind: "duplicate", hash: "duplicate" },
    ]);

    const session = await LibraryImportSession.create(source, [
      jsonFile("ok.json"),
      jsonFile("bad.json"),
      jsonFile("duplicate.json"),
    ]);
    const prompt = session.currentPrompt();

    expect(prompt.kind).toBe("summary");
    if (prompt.kind !== "summary") throw new Error("expected summary");
    expect(prompt.message.text).toContain("1 个成功，2 个失败。");
    expect(prompt.message.text).toContain(
      "- bad.json：第 1 题缺少 question",
    );
    expect(prompt.message.text).toContain("- duplicate.json：题库已存在。");
  });

  it("asks for duplicate progress overwrite before the final summary", async () => {
    const source = createSource([
      { kind: "invalid", errors: ["JSON 解析失败"] },
      { kind: "duplicate", hash: "existing", stateStr: "state-backup" },
    ]);

    const session = await LibraryImportSession.create(source, [
      jsonFile("bad.json"),
      jsonFile("existing.json"),
    ]);
    let prompt = session.currentPrompt();

    expect(prompt.kind).toBe("overwrite");
    if (prompt.kind !== "overwrite") throw new Error("expected overwrite");
    expect(prompt.request.fileName).toBe("existing.json");
    expect(prompt.request.bankName).toBe("既有题库");

    prompt = await session.resolveOverwrite(true);

    expect(source.applyStateToBank).toHaveBeenCalledWith(
      "existing",
      "state-backup",
    );
    expect(prompt.kind).toBe("summary");
    if (prompt.kind !== "summary") throw new Error("expected summary");
    expect(prompt.message.text).toContain("1 个成功，1 个失败。");
    expect(prompt.message.text).toContain("- bad.json：JSON 解析失败");
  });

  it("uses concise copy for a single successful file", async () => {
    const source = createSource([{ kind: "ok", hash: "ok" }]);

    const session = await LibraryImportSession.create(source, [
      jsonFile("single.json"),
    ]);
    const prompt = session.currentPrompt();

    expect(prompt.kind).toBe("summary");
    if (prompt.kind !== "summary") throw new Error("expected summary");
    expect(prompt.message).toEqual({
      title: "导入成功",
      text: "已导入「single.json」。",
    });
  });
});
