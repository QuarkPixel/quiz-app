export type SidebarSelectionState = {
  selectedHashes: string[];
  anchorHash: string | null;
};

export type SidebarSelectionModifiers = {
  shiftKey: boolean;
  metaKey: boolean;
};

export function createEmptySidebarSelection(): SidebarSelectionState {
  return { selectedHashes: [], anchorHash: null };
}

function filterKnownHashes(
  hashes: Iterable<string>,
  orderedHashes: readonly string[],
): string[] {
  const allowed = new Set(orderedHashes);
  const picked = new Set<string>();

  for (const hash of hashes) {
    if (!allowed.has(hash) || picked.has(hash)) continue;
    picked.add(hash);
  }

  return orderedHashes.filter((hash) => picked.has(hash));
}

function findRange(
  orderedHashes: readonly string[],
  startHash: string,
  endHash: string,
): string[] {
  const startIndex = orderedHashes.indexOf(startHash);
  const endIndex = orderedHashes.indexOf(endHash);
  if (startIndex === -1 || endIndex === -1) return [endHash];

  const from = Math.min(startIndex, endIndex);
  const to = Math.max(startIndex, endIndex);
  return orderedHashes.slice(from, to + 1);
}

export function reconcileSidebarSelection(
  selection: SidebarSelectionState,
  orderedHashes: readonly string[],
): SidebarSelectionState {
  const selectedHashes = filterKnownHashes(
    selection.selectedHashes,
    orderedHashes,
  );
  const anchorHash =
    selection.anchorHash !== null && orderedHashes.includes(selection.anchorHash)
      ? selection.anchorHash
      : null;

  return { selectedHashes, anchorHash };
}

export function selectSidebarItem(
  selection: SidebarSelectionState,
  orderedHashes: readonly string[],
  hash: string,
  modifiers: SidebarSelectionModifiers,
): SidebarSelectionState {
  if (!orderedHashes.includes(hash)) return selection;

  if (modifiers.shiftKey) {
    const anchorHash = selection.anchorHash ?? hash;
    const range = findRange(orderedHashes, anchorHash, hash);
    const selectedHashes = modifiers.metaKey
      ? filterKnownHashes(
          [...selection.selectedHashes, ...range],
          orderedHashes,
        )
      : range;

    return { selectedHashes, anchorHash };
  }

  if (modifiers.metaKey) {
    const hasHash = selection.selectedHashes.includes(hash);
    const selectedHashes = hasHash
      ? selection.selectedHashes.filter((selectedHash) => selectedHash !== hash)
      : filterKnownHashes([...selection.selectedHashes, hash], orderedHashes);

    return { selectedHashes, anchorHash: hash };
  }

  return { selectedHashes: [hash], anchorHash: hash };
}

export function selectSidebarItemFromContextMenu(
  selection: SidebarSelectionState,
  orderedHashes: readonly string[],
  hash: string,
): SidebarSelectionState {
  if (!orderedHashes.includes(hash)) return selection;
  if (selection.selectedHashes.includes(hash)) return selection;
  return { selectedHashes: [hash], anchorHash: hash };
}
