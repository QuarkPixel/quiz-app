import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import ViewShellHarness from "./ViewShellHarness.svelte";
import { SCROLL_TOP_THRESHOLD_PX } from "../src/config";

/**
 * 答题视图的公共外壳。
 *
 * 这一版外壳的版面是「三块固定 + 一块滚动」：
 *
 *   header（题号行） / actions（操作条） / progress（进度条）都在滚动区**外面**，
 *   滚动区只有题干与作答。以前整块内容一起滚，题干一长，题号、提交按钮、进度条
 *   全被滚走。这里逐条钉住新的约定：
 *
 *   1. 只有 `[data-main-scroll-viewport]` 那个元素在滚，另外三块不在它里面；
 *   2. 两条裁切边遮罩只在「有内容被切掉」时点亮（贴顶不亮上边、贴底不亮下边）；
 *   3. 底部固定区上的滚轮要转发给滚动容器；
 *   4. 活动池那一列靠网格轨道宽度做 0 ↔ 280px，内容靠右钉住；
 *   5. `data-main-scroll-viewport` 必须打在执行滚动的元素上
 *      （页头的滚轮转发靠它选元素）。
 *
 * 窄版面的池子**不在这里**：它换成了底部抽屉（`PoolDrawer`），由 `QuizView` 挂，
 * 外壳在窄断点下根本不渲染 `aside`。这条也钉在这里——不然「两套摆法同时出现」
 * 这种错没人看得见。
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

/**
 * 让 `window.matchMedia` 一律回答「命中」或「不命中」。
 *
 * `ViewShell` 用 `svelte/reactivity` 的 `MediaQuery` 判宽窄，它内部就是
 * `window.matchMedia(query).matches` + `addEventListener("change")`，
 * 所以在这里换掉整个 `matchMedia` 就够了。**必须在 mount 之前调用**
 * （`MediaQuery` 在组件初始化时就建好了）。
 */
function stubMatchMedia(matches: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return () => {
    window.matchMedia = original;
  };
}

function render(
    props: { scrollTopButton?: boolean; asideOpen?: boolean; withAside?: boolean } = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const app = mount(ViewShellHarness, { target: host, props });
  flushSync();
  mounted.push(() => {
    void unmount(app);
    host.remove();
  });

  const viewport = host.querySelector<HTMLElement>("[data-main-scroll-viewport]");
  if (!viewport) throw new Error("找不到滚动容器");
  return { host, viewport };
}

function mask(host: HTMLElement, which: "top" | "bottom"): HTMLElement {
  const el = host.querySelector<HTMLElement>(
    `[data-slot="view-${which}-mask"]`,
  );
  if (!el) throw new Error(`找不到${which}遮罩`);
  return el;
}

function byTestId(host: HTMLElement, id: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`找不到 ${id}`);
  return el;
}

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("只有中间那块在滚", () => {
  it("滚动容器带着 data-main-scroll-viewport（页头滚轮转发认它）", () => {
    const restore = stubMetrics();
    try {
      const { viewport } = render();

      expect(viewport.getAttribute("data-main-scroll-viewport")).toBe("true");
    } finally {
      restore();
    }
  });

  it("题号行 / 操作条 / 进度条都在滚动区外面", () => {
    const restore = stubMetrics({ scrollHeight: 1000, clientHeight: 400 });
    try {
      const { host, viewport } = render();

      for (const id of ["header", "actions", "progress"]) {
        expect(viewport.contains(byTestId(host, id)), `${id} 不该在滚动区里`).toBe(
          false,
        );
      }
      // 题面本身当然在里面
      expect(viewport.contains(byTestId(host, "body"))).toBe(true);
    } finally {
      restore();
    }
  });
});

describe("裁切边遮罩", () => {
  it("不可滚动时两条遮罩都是透明的", () => {
    const restore = stubMetrics({ scrollHeight: 400, clientHeight: 400 });
    try {
      const { host } = render();

      expect(mask(host, "top").className).toContain("opacity-0");
      expect(mask(host, "bottom").className).toContain("opacity-0");
      expect(
        host.querySelector('[data-shell-scrollable]')!.getAttribute(
          "data-shell-scrollable",
        ),
      ).toBe("false");
    } finally {
      restore();
    }
  });

  it("可滚动且贴着顶：只亮下边那条", () => {
    const restore = stubMetrics({ scrollHeight: 1000, clientHeight: 400 });
    try {
      const { host } = render();

      expect(mask(host, "top").className).toContain("opacity-0");
      expect(mask(host, "bottom").className).toContain("opacity-100");
      expect(mask(host, "bottom").className).toContain("bg-gradient-to-t");
      expect(
        host.querySelector('[data-shell-scrollable]')!.getAttribute(
          "data-shell-scrollable",
        ),
      ).toBe("true");
    } finally {
      restore();
    }
  });

  it("滚到中间：两条都亮；滚到底：只剩上边那条", () => {
    let scrollTop = 300;
    const spies = [
      vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(1000),
      vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400),
      vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(
        () => scrollTop,
      ),
    ];
    try {
      const { host, viewport } = render();

      expect(mask(host, "top").className).toContain("opacity-100");
      expect(mask(host, "bottom").className).toContain("opacity-100");

      // 600 = scrollHeight - clientHeight，正好贴底
      scrollTop = 600;
      viewport.dispatchEvent(new Event("scroll"));
      flushSync();

      expect(mask(host, "top").className).toContain("opacity-100");
      expect(mask(host, "bottom").className).toContain("opacity-0");
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  });
});

describe("固定区上的滚轮", () => {
  it("鼠标压在操作条上滚动时，事件被转发给滚动容器", () => {
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
      byTestId(host, "actions").dispatchEvent(wheel);

      expect(scrollBy).toHaveBeenCalledWith(
        expect.objectContaining({ top: 120 }),
      );
      expect(wheel.defaultPrevented, "转发之后要吃掉这次滚动").toBe(true);
    } finally {
      restore();
    }
  });
});

describe("活动池那一列", () => {
  it("收起时轨道宽 0px，展开时 280px", () => {
    const restore = stubMetrics();
    try {
      const { host } = render({ asideOpen: false });
      const grid = host.querySelector<HTMLElement>(".session-grid")!;

      expect(grid.style.gridTemplateColumns).toContain("0px");
      expect(byTestId(host, "aside")).toBeTruthy();

      void unmount;
    } finally {
      restore();
    }
  });

  it("展开态下轨道是 280px（内容靠右钉住，从窗口右缘推进来）", () => {
    const restore = stubMetrics();
    try {
      const { host } = render({ asideOpen: true });
      const grid = host.querySelector<HTMLElement>(".session-grid")!;

      expect(grid.style.gridTemplateColumns).toContain("280px");
    } finally {
      restore();
    }
  });

  it("没有池子时只有一列（记忆模式）", () => {
    const restore = stubMetrics();
    try {
      const { host } = render({ withAside: false });
      const grid = host.querySelector<HTMLElement>(".session-grid")!;

      expect(grid.style.gridTemplateColumns).toBe("minmax(0, 42rem)");
      expect(host.querySelector('[data-testid="aside"]')).toBeNull();
    } finally {
      restore();
    }
  });

  it("窄版面：整个不渲染池子（改由底部抽屉承载）", () => {
    const restoreMetrics = stubMetrics();
    const restoreMatchMedia = stubMatchMedia(true);
    try {
      const { host } = render({ asideOpen: true });

      expect(host.querySelector('[data-testid="aside"]')).toBeNull();
      // 轨道回到单列，不会被那个「0px 的第二列」占着
      expect(
        host.querySelector<HTMLElement>(".session-grid")!.style
          .gridTemplateColumns,
      ).toBe("minmax(0, 42rem)");
    } finally {
      restoreMetrics();
      restoreMatchMedia();
    }
  });
});

describe("回到顶部按钮", () => {
  it("默认不渲染（记忆模式不要它）", () => {
    const restore = stubMetrics({ scrollHeight: 1000, clientHeight: 400 });
    try {
      const { host } = render({ scrollTopButton: false });

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
      const { host, viewport } = render({ scrollTopButton: true });
      const button = () =>
        host.querySelector<HTMLElement>('button[aria-label="回到顶部"]')!;

      expect(button(), "开关打开时按钮应当在 DOM 里").not.toBeNull();
      expect(button().className, "还没滚过阈值，先藏着").toContain("opacity-0");

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
