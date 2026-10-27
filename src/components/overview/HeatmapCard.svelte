<script lang="ts">
    import { untrack } from "svelte";
    import { cn } from "$lib/utils";
    import {
        OVERVIEW_CELL_ROWS,
        OVERVIEW_CELL_STRIDE,
        OVERVIEW_HEATMAP_BUFFER_COLUMNS,
        OVERVIEW_HEATMAP_HEIGHT,
    } from "@/config/overview";
    import type { HeatmapCell } from "@/features/overview/types";
    import { useOverviewRail } from "./railContext";
    import OverviewCard from "./OverviewCard.svelte";

    /**
     * 卡片内的热力图。
     *
     * 卡片壳（底色、标题行、sticky 行为）来自 `OverviewCard`——与三张统计卡
     * 共用同一份；这个文件只管格子。
     *
     * 与旧版的三个区别：
     *   1. **不再折叠**：标题固定在卡片顶部，格子占满剩下的空间（省一次点击）
     *   2. **列优先**：高度固定 → 每列 `OVERVIEW_CELL_ROWS` 格，列数随题目数增长，
     *      于是宽度不固定——正好交给外面那条横向 rail 去滚
     *   3. **按列虚拟化**：只渲染视口附近的列（左右各多 3 列缓冲）。题库上千时
     *      DOM 里也只有几十列，滚动不会卡
     *
     * 首帧只画占位方块，颜色在下一帧之后才算——打开总览时先看见窗口，热力图
     * 随后「填色」。占位与真格子数量一致，所以宽度不会跳。
     *
     * 标题是 sticky 的：这张卡通常比视口宽，滚到右半边时标题仍贴在视口左边
     * （见 `OverviewCard` 里关于 sticky 两个前提的注释）。
     */
    interface Props {
        title: string;
        /** 格子总数。**必须先于 `cells` 知道**，占位宽度靠它算 */
        count: number;
        /**
         * 格子数据。传函数而不是数组：打开窗口的第一帧不需要为每道题查一遍进度，
         * 等 `ready` 之后才算（见下面的 `ready`）。
         */
        cells: () => HeatmapCell[];
        onJump?: (id: string) => void;
    }

    let { title, count, cells, onJump }: Props = $props();

    const rail = useOverviewRail();

    /** happy-dom / 极端窄容器下 clientWidth 会是 0，给一个兜底宽度 */
    const FALLBACK_VIEWPORT = 640;

    const columns = $derived(Math.max(1, Math.ceil(count / OVERVIEW_CELL_ROWS)));
    /** 每列就是一个 `OVERVIEW_CELL_STRIDE` 宽的按钮（留白在按钮内部），列间没有额外间距 */
    const gridWidth = $derived(columns * OVERVIEW_CELL_STRIDE);

    /**
     * 是否已经过了首帧。打开窗口 → 先画占位 → 下一帧之后才开始算颜色。
     * 依赖 `requestAnimationFrame` 的两次嵌套（第一次是本次渲染，第二次是绘制完）。
     */
    let ready = $state(false);
    $effect(() => {
        let cancelled = false;
        let second = 0;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => {
                if (!cancelled) ready = true;
            });
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
        };
    });

    const allCells = $derived<HeatmapCell[]>(ready ? cells() : []);

    // ── 横向虚拟化 ───────────────────────────────────────────────────────
    let gridEl = $state<HTMLDivElement | null>(null);
    let firstColumn = $state(0);
    let lastColumn = $state(-1);

    /**
     * 视口里该渲染哪几列。
     *
     * 坐标直接取「格子在滚动容器视口里的 x」：`gridRect.left - railRect.left`，
     * 它已经把滚动量算进去了，不需要再自己减 `scrollLeft`。
     * 依赖里显式读 `rail.scrollLeft / viewportWidth`，是为了让滚动与尺寸变化触发重算。
     */
    $effect(() => {
        const total = columns;
        const grid = gridEl;
        const scrolled = rail ? rail.scrollLeft : 0;
        const viewportWidth = rail ? rail.viewportWidth : 0;
        if (!grid) return;

        // 没有 rail（组件单测 / 独立使用）：不虚拟化，全渲染
        if (!rail || !rail.el) {
            if (untrack(() => firstColumn) !== 0) firstColumn = 0;
            if (untrack(() => lastColumn) !== total - 1) {
                lastColumn = total - 1;
            }
            return;
        }
        void scrolled;

        const gridLeft =
            grid.getBoundingClientRect().left -
            rail.el.getBoundingClientRect().left;
        const width = viewportWidth || FALLBACK_VIEWPORT;
        const buffer = OVERVIEW_HEATMAP_BUFFER_COLUMNS * OVERVIEW_CELL_STRIDE;

        const first = Math.max(
            0,
            Math.floor((-gridLeft - buffer) / OVERVIEW_CELL_STRIDE),
        );
        const last = Math.min(
            total - 1,
            Math.ceil((width - gridLeft + buffer) / OVERVIEW_CELL_STRIDE),
        );

        if (untrack(() => firstColumn) !== first) firstColumn = first;
        if (untrack(() => lastColumn) !== last) lastColumn = last;
    });

    interface VisibleColumn {
        index: number;
        /** `null` = 还没算颜色（占位方块） */
        items: Array<HeatmapCell | null>;
    }

    const visibleColumns = $derived.by<VisibleColumn[]>(() => {
        const result: VisibleColumn[] = [];
        if (lastColumn < firstColumn) return result;

        for (let column = firstColumn; column <= lastColumn; column++) {
            const start = column * OVERVIEW_CELL_ROWS;
            const items: Array<HeatmapCell | null> = [];
            for (
                let row = 0;
                row < OVERVIEW_CELL_ROWS && start + row < count;
                row++
            ) {
                items.push(ready ? (allCells[start + row] ?? null) : null);
            }
            result.push({ index: column, items });
        }
        return result;
    });

    // ── 轻量 tooltip：自己算位置，不走浮层组件 ───────────────────────────
    /**
     * 悬停中的格子。坐标是**视口坐标**（`getBoundingClientRect`），不是相对卡片：
     * tooltip 会被挂到 `document.body` 上（见下面的 `portal`），只有视口坐标
     * 才和 `position: fixed` 对得上。
     */
    let hovered = $state<{
        cell: HeatmapCell;
        x: number;
        y: number;
    } | null>(null);

    function onCellEnter(cell: HeatmapCell, event: MouseEvent): void {
        const cellRect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        hovered = {
            cell,
            x: cellRect.left + cellRect.width / 2,
            y: cellRect.top - 6,
        };
    }

    function onCellLeave(): void {
        hovered = null;
    }

    /**
     * 把 tooltip 挪到 `body` 下。
     *
     * 卡片自己是 `overflow-hidden`，外面的 rail 又是 `overflow-x: auto`——
     * 只要留在原地，tooltip 一超出卡片边界就被裁掉（用户看到的就是「黑框只
     * 在卡片里出现半截」）。挂到 body 上、用 `position: fixed` 定位，两处裁剪
     * 都绕开了；`--z-tooltip` 保证它压在弹窗之上。
     */
    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                node.remove();
            },
        };
    }

    /** 横向滚动时旧坐标立刻失效，先收起，免得黑框停在原地 */
    $effect(() => {
        void rail?.scrollLeft;
        untrack(() => {
            if (hovered) hovered = null;
        });
    });

    /**
     * 格子的内联样式。
     *
     * 插值色写成自定义属性 `--cell-color`，再由 `bg-(--cell-color)` 取用，
     * 而不是直接拼 `background-color: color-mix(…)`：
     * `style` 属性会被样式解析器重新序列化，`color-mix()` 这种「太新」的值
     * 会被判成非法整条丢掉（happy-dom 就是这样，真浏览器里则取决于版本）。
     * 自定义属性的值不参与校验，怎么写都原样保留。
     */
    function cellStyle(cell: HeatmapCell): string {
        return cell.color ? `--cell-color: ${cell.color};` : "";
    }
</script>

<OverviewCard
    title={title}
    class="min-w-44 flex-none"
    contentClass="gap-2"
>
    <div
        bind:this={gridEl}
        data-slot="overview-heatmap-grid"
        class="relative shrink-0"
        style="width: {gridWidth}px; height: {OVERVIEW_HEATMAP_HEIGHT}px;"
    >
        {#each visibleColumns as column (column.index)}
            <div
                data-column={column.index}
                class="absolute top-0 flex flex-col"
                style="left: {column.index * OVERVIEW_CELL_STRIDE}px;"
            >
                {#each column.items as cell, row (row)}
                    {#if cell}
                        <!-- 按钮本体是 `OVERVIEW_CELL_STRIDE` 见方、四周 `p-0.5`，
                             彩色方块只是里面的 `size-full`。这样 hitbox 铺满整片格子，
                             鼠标落在两个方块之间也能命中（原来按钮只有方块那么大，
                             缝里是死区）。写法与改造前的 `HeatmapSection` 一致。 -->
                        <button
                            type="button"
                            class="group block border-0 p-0.5"
                            style="width: {OVERVIEW_CELL_STRIDE}px; height: {OVERVIEW_CELL_STRIDE}px;"
                            aria-label="{cell.id}：{cell.status}"
                            onclick={() => onJump?.(cell.id)}
                            onmouseenter={(e) => onCellEnter(cell, e)}
                            onmouseleave={onCellLeave}
                        >
                            <div
                                class={cn(
                                    "size-full bg-transparent rounded-[3px] transition-transform group-hover:scale-125",
                                    cell.className,
                                    cell.color && "bg-(--cell-color)",
                                )}
                                style={cellStyle(cell)}
                            ></div>
                        </button>
                    {:else}
                        <!-- 占位：颜色还没算出来，先撑住版面（数量与真格子一致）。
                             `bg-clip-content` + `p-0.5`：底色只画 12px 的内容区，
                             外面那圈留白不上色，视觉与真格子一致。 -->
                        <span
                            class="bg-foreground/8 block rounded-[3px] bg-clip-content p-0.5"
                            style="width: {OVERVIEW_CELL_STRIDE}px; height: {OVERVIEW_CELL_STRIDE}px;"
                        ></span>
                    {/if}
                {/each}
            </div>
        {/each}
    </div>
</OverviewCard>

<!-- tooltip 是卡片的**兄弟**而不是子节点，并且经 `portal` 挂到 body 上：
     留在卡片里会被 `overflow-hidden` 裁掉，留在 rail 里会被 `overflow-x: auto`
     裁掉。`fixed` + 视口坐标 + `--z-tooltip`，两处裁剪都绕开。 -->
{#if hovered}
    <div
        use:portal
        class="pointer-events-none fixed z-(--z-tooltip) -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-2.5 py-1 text-xs whitespace-nowrap text-background"
        style="left: {hovered.x}px; top: {hovered.y}px;"
    >
        <span class="font-mono">{hovered.cell.id}</span>
        <span class="text-background/60"> · {hovered.cell.status}</span>
    </div>
{/if}
