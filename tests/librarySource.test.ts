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
