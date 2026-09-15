const INTERACTIVE_TARGET_SELECTOR = [
  "button",
  "a[href]",
  "area[href]",
  "summary",
  "iframe",
  "object",
  "embed",
  "audio[controls]",
  "video[controls]",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='gridcell']",
  "[role='link']",
  "[role='listbox']",
  "[role='menuitem']",
  "[role='menuitemcheckbox']",
  "[role='menuitemradio']",
  "[role='option']",
  "[role='radio']",
  "[role='searchbox']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='switch']",
  "[role='tab']",
  "[role='textbox']",
  "[role='treeitem']",
].join(",");

function eventTargetElement(event: KeyboardEvent): Element | null {
  if (typeof Element === "undefined") return null;
  return event.target instanceof Element ? event.target : null;
}

export function isEditingTarget(event: KeyboardEvent): boolean {
  const target = eventTargetElement(event);
  if (!target) return false;

  return (
    target.closest("input, textarea, select, [contenteditable]") !== null ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function isInteractiveTarget(event: KeyboardEvent): boolean {
  const target = eventTargetElement(event);
  if (!target) return false;

  return (
    isEditingTarget(event) ||
    target.closest(INTERACTIVE_TARGET_SELECTOR) !== null
  );
}

/**
 * 焦点是否在打开的对话框里（此时只允许对话框自己的 Esc / Enter 生效）。
 * 刷题 / 记忆两个模式的处理器共用同一口径。
 */
export function isInsideDialog(event: KeyboardEvent): boolean {
  const target = eventTargetElement(event);
  if (!target) return false;

  return target.closest('[role="dialog"]') !== null;
}

export function hasSelectedText(): boolean {
  if (typeof window === "undefined" || !window.getSelection) return false;
  return (window.getSelection()?.toString().length ?? 0) > 0;
}
