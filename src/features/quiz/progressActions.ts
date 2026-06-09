import { exportProgress, importProgress } from "../importExport";
import type { Question, RuntimeState, StoredState } from "../../types";

export type CopyResult = { ok: true } | { ok: false; error: string };

export async function copyProgressToClipboard(
  state: RuntimeState,
  hash: string,
  questions: readonly Question[],
): Promise<CopyResult> {
  try {
    const encoded = await exportProgress(state, hash, questions);
    await navigator.clipboard.writeText(encoded);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "导出失败" };
  }
}

export type ReadClipboardResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function readProgressFromClipboard(): Promise<ReadClipboardResult> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return { ok: false, error: "无法访问剪贴板，请检查浏览器权限。" };
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: "剪贴板为空，请先复制导出的进度字符串。" };
  }
  return { ok: true, text: trimmed };
}

export type ParseResult =
  | { ok: true; state: StoredState }
  | { ok: false; error: string };

export async function parseImportedProgress(
  text: string,
  hash: string,
  questions: readonly Question[],
): Promise<ParseResult> {
  try {
    const state = await importProgress(text, hash, questions);
    return { ok: true, state };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "未知错误" };
  }
}
