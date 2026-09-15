import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ProgressBarHarness from "./ProgressBarHarness.svelte";
import MemoryProgressBar from "../src/components/memory/MemoryProgressBar.svelte";
import { MASTERED_CELEBRATE_DURATION_MS } from "../src/config";

/**
 * 进度条。
 *
 * 这轮它被**泛化成了两个模式共用的一份**：刷题模式仍是「可点击聚焦 + 三段」
 * （`interactive` 默认）、记忆模式是把「本轮已完成 / 总数」映射成 stats 的
 * 非交互适配器。泛化最容易坏的三处都在这里守：
 *   - 不可交互时**不能**再渲染成按钮（记忆模式以前是 `<div role="progressbar">`，
 *     键盘 / 读屏的语义不能丢）；
 *   - 右侧数字的口径（刷题是「进度范围末端」，记忆是总数）不能串；
 *   - 中间文案被 `label` 覆盖时，百分比不该再插一脚。
 *
 * 注意：左右两个数字是 `<number-flow-svelte>`（自定义元素），happy-dom 不会升级它，
 * 所以 `textContent` 永远是空的——**不要**去断言数字文本，那只会得到一个假的绿灯。
 * 数值口径改由 `role="progressbar"` 的 `aria-valuenow / aria-valuemax` 来守。
 */

const mounted: Array<() => void> = [];

function mountWith(props: Record<string, unknown> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const instance = mount(ProgressBarHarness, { target: host, props });
  flushSync();
  mounted.push(() => {
    void unmount(instance);
    host.remove();
  });
  return { host, instance } as {
    host: HTMLElement;
    instance: { setMastered: (n: number) => void; setTotal: (n: number) => void };
  };
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("刷题形态（默认可交互）", () => {
  it("渲染成按钮，点一下请求切换聚焦态", () => {
    const onToggleFocus = vi.fn();
    const { host } = mountWith({
      stats: { mastered: 1, learning: 2, pending: 1, total: 4 },
      onToggleFocus,
    });

    const button = host.querySelector("button");
    expect(button, "默认可交互时应当是按钮").not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBe("聚焦学习中进度");

    button!.click();
    expect(onToggleFocus).toHaveBeenCalledOnce();
  });

  it("没有「学习中」的题时按钮不可点（没东西可聚焦）", () => {
    const { host } = mountWith({
      stats: { mastered: 3, learning: 0, pending: 0, total: 3 },
    });

    expect(host.querySelector("button")!.disabled).toBe(true);
  });

  it("聚焦态下按钮的语义翻转成「显示完整进度」", () => {
    const { host } = mountWith({
      stats: { mastered: 1, learning: 2, pending: 1, total: 4 },
      focused: true,
    });

    expect(host.querySelector("button")!.getAttribute("aria-label")).toBe(
      "显示完整进度",
    );
  });

  it("已掌握数增加时，已掌握那一段短暂进入庆祝态", () => {
    vi.useFakeTimers();
    const { host, instance } = mountWith({
      stats: { mastered: 1, learning: 2, pending: 1, total: 4 },
    });
    const segment = () => host.querySelector(".mastered-segment");

    expect(segment()!.classList.contains("celebrate")).toBe(false);

    instance.setMastered(2);
    flushSync();
    expect(segment()!.classList.contains("celebrate"), "涨了却没庆祝").toBe(
      true,
    );

    vi.advanceTimersByTime(MASTERED_CELEBRATE_DURATION_MS);
    flushSync();
    expect(segment()!.classList.contains("celebrate"), "庆祝没自己收掉").toBe(
      false,
    );
  });
});

describe("记忆形态（非交互）", () => {
  it("不渲染按钮，而是 role=progressbar，语义与数值都在", () => {
    const { host } = mountWith({
      stats: { mastered: 3, learning: 2, pending: 0, total: 5 },
      interactive: false,
      ariaLabel: "本轮学习进度",
      rightValue: 5,
    });

    expect(host.querySelector("button"), "不可交互时不该是按钮").toBeNull();
    const bar = host.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar!.getAttribute("aria-label")).toBe("本轮学习进度");
    expect(bar!.getAttribute("aria-valuenow")).toBe("3");
    expect(bar!.getAttribute("aria-valuemax")).toBe("5");
  });

  it("label 覆盖中间文案（不再显示百分比）", () => {
    const { host } = mountWith({
      stats: { mastered: 3, learning: 2, pending: 0, total: 5 },
      interactive: false,
      label: "3/5",
      rightValue: 5,
    });

    // 中间那格是普通 span，读得到；两端的数字是 number-flow，读不到（见文件头说明）
    const center = host.querySelectorAll(".tabular-nums > *")[1];
    expect(center.textContent?.trim()).toBe("3/5");

    const withoutLabel = mountWith({
      stats: { mastered: 3, learning: 2, pending: 0, total: 5 },
      interactive: false,
    });
    expect(
      withoutLabel.host.querySelectorAll(".tabular-nums > *")[1].className,
      "不传 label 时中间回到百分比的样式",
    ).toContain("font-mono");
  });
});

describe("记忆模式的本轮进度条（ProgressBar 的适配器）", () => {
  function renderMemory(props: Record<string, unknown>) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const instance = mount(MemoryProgressBar, { target: host, props });
    flushSync();
    mounted.push(() => {
      void unmount(instance);
      host.remove();
    });
    return host;
  }

  it("把「已完成 / 总数」映射成已掌握 / 剩余，并给出总数口径的右数字", () => {
    const host = renderMemory({ done: 3, total: 5, label: "3/5" });

    const bar = host.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");
    expect(host.textContent).toContain("3/5");
    // 已完成那一段用 success 色（与刷题模式同一套视觉）
    expect(host.querySelector(".mastered-segment")!.className).toContain(
      "bg-success",
    );
  });

  it("越界值被夹住：done 超过 total、负数都不该画出离谱的条", () => {
    const over = renderMemory({ done: 7, total: 5 });
    expect(
      over.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow"),
    ).toBe("5");

    const under = renderMemory({ done: -2, total: 5 });
    expect(
      under
        .querySelector('[role="progressbar"]')!
        .getAttribute("aria-valuenow"),
    ).toBe("0");
  });

  it("total 为 0 时不炸（还没开始一轮）", () => {
    const host = renderMemory({ done: 0, total: 0 });

    const bar = host.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuemax")).toBe("0");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(host.querySelector(".mastered-segment")).not.toBeNull();
  });
});
