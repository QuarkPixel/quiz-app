/**
 * 全局提示（Toast）的状态机。
 *
 * 它是**单例**：整个应用只在 `App.svelte` 里渲染一份 `<AlertToast>`，谁都能
 * `toastStore.show(...)`。以前每个视图各挂一份，同一个提示可能弹好几次，
 * 挂在设置弹窗里的那份还会被 Dialog 夹住、关掉弹窗就没了。
 */

import { afterEach, describe, expect, test, vi } from "vitest";

import { toastStore } from "@/features/toast.svelte";
import { TOAST_DURATION_MS, TOAST_FADE_MS } from "@/config";

describe("全局提示", () => {
  afterEach(() => {
    toastStore.dismiss();
    vi.useRealTimers();
  });

  test("show 之后可见，过一会儿自己消失（先淡出、再从 DOM 里拿掉）", () => {
    vi.useFakeTimers();
    toastStore.show("同步完成", "新增 1", "success");

    expect(toastStore.current).toEqual({
      title: "同步完成",
      description: "新增 1",
      variant: "success",
    });
    expect(toastStore.visible).toBe(true);

    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(toastStore.visible, "到点开始淡出").toBe(false);
    expect(toastStore.current, "淡出期间还留着（要做动画）").not.toBeNull();

    vi.advanceTimersByTime(TOAST_FADE_MS);
    expect(toastStore.current).toBeNull();
  });

  test("鼠标停在上面就先别消失，移开再接着计时", () => {
    vi.useFakeTimers();
    toastStore.show("已复制");

    toastStore.hold();
    vi.advanceTimersByTime(TOAST_DURATION_MS * 3);
    expect(toastStore.visible, "悬停期间不该消失").toBe(true);

    toastStore.release();
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(toastStore.visible).toBe(false);
  });

  test("连着弹两条：后一条顶掉前一条，而且重新计时", () => {
    vi.useFakeTimers();
    toastStore.show("第一条");
    vi.advanceTimersByTime(TOAST_DURATION_MS - 100);

    toastStore.show("第二条", undefined, "destructive");
    expect(toastStore.current?.title).toBe("第二条");
    expect(toastStore.current?.variant).toBe("destructive");

    // 按第一条的计时早该消失了，但它被顶掉时重新开始计时
    vi.advanceTimersByTime(200);
    expect(toastStore.visible, "第二条不该被第一条的计时带走").toBe(true);
  });

  test("dismiss 立刻收掉（测试隔离也靠它）", () => {
    toastStore.show("随便什么");
    toastStore.dismiss();
    expect(toastStore.current).toBeNull();
    expect(toastStore.visible).toBe(false);
  });

  test("默认变体是 default（不传第三个参数时）", () => {
    toastStore.show("标题");
    expect(toastStore.current?.variant).toBe("default");
    expect(toastStore.current?.description).toBeUndefined();
  });
});
