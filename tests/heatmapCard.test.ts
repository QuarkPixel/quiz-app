import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import HeatmapCard from "../src/components/overview/HeatmapCard.svelte";
import type { HeatmapCell } from "../src/features/overview/types";

/**
 * 卡片内的热力图。
 *
 * 守这几条：
 *   1. 首帧只画占位，颜色（`cells()`）延后一帧才算；占位与真格子是**同一批
 *      DOM**，颜色落下时不重建节点
 *   2. 一格一个 `div`（没有 `button`）
 *   3. 列优先：5 格一列（`OVERVIEW_CELL_ROWS`），第 6 格落在第二列
 *   4. 颜色：纯色走 Tailwind 类，插值色走调色板变量（`--heat-N`），去重后现算
 *   5. 命中按坐标算：网格上一点就落到对应格子，缝里也算；tooltip 钉在格子正上方
 *   6. 点格子把 id 交给 `onJump`
 *
 * 不挂 rail（没有 provider）时组件按「不虚拟化」渲染全部列——测试正好利用这一点，
 * 真实环境里的按列虚拟化由 `OverviewRail` 提供视口信息。
 *
 * happy-dom 里网格的 `getBoundingClientRect()` 全是 0，于是「派发事件的坐标」
 * 正好等于「格子内偏移」，命中测试可以直接按步长算坐标。
 */

const CELLS: HeatmapCell[] = [
    { id: "a", status: "已掌握", className: "bg-success" },
    { id: "b", status: "已掌握，曾答错", className: "bg-destructive" },
    {
        id: "c",
        status: "还需 2 次答对",
        color: "color-mix(in oklch, var(--success) 40%, var(--warning))",
    },
    { id: "d", status: "还没有刷到", className: "bg-foreground/15" },
    { id: "e", status: "复习中 2/7", className: "bg-success" },
    { id: "f", status: "复习中 5/7", className: "bg-success" },
    { id: "g", status: "还没有刷到", className: "bg-foreground/15" },
];

const STRIDE = 16;

interface Mounted {
    host: HTMLElement;
    grid: HTMLElement;
    destroy: () => void;
}

const mounted: Mounted[] = [];

function mountCard(
    options: {
        cells?: () => HeatmapCell[];
        count?: number;
        onJump?: (id: string) => void;
    } = {},
): Mounted {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const app = mount(HeatmapCard, {
        target: host,
        props: {
            title: "答题热力图",
            count: options.count ?? CELLS.length,
            cells: options.cells ?? (() => CELLS),
            onJump: options.onJump,
        },
    });
    flushSync();

    const grid = host.querySelector<HTMLElement>(
        '[data-slot="overview-heatmap-grid"]',
    );
    if (!grid) throw new Error("找不到热力图网格");

    const view: Mounted = {
        host,
        grid,
        destroy: () => {
            void unmount(app);
            host.remove();
        },
    };
    mounted.push(view);
    return view;
}

/** 渲染出来的格子：每列一个 `[data-column]`，格子是它的直接子节点 */
function squares(grid: HTMLElement): HTMLElement[] {
    return [...grid.querySelectorAll<HTMLElement>("[data-column] > div")];
}

function isPlaceholder(el: HTMLElement): boolean {
    return el.className.includes("bg-foreground/8");
}

/** 等到「占位 → 上色」这一步完成 */
async function waitForCells(grid: HTMLElement, count: number): Promise<void> {
    await vi.waitFor(() => {
        const list = squares(grid);
        expect(list, "格子没有在下一帧之后渲染出来").toHaveLength(count);
        expect(
            list.some(isPlaceholder),
            "颜色落下来了，占位灰应该换掉",
        ).toBe(false);
    });
}

/** 在网格内 `(x, y)` 处派发一次指针移动（坐标即格子内偏移） */
function pointerAt(
    grid: HTMLElement,
    x: number,
    y: number,
    pointerType = "mouse",
): void {
    const event = new MouseEvent("pointermove", {
        clientX: x,
        clientY: y,
        bubbles: true,
    });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    grid.dispatchEvent(event);
    flushSync();
}

function clickAt(grid: HTMLElement, x: number, y: number): void {
    grid.dispatchEvent(
        new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }),
    );
    flushSync();
}

function hoverBox(grid: HTMLElement): HTMLElement | null {
    return grid.querySelector<HTMLElement>(
        '[data-slot="overview-heatmap-hover"]',
    );
}

function tooltip(): HTMLElement | null {
    return document.querySelector<HTMLElement>(
        '[data-slot="overview-heatmap-tooltip"]',
    );
}

afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.destroy();
    document.body.innerHTML = "";
});

describe("渐进渲染", () => {
    it("首帧是占位方块，不算颜色；下一帧之后就地变成真格子（不重建节点）", async () => {
        const cells = vi.fn(() => CELLS);
        const view = mountCard({ cells });

        const placeholders = squares(view.grid);
        expect(
            placeholders,
            "占位方块要撑住版面（数量与真格子一致）",
        ).toHaveLength(CELLS.length);
        expect(
            placeholders.every(isPlaceholder),
            "占位方块应该是灰的",
        ).toBe(true);
        expect(cells, "首帧不该为每道题查一遍进度").not.toHaveBeenCalled();

        await waitForCells(view.grid, CELLS.length);
        expect(cells).toHaveBeenCalled();

        const after = squares(view.grid);
        expect(
            after.every((el, index) => el === placeholders[index]),
            "颜色落下时不该拆掉占位、重建一批新节点",
        ).toBe(true);
    });

    it("标题固定在卡片顶部", () => {
        const view = mountCard();
        expect(view.host.textContent).toContain("答题热力图");
    });
});

describe("一格一个最简 div", () => {
    it("没有 button：300 个 Tab 停靠点是以前最大的毛病", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        expect(view.grid.querySelectorAll("button")).toHaveLength(0);
        // 每个格子里不再套第二层：方块自己就是那个 div
        for (const el of squares(view.grid)) {
            expect(el.children).toHaveLength(0);
        }
    });
});

describe("列优先排列", () => {
    it("5 格一列：第 6 格在第二列（而不是第二行）", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        const columns = [...view.grid.querySelectorAll("[data-column]")];
        expect(columns).toHaveLength(2);
        expect(columns[0].children).toHaveLength(5);
        expect(columns[1].children).toHaveLength(2);
    });

    it("列数由 count 决定（宽度不固定，交给横向 rail 去滚）", async () => {
        const view = mountCard({ count: 11 });
        // 11 个 → 3 列（5 + 5 + 1），即使颜色还没算出来
        await vi.waitFor(() =>
            expect(view.grid.querySelectorAll("[data-column]")).toHaveLength(3),
        );
        const columns = [...view.grid.querySelectorAll("[data-column]")];
        expect(columns[2].children).toHaveLength(1);
    });
});

describe("颜色与调色板", () => {
    it("纯色格子走 class，插值格子走调色板变量", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        const [a, , c, d] = squares(view.grid);
        expect(a.className).toContain("bg-success");
        expect(d.className).toContain("bg-foreground/15");

        // 插值色：网格上声明一次 `--heat-N`，格子上只写一个 `var(...)` 引用
        expect(view.grid.getAttribute("style")).toContain("--heat-1:");
        expect(view.grid.getAttribute("style")).toContain("color-mix");
        expect(c.getAttribute("style")).toContain(
            "background-color: var(--heat-1)",
        );
    });

    it("调色板按数据现算：同色只声明一次，档位多少由数据决定", async () => {
        const same: HeatmapCell[] = [
            { id: "x", status: "s", color: "color-mix(in oklab, red, blue)" },
            { id: "y", status: "s", color: "color-mix(in oklab, red, blue)" },
            { id: "z", status: "s", color: "color-mix(in oklab, red, green)" },
        ];
        const view = mountCard({ cells: () => same, count: same.length });
        await waitForCells(view.grid, same.length);

        const style = view.grid.getAttribute("style") ?? "";
        expect(style).toContain("--heat-1:");
        expect(style).toContain("--heat-2:");
        expect(style, "同一种颜色不该占两个变量").not.toContain("--heat-3:");
    });

    it("档位数不写死：12 种颜色就有 12 个变量", async () => {
        const many: HeatmapCell[] = Array.from({ length: 12 }, (_, i) => ({
            id: `q${i}`,
            status: "s",
            color: `color-mix(in oklab, red ${i * 8}%, blue)`,
        }));
        const view = mountCard({ cells: () => many, count: many.length });
        await waitForCells(view.grid, many.length);

        expect(view.grid.getAttribute("style")).toContain("--heat-12:");
    });
});

describe("命中与 tooltip", () => {
    it("缝里也能命中：坐标落在步长的留白上，照样是那一格", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        // (16, 16) = 第二列第二格的左上角，正在那 2px 留白里
        pointerAt(view.grid, STRIDE, STRIDE);

        const box = hoverBox(view.grid);
        expect(box, "留白处也该高亮").not.toBeNull();
        expect(box?.getAttribute("style")).toContain("left: 16px");
        expect(box?.getAttribute("style")).toContain("top: 16px");
        expect(tooltip()?.textContent).toContain("g");
    });

    it("tooltip 钉在格子正上方：鼠标在格子里晃，它不动", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        pointerAt(view.grid, STRIDE + 2, STRIDE + 2);
        const before = tooltip()?.getAttribute("style");

        // 同一格内再挪几下：位置必须一模一样（不是跟着鼠标跑）
        pointerAt(view.grid, STRIDE + 10, STRIDE + 12);
        pointerAt(view.grid, STRIDE + 14, STRIDE + 14);
        expect(tooltip()?.getAttribute("style")).toBe(before);
        // 第二列第二格：格子中心 x = 16 + 8，顶部再上移 6
        expect(before).toContain("left: 24px");
        expect(before).toContain("top: 10px");
    });

    it("触摸不触发 hover", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        pointerAt(view.grid, 0, 0, "touch");
        expect(hoverBox(view.grid)).toBeNull();
        expect(tooltip()).toBeNull();
    });
});

describe("点击跳转", () => {
    it("点格子把 id 交给 onJump", async () => {
        const onJump = vi.fn();
        const view = mountCard({ onJump });
        await waitForCells(view.grid, CELLS.length);

        // 第一列第五格 = e
        clickAt(view.grid, 8, STRIDE * 4 + 8);

        expect(onJump).toHaveBeenCalledTimes(1);
        expect(onJump).toHaveBeenCalledWith("e");
    });

    it("不传 onJump 时点击不抛错", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        expect(() => clickAt(view.grid, 8, 8)).not.toThrow();
    });
});
