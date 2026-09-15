import { describe, expect, it, vi } from "vitest";
import { BankImportSession } from "../src/features/bankFiles";
import type {
  ApplyStateResult,
  BankSummary,
  ImportBankResult,
  QuizSource,
} from "../src/source/types";

function jsonFile(name: string): File {
  return new File(['{"questions":[]}'], name, {
    type: "application/json",
  });
}

function createSource(
  importResults: ImportBankResult[],
  applyResult: ApplyStateResult = { ok: true },
): QuizSource & {
  importBank: ReturnType<typeof vi.fn>;
  applyStateToBank: ReturnType<typeof vi.fn>;
} {
  const summaries: BankSummary[] = [
    { hash: "existing", name: "既有题库", mode: "quiz", count: 1, addedAt: 0 },
  ];
  const queue = [...importResults];

  return {
    getActiveBank: () => null,
    subscribe: () => () => undefined,
    listBanks: () => summaries,
    setActiveBank: () => undefined,
    renameBank: () => undefined,
    removeBank: () => undefined,
    moveBanksToTop: () => undefined,
    importBank: vi.fn(async () => {
      const result = queue.shift();
      if (result === undefined) throw new Error("unexpected import");
      return result;
    }),
    applyStateToBank: vi.fn(async () => applyResult),
    exportBank: vi.fn(async () => null),
  };
}

describe("bank file import session", () => {
  it("summarizes multiple imports and lists each ordinary failure", async () => {
    const source = createSource([
      { kind: "ok", hash: "ok" },
      { kind: "invalid", errors: ["第 1 题缺少 question"] },
      { kind: "duplicate", hash: "duplicate" },
    ]);

    const session = await BankImportSession.create(source, [
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

    const session = await BankImportSession.create(source, [
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

    const session = await BankImportSession.create(source, [
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

  it("imports clipboard text with a stable fallback bank name", async () => {
    const rawJson = '{"questions":[{"id":"q1"}]}';
    const source = createSource([{ kind: "ok", hash: "ok" }]);
    const readText = vi.fn(async () => rawJson);

    const session = await BankImportSession.createFromClipboard(
      source,
      readText,
    );
    const prompt = session.currentPrompt();

    expect(readText).toHaveBeenCalledOnce();
    expect(source.importBank).toHaveBeenCalledWith("剪贴板题库", rawJson);
    expect(prompt.kind).toBe("summary");
    if (prompt.kind !== "summary") throw new Error("expected summary");
    expect(prompt.message).toEqual({
      title: "导入成功",
      text: "已导入「剪贴板内容」。",
    });
  });

  it("reports an empty clipboard without calling importBank", async () => {
    const source = createSource([]);
    const readText = vi.fn(async () => " \n ");

    const session = await BankImportSession.createFromClipboard(
      source,
      readText,
    );
    const prompt = session.currentPrompt();

    expect(source.importBank).not.toHaveBeenCalled();
    expect(prompt.kind).toBe("summary");
    if (prompt.kind !== "summary") throw new Error("expected summary");
    expect(prompt.message.title).toBe("导入失败");
    expect(prompt.message.text).toContain("剪贴板为空。");
  });

  it("reports clipboard read failures without calling importBank", async () => {
    const source = createSource([]);
    const readText = vi.fn(async () => {
      throw new Error("permission denied");
    });

    const session = await BankImportSession.createFromClipboard(
      source,
      readText,
    );
    const prompt = session.currentPrompt();

    expect(source.importBank).not.toHaveBeenCalled();
    expect(prompt.kind).toBe("summary");
    if (prompt.kind !== "summary") throw new Error("expected summary");
    expect(prompt.message.title).toBe("导入失败");
    expect(prompt.message.text).toContain("读取剪贴板失败：permission denied");
  });
});

