import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import HeatmapCard from "../src/components/overview/HeatmapCard.svelte";
import type { HeatmapCell } from "../src/features/overview/types";

/**
 * 卡片内的热力图。
 *
 * 守四条：
 *   1. 首帧只画占位，颜色（`cells()`）延后一帧才算——打开总览先看见窗口
 *   2. 列优先：5 格一列（`OVERVIEW_CELL_ROWS`），第 6 格落在第二列
 *   3. 无障碍标签是 `id：状态`，状态里不带 id
 *   4. 点格子把 id 交给 `onJump`
 *
 * 不挂 rail（没有 provider）时组件按「不虚拟化」渲染全部列——测试正好利用这一点，
 * 真实环境里的按列虚拟化由 `OverviewRail` 提供视口信息。
 */

const CELLS: HeatmapCell[] = [
    { id: "a", status: "已掌握", className: "bg-success" },
    { id: "b", status: "已掌握，曾答错", className: "bg-destructive" },
    {
        id: "c",
        status: "还需 2 次答对",
        color: "color-mix(in oklch, var(--success) 40%, var(--warning))",
    },    { id: "d", status: "还没有刷到", className: "bg-foreground/15" },
    { id: "e", status: "复习中 2/7", className: "bg-success" },
    { id: "f", status: "复习中 5/7", className: "bg-success" },
    { id: "g", status: "还没有刷到", className: "bg-foreground/15" },
];

interface Mounted {
    host: HTMLElement;
    grid: HTMLElement;
    destroy: () => void;
}

const mounted: Mounted[] = [];

function mountCard(options: {
    cells?: () => HeatmapCell[];
    count?: number;
    onJump?: (id: string) => void;
} = {}): Mounted {
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

function cellButtons(grid: HTMLElement): HTMLButtonElement[] {
    return [...grid.querySelectorAll<HTMLButtonElement>("button[aria-label]")];
}

/** 等到「占位 → 真格子」这一步完成 */
async function waitForCells(grid: HTMLElement, count: number): Promise<void> {
    await vi.waitFor(() =>
        expect(cellButtons(grid), "格子没有在下一帧之后渲染出来").toHaveLength(
            count,
        ),
    );
}

afterEach(() => {
    while (mounted.length > 0) mounted.pop()?.destroy();
    document.body.innerHTML = "";
});

describe("渐进渲染", () => {
    it("首帧只有占位方块，不算颜色；下一帧之后才变成真格子", async () => {
        const cells = vi.fn(() => CELLS);
        const view = mountCard({ cells });

        expect(cellButtons(view.grid), "首帧不该有可交互的格子").toHaveLength(0);
        expect(
            view.grid.querySelectorAll("span").length,
            "占位方块要撑住版面（数量与真格子一致）",
        ).toBe(CELLS.length);
        expect(cells, "首帧不该为每道题查一遍进度").not.toHaveBeenCalled();

        await waitForCells(view.grid, CELLS.length);
        expect(cells).toHaveBeenCalled();
        expect(view.grid.querySelectorAll("span")).toHaveLength(0);
    });

    it("标题固定在卡片顶部", () => {
        const view = mountCard();
        expect(view.host.textContent).toContain("答题热力图");
    });
});

describe("列优先排列", () => {
    it("5 格一列：第 6 格在第二列（而不是第二行）", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        const columns = [...view.grid.children] as HTMLElement[];
        expect(columns).toHaveLength(2);
        expect(columns[0].children).toHaveLength(5);
        expect(columns[1].children).toHaveLength(2);
        expect(
            columns[1].querySelector("button")?.getAttribute("aria-label"),
        ).toBe("f：复习中 5/7");
    });

    it("列数由 count 决定（宽度不固定，交给横向 rail 去滚）", async () => {
        const view = mountCard({ count: 11 });
        // 11 个 → 3 列（5 + 5 + 1），即使颜色还没算出来
        await vi.waitFor(() =>
            expect([...view.grid.children]).toHaveLength(3),
        );
        const columns = [...view.grid.children] as HTMLElement[];
        expect(columns[2].children).toHaveLength(1);
    });
});

describe("颜色与无障碍", () => {
    it("纯色格子走 class，插值格子走内联样式", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        // 按钮本体是铺满的 hitbox（`OVERVIEW_CELL_STRIDE` 见方），
        // 颜色画在里面那块 `size-full` 上
        const square = (id: string) =>
            view.grid.querySelector<HTMLElement>(
                `button[aria-label^="${id}："]`,
            )!.firstElementChild as HTMLElement;

        expect(square("a").classList.contains("bg-success")).toBe(true);
        expect(square("b").classList.contains("bg-destructive")).toBe(true);
        expect(square("d").classList.contains("bg-foreground/15")).toBe(true);
        // 插值色走 `--cell-color` + `bg-(--cell-color)`：颜色值原样留在 style 里，
        // 背景由类名取用（见 HeatmapCard 的 `cellStyle`）
        expect(square("c").getAttribute("style")).toContain(
            "color-mix(in oklch",
        );
        expect(square("c").classList.contains("bg-(--cell-color)")).toBe(true);
    });

    it("hitbox 铺满：按钮比彩色方块大一圈，方块之间没有死区", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        const button = view.grid.querySelector<HTMLElement>(
            'button[aria-label^="a："]',
        )!;
        // 16px 见方（12 + 四周 4 的留白），方块自己 `size-full` 画在里面
        expect(button.style.width).toBe("16px");
        expect(button.style.height).toBe("16px");
        expect(button.className).toContain("p-0.5");
        expect(button.firstElementChild?.className).toContain("size-full");
    });

    it("标签是 `id：状态`，id 只出现一次", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        const label = view.grid
            .querySelector('button[aria-label^="b："]')
            ?.getAttribute("aria-label");
        expect(label).toBe("b：已掌握，曾答错");
        expect(label?.match(/b/g)).toHaveLength(1);
    });
});

describe("点击跳转", () => {
    it("点格子把 id 交给 onJump", async () => {
        const onJump = vi.fn();
        const view = mountCard({ onJump });
        await waitForCells(view.grid, CELLS.length);

        view.grid.querySelector<HTMLElement>('button[aria-label^="e："]')!.click();
        flushSync();

        expect(onJump).toHaveBeenCalledTimes(1);
        expect(onJump).toHaveBeenCalledWith("e");
    });

    it("不传 onJump 时点击不抛错", async () => {
        const view = mountCard();
        await waitForCells(view.grid, CELLS.length);

        expect(() => {
            view.grid
                .querySelector<HTMLElement>('button[aria-label^="a："]')!
                .click();
            flushSync();
        }).not.toThrow();
    });
});
