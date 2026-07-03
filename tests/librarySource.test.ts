import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STORAGE_KEY_ACTIVE_BANK,
  STORAGE_KEY_LIBRARY,
} from "../src/config";
import { LibrarySource } from "../src/source/library";

describe("LibrarySource", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("ignores malformed library index instead of crashing on startup", () => {
    localStorage.setItem(STORAGE_KEY_LIBRARY, JSON.stringify({ not: "an array" }));
    localStorage.setItem(STORAGE_KEY_ACTIVE_BANK, "c");

    const source = new LibrarySource();

    expect(source.listBanks()).toEqual([]);
    expect(source.getActiveBank()).toBeNull();
  });

  it("keeps only valid unique bank summaries from a corrupted index", () => {
    localStorage.setItem(
      STORAGE_KEY_LIBRARY,
      JSON.stringify([
        { hash: "a", name: "A", count: 1, addedAt: 1 },
        { hash: "a", name: "Duplicate A", count: 1, addedAt: 2 },
        { hash: "", name: "Missing hash", count: 1, addedAt: 3 },
        { hash: "b", name: "B", count: 2, addedAt: 4 },
        null,
      ]),
    );

    const source = new LibrarySource();

    expect(source.listBanks()).toEqual([
      { hash: "a", name: "A", count: 1, addedAt: 1 },
      { hash: "b", name: "B", count: 2, addedAt: 4 },
    ]);
  });

  it("moves selected banks to the top while preserving their relative order", () => {
    localStorage.setItem(
      STORAGE_KEY_LIBRARY,
      JSON.stringify([
        { hash: "a", name: "A", count: 1, addedAt: 1 },
        { hash: "b", name: "B", count: 1, addedAt: 2 },
        { hash: "c", name: "C", count: 1, addedAt: 3 },
        { hash: "d", name: "D", count: 1, addedAt: 4 },
      ]),
    );
    localStorage.setItem(STORAGE_KEY_ACTIVE_BANK, "c");

    const source = new LibrarySource();
    source.moveBanksToTop(["d", "b", "missing", "d"]);

    expect(source.listBanks().map((bank) => bank.hash)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
    expect(localStorage.getItem(STORAGE_KEY_ACTIVE_BANK)).toBe("c");
    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY_LIBRARY) ?? "[]").map(
        (bank: { hash: string }) => bank.hash,
      ),
    ).toEqual(["b", "d", "a", "c"]);
  });
});
