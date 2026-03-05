export function isEditingTarget(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;

  return (
    !!target &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  );
}
