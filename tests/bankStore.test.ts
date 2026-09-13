import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEY_GENERAL } from "../src/config";
import { BankStore } from "../src/source/bankStore";

function seedGeneral(raw: unknown): void {
  localStorage.setItem(STORAGE_KEY_GENERAL, JSON.stringify(raw));
}

function readGeneral(): {
  activeBank: string | null;
  library: { hash: string }[];
} {
  return JSON.parse(localStorage.getItem(STORAGE_KEY_GENERAL) ?? "{}");
}

describe("BankStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("ignores malformed library index instead of crashing on startup", () => {
    seedGeneral({ library: { not: "an array" }, activeBank: "c" });

    const source = new BankStore();

    expect(source.listBanks()).toEqual([]);
    expect(source.getActiveBank()).toBeNull();
  });

  it("keeps only valid unique bank summaries from a corrupted index", () => {
    seedGeneral({
      library: [
        { hash: "a", name: "A", count: 1, addedAt: 1 },
        { hash: "a", name: "Duplicate A", count: 1, addedAt: 2 },
        { hash: "", name: "Missing hash", count: 1, addedAt: 3 },
        { hash: "b", name: "B", count: 2, addedAt: 4 },
        null,
      ],
    });

    const source = new BankStore();

    expect(source.listBanks()).toEqual([
      { hash: "a", name: "A", mode: "quiz", count: 1, addedAt: 1 },
      { hash: "b", name: "B", mode: "quiz", count: 2, addedAt: 4 },
    ]);
  });

  it("moves selected banks to the top while preserving their relative order", () => {
    seedGeneral({
      activeBank: "c",
      library: [
        { hash: "a", name: "A", count: 1, addedAt: 1 },
        { hash: "b", name: "B", count: 1, addedAt: 2 },
        { hash: "c", name: "C", count: 1, addedAt: 3 },
        { hash: "d", name: "D", count: 1, addedAt: 4 },
      ],
    });

    const source = new BankStore();
    source.moveBanksToTop(["d", "b", "missing", "d"]);

    expect(source.listBanks().map((bank) => bank.hash)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);

    const general = readGeneral();
    expect(general.activeBank).toBe("c");
    expect(general.library.map((bank) => bank.hash)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("imports a unified bank file and records its mode", async () => {
    const source = new BankStore();
    const raw = JSON.stringify({
      questions: [
        { id: "j1", type: "judgment", question: "q", answer: true },
      ],
    });

    const result = await source.importBank("测试题库", raw);

    expect(result.kind).toBe("ok");
    expect(source.listBanks()).toHaveLength(1);
    expect(source.listBanks()[0].mode).toBe("quiz");
    expect(source.listBanks()[0].count).toBe(1);
    expect(source.getActiveBank()?.mode).toBe("quiz");
  });

  it("rejects a bare array bank file", async () => {
    const source = new BankStore();
    const raw = JSON.stringify([
      { id: "j1", type: "judgment", question: "q", answer: true },
    ]);

    const result = await source.importBank("旧格式", raw);

    expect(result.kind).toBe("invalid");
    expect(source.listBanks()).toHaveLength(0);
  });
});
