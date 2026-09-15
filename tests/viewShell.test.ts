import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ViewShellHarness from "./ViewShellHarness.svelte";
import { SCROLL_TOP_THRESHOLD_PX } from "../src/config";

/**
 * 答题视图的公共外壳（滚动容器 + 底部渐变遮罩 + 底部工具栏）。
 *
 * 这些行为以前在两个视图里各写一遍，于是记忆模式那边**整块漏掉**：
 * 没有底部遮罩、可滚动时 footer 不让位、鼠标压在工具栏上滚不动。
 * 现在只有这一份实现，所以这里逐条把它们钉住：
 *
 *   1. 遮罩只在内容可滚动时点亮（不可滚动时不能挡住内容）；
 *   2. 可滚动时 footer 要多让出一点上边距（否则渐变压住最后一行）；
 *   3. 工具栏上的滚轮事件要转发给滚动容器；
 *   4. 「回到顶部」按钮只有刷题模式要（`scrollTopButton`），且滚过阈值才出现；
 *   5. `data-main-scroll-viewport` 必须打在执行滚动的那个元素上
 *      （页头的滚轮转发靠它选元素，曾经全项目没人写这个属性，转发表面上是死的）。
 */

const mounted: Array<() => void> = [];

/**
 * 只要让「内容比容器高」成立就够了：happy-dom 没有真实布局，
 * `scrollHeight` / `clientHeight` 恒为 0。这里临时把原型上的取值改掉，
 * 外壳里的 ResizeObserver 在挂载时就会读到「可滚动」。
 */
function stubMetrics({ scrollHeight = 0, clientHeight = 0, scrollTop = 0 } = {}) {
  // 这两个取值挂在不同的原型上（happy-dom 的实现细节）：
  // scrollHeight / scrollTop 在 Element.prototype，clientHeight 在 HTMLElement.prototype
  const spies = [
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(
      scrollHeight,
    ),
    vi.spyOn(Element.prototype, "scrollTop", "get").mockReturnValue(scrollTop),
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
      clientHeight,
    ),
  ];
  return () => spies.forEach((spy) => spy.mockRestore());
}

function render(scrollTopButton = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(ViewShellHarness, { target: host, props: { scrollTopButton } });
  flushSync();
  mounted.push(() => {
    void unmount(app);
    host.remove();
  });

  const viewport = host.querySelector<HTMLElement>("[data-main-scroll-viewport]");
  if (!viewport) throw new Error("找不到滚动容器");
  return { host, viewport };
}

function mask(host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>('[data-slot="view-bottom-mask"]');
  if (!el) throw new Error("找不到底部遮罩");
  return el;
}

function footer(host: HTMLElement): HTMLElement {
  const el = host.querySelector("footer");
  if (!el) throw new Error("找不到底部工具栏");
  return el;
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("滚动容器", () => {
  it("执行滚动的那个元素带着 data-main-scroll-viewport（页头滚轮转发认它）", () => {
    const restore = stubMetrics();
    try {
      const { viewport } = render();

      expect(viewport.getAttribute("data-main-scroll-viewport")).toBe("true");
    } finally {
      restore();
    }
  });

  it("不可滚动时 data-shell-scrollable=false（顶部 backdrop 不该亮）", () => {
    const restore = stubMetrics({ scrollHeight: 400, clientHeight: 400 });
    try {
      const { host } = render();

      const shell = host.querySelector('[data-shell-scrollable]');
      expect(shell!.getAttribute("data-shell-scrollable")).toBe("false");
    } finally {
      restore();
    }
  });
});

describe("底部遮罩与工具栏让位", () => {
  it("不可滚动时遮罩是透明的，footer 用小的上边距", () => {
    const restore = stubMetrics({ scrollHeight: 400, clientHeight: 400 });
    try {
      const { host } = render();

      expect(mask(host).className).toContain("opacity-0");
      expect(mask(host).className).not.toContain("opacity-100");
      expect(footer(host).className).toContain("pt-4");
    } finally {
      restore();
    }
  });

  it("可滚动时遮罩点亮成背景渐变，footer 让位（pt-6）", () => {
    const restore = stubMetrics({ scrollHeight: 1000, clientHeight: 400 });
    try {
      const { host } = render();

      expect(mask(host).className).toContain("opacity-100");
      expect(mask(host).className, "遮罩本体应当是「从背景色渐隐」").toContain(
        "bg-gradient-to-t",
      );
      expect(footer(host).className).toContain("pt-6");
      expect(
        host.querySelector('[data-shell-scrollable]')!.getAttribute(
          "data-shell-scrollable",
        ),
      ).toBe("true");
    } finally {
      restore();
    }
  });

  it("鼠标压在工具栏上滚动时，事件被转发给滚动容器", () => {
    const restore = stubMetrics({ scrollHeight: 1000, clientHeight: 400 });
    try {
      const { host, viewport } = render();
      const scrollBy = vi.fn();
      viewport.scrollBy = scrollBy;

      const wheel = new WheelEvent("wheel", {
        deltaY: 120,
        bubbles: true,
        cancelable: true,
      });
      footer(host).dispatchEvent(wheel);

      expect(scrollBy).toHaveBeenCalledWith(
        expect.objectContaining({ top: 120 }),
      );
      expect(wheel.defaultPrevented, "转发之后要吃掉这次滚动").toBe(true);
    } finally {
      restore();
    }
  });
});

describe("回到顶部按钮", () => {
  it("默认不渲染（记忆模式不要它）", () => {
    const restore = stubMetrics({ scrollHeight: 1000, clientHeight: 400 });
    try {
      const { host } = render(false);

      expect(host.querySelector('button[aria-label="回到顶部"]')).toBeNull();
    } finally {
      restore();
    }
  });

  it("开启后：滚过阈值才出现，点它滚回顶部", () => {
    let scrollTop = 0;
    const spies = [
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(2000),
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
        400,
      ),
      vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(
        () => scrollTop,
      ),
    ];
    try {
      const { host, viewport } = render(true);
      const button = () =>
        host.querySelector<HTMLElement>('button[aria-label="回到顶部"]')!;

      expect(button(), "开关打开时按钮应当在 DOM 里").not.toBeNull();
      expect(button().className, "还没滚过阈值，先藏着").toContain("opacity-0");

      // 滚过阈值：外壳靠滚动容器上的 scroll 事件更新自己的状态
      scrollTop = SCROLL_TOP_THRESHOLD_PX + 100;
      viewport.dispatchEvent(new Event("scroll"));
      flushSync();
      expect(button().className).toContain("opacity-100");

      const scrollTo = vi.fn();
      viewport.scrollTo = scrollTo;
      button().click();
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 0, behavior: "smooth" }),
      );
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});
