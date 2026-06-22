import { describe, expect, it } from "vitest";
import {
  createEmptySidebarSelection,
  reconcileSidebarSelection,
  selectSidebarItem,
  selectSidebarItemFromContextMenu,
} from "../src/features/sidebarSelection";

const ORDER = ["a", "b", "c", "d"];

describe("sidebar selection", () => {
  it("plain click selects only the clicked item", () => {
    const next = selectSidebarItem(
      createEmptySidebarSelection(),
      ORDER,
      "b",
      { shiftKey: false, metaKey: false },
    );

    expect(next).toEqual({
      selectedHashes: ["b"],
      anchorHash: "b",
    });
  });

  it("meta click toggles items without changing the display order", () => {
    const selected = selectSidebarItem(
      { selectedHashes: ["b"], anchorHash: "b" },
      ORDER,
      "d",
      { shiftKey: false, metaKey: true },
    );
    const toggledOff = selectSidebarItem(
      selected,
      ORDER,
      "b",
      { shiftKey: false, metaKey: true },
    );

    expect(selected.selectedHashes).toEqual(["b", "d"]);
    expect(toggledOff).toEqual({
      selectedHashes: ["d"],
      anchorHash: "b",
    });
  });

  it("shift click replaces the selection with the anchor range", () => {
    const next = selectSidebarItem(
      { selectedHashes: ["b"], anchorHash: "b" },
      ORDER,
      "d",
      { shiftKey: true, metaKey: false },
    );

    expect(next).toEqual({
      selectedHashes: ["b", "c", "d"],
      anchorHash: "b",
    });
  });

  it("meta+shift click unions the range into the current selection", () => {
    const next = selectSidebarItem(
      { selectedHashes: ["a"], anchorHash: "b" },
      ORDER,
      "d",
      { shiftKey: true, metaKey: true },
    );

    expect(next).toEqual({
      selectedHashes: ["a", "b", "c", "d"],
      anchorHash: "b",
    });
  });

  it("context menu keeps an existing multi-selection", () => {
    const next = selectSidebarItemFromContextMenu(
      { selectedHashes: ["b", "c"], anchorHash: "b" },
      ORDER,
      "c",
    );

    expect(next).toEqual({
      selectedHashes: ["b", "c"],
      anchorHash: "b",
    });
  });

  it("context menu collapses to the clicked item when it was not selected", () => {
    const next = selectSidebarItemFromContextMenu(
      { selectedHashes: ["b", "c"], anchorHash: "b" },
      ORDER,
      "d",
    );

    expect(next).toEqual({
      selectedHashes: ["d"],
      anchorHash: "d",
    });
  });

  it("reconcile drops removed hashes and invalid anchors", () => {
    const next = reconcileSidebarSelection(
      { selectedHashes: ["b", "x", "d"], anchorHash: "x" },
      ["a", "b", "c"],
    );

    expect(next).toEqual({
      selectedHashes: ["b"],
      anchorHash: null,
    });
  });
});
