import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ImportProgressDialog from "../src/components/settings/ImportProgressDialog.svelte";

/**
 * 「导入进度」二次确认弹窗（刷题 / 记忆两个模式共用）。
 *
 * 守的是三件事：
 *   1. `text === null` 时一个弹窗都不许渲染。两个 session 各自常驻挂着一个这个
 *      组件（`importConfirmText`），没有待确认的导入却弹出一个空对话框，
 *      用户会以为哪里坏了。
 *   2. 文案必须说清「覆盖当前所有进度、无法撤销」。导入进度是**不可逆**的
 *      覆盖，唯一一句破坏性提示被删掉，用户就只能靠猜。
 *   3. 两个按钮各只触发一次回调。`onCancel` 同时挂在 Dialog 的
 *      `onOpenChange(false)` 上，一次点击要是穿过两条路径，取消会变成两次、
 *      `commitImport()` 也会被调两次（重复覆盖 / 重复落盘）。
 */

let app: Record<string, unknown> | null = null;
let host: HTMLElement | null = null;

interface DialogProps {
  text: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 挂一个弹窗；调用方只需要给三个 prop，其余（portal 等）由组件自己处理 */
function mountDialog(props: Partial<DialogProps> = {}): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  app = mount(ImportProgressDialog, {
    target: host,
    props: {
      text: props.text ?? null,
      onCancel: props.onCancel ?? (() => {}),
      onConfirm: props.onConfirm ?? (() => {}),
    },
  });
  flushSync();
}

/** 弹窗走 portal 挂在 body 上，所以按角色在整页里找，而不是在 host 里找 */
function dialogs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
}

/** 按可见文字找弹窗里的按钮 */
function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`找不到按钮：${text}`);
  return button;
}

afterEach(() => {
  if (app) void unmount(app);
  app = null;
  host?.remove();
  host = null;
  // Dialog 的 portal 挂在 body 上：不清干净会污染后面的用例
  document.body.innerHTML = "";
});

describe("导入进度确认弹窗", () => {
  it("text 为 null：不渲染任何弹窗", () => {
    mountDialog({ text: null });

    expect(dialogs()).toEqual([]);
    expect(document.body.textContent).not.toContain("导入进度");
  });

  it("给了 text：标题与「覆盖当前所有进度」的说明都在", () => {
    mountDialog({ text: "备份串" });

    expect(dialogs()).toHaveLength(1);
    expect(document.body.textContent).toContain("导入进度");
    expect(document.body.textContent).toContain("覆盖当前所有进度");
    // 不可撤销这件事必须写出来，否则用户以为还能撤回
    expect(document.body.textContent).toContain("无法撤销");
  });

  it("点「取消」只调一次 onCancel，不碰 onConfirm", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    mountDialog({ text: "备份串", onCancel, onConfirm });

    buttonByText("取消").click();
    flushSync();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("点「导入」只调一次 onConfirm，不碰 onCancel", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    mountDialog({ text: "备份串", onCancel, onConfirm });

    buttonByText("导入").click();
    flushSync();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
