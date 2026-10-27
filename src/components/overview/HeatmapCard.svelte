<script lang="ts">
    import { untrack } from "svelte";
    import {
        OVERVIEW_CELL_GAP,
        OVERVIEW_CELL_ROWS,
        OVERVIEW_CELL_SIZE,
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
     * 几条定下来的做法：
     *
     *   1. **列优先**：高度固定 → 每列 `OVERVIEW_CELL_ROWS` 格，列数随题量增长，
     *      于是宽度不固定——正好交给外面那条横向 rail 去滚
     *   2. **按列虚拟化**：只渲染视口附近的列（左右各多 3 列缓冲）。题库上千时
     *      DOM 里也只有几十列，滚动不会卡
     *   3. **一格一个最简 `div`**：没有 `button`、没有内外两层、没有 `cn()`。
     *      以前每格是 `<button>` 套一个 `<div>`：① 300 个格子就是 300 个 Tab
     *      停靠点，键盘用户穿不过去；② 一个 `button` 带一整套 UA 样式与焦点环，
     *      纯当色块用太重。现在每格只有一个 `div`（一个 class + 一条 style）
     *   4. **命中靠坐标，不靠节点**：`pointermove` / `click` 挂在网格上，用
     *      `floor(x / stride)` 算格子。事件从 300 个降到 1 个，而且**那 4px 缝
     *      也是活的**——鼠标落在两个方块中间照样命中最近的那格
     *   5. **调色板变量化**：颜色值去重后挂成网格上的 `--heat-1..N`，格子只写
     *      `background-color: var(--heat-k)`。去重是**每次从数据现算**的，
     *      不假设「只有 1..7 档」——所有档位设置用户都能改，改完立刻生效
     *   6. **hover 只有一块高亮元素**：格子自己不带 `transition` / `hover:`
     *      规则，鼠标进到哪一格就把这一块挪过去（`animate-heat-pop` 弹一下）。
     *      1 个节点跑动画，而不是 300 个节点各挂一条 transition
     *
     * 首帧只画占位灰块，颜色在下一帧之后才算——打开窗口先看见窗口，热力图
     * 随后「填色」。占位与真格子是同一批节点，只换 class / style，不重建。
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
    /** 每列就是一个 `OVERVIEW_CELL_STRIDE` 宽的格子（留白是格子的外边距），列间没有额外间距 */
    const gridWidth = $derived(columns * OVERVIEW_CELL_STRIDE);

    /**
     * 一个格子的几何：`size` 见方 + 四周各半个 `gap` 的外边距（凑成 stride）。
     *
     * 走内联而不是 Tailwind 的 `size-3 m-0.5`：这几个数必须和 `config/overview.ts`
     * 一起变，写死在类名里就会悄悄对不上。
     */
    const CELL_STYLE =
        `width: ${OVERVIEW_CELL_SIZE}px; height: ${OVERVIEW_CELL_SIZE}px;` +
        ` margin: ${OVERVIEW_CELL_GAP / 2}px; border-radius: 3px;`;

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

    /**
     * 调色板：把 `cells()` 给出的颜色值去重，编号成 `--heat-1..N`。
     *
     * **每次从数据现算**，不假设档位数：记忆模式的档位来自 `graduateLevel`、
     * 刷题模式来自 `correctStreakToMaster` / `correctStreakAfterMistake`，
     * 用户随时能改，改完 `cells()` 返回新的颜色，这里就跟着换一组变量。
     *
     * 实际档位数很少（就是「还需答对几次」那几档），所以通常是 5~10 个变量；
     * 而格子上写的是 `var(--heat-3)` 这样二十来个字符的引用，不再是每格一条
     * 几十个字符的 `color-mix(...)`。
     */
    const palette = $derived.by(() => {
        const index = new Map<string, number>();
        const declarations: string[] = [];
        for (const cell of allCells) {
            const color = cell.color;
            if (!color || index.has(color)) continue;
            index.set(color, declarations.length + 1);
            declarations.push(`--heat-${declarations.length + 1}: ${color};`);
        }
        return { index, style: declarations.join(" ") };
    });

    /** 某个颜色对应的调色板变量 */
    function heatVar(color: string): string {
        return `var(--heat-${palette.index.get(color) ?? 1})`;
    }

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

    // ── 命中、hover 高亮、tooltip ─────────────────────────────────────────
    interface Hovered {
        column: number;
        row: number;
        cell: HeatmapCell;
        /**
         * tooltip 的视口坐标（`getBoundingClientRect` 口径），**格子正上方**
         * 而不是鼠标位置——鼠标在格子里怎么晃，黑框都钉在同一处。
         */
        x: number;
        y: number;
    }

    let hovered = $state<Hovered | null>(null);

    /**
     * 鼠标 / 点击落在哪一格。
     *
     * 整片网格是一个事件源，格子位置靠坐标反推：`floor(offset / stride)`。
     * 好处是缝里也能命中（每格的可视方块只有 12px，步长 16px），而且不用给
     * 300 个格子各挂一个监听器。越界（网格右侧、某列最后几格之外）返回 `null`。
     */
    function cellAt(event: MouseEvent): Hovered | null {
        const grid = gridEl;
        if (!grid) return null;

        const rect = grid.getBoundingClientRect();
        const column = Math.floor(
            (event.clientX - rect.left) / OVERVIEW_CELL_STRIDE,
        );
        const row = Math.floor(
            (event.clientY - rect.top) / OVERVIEW_CELL_STRIDE,
        );
        if (column < 0 || column >= columns) return null;
        if (row < 0 || row >= OVERVIEW_CELL_ROWS) return null;

        const index = column * OVERVIEW_CELL_ROWS + row;
        if (index >= count) return null;
        const cell = allCells[index];
        if (!cell) return null; // 颜色还没算出来（占位阶段）

        return {
            column,
            row,
            cell,
            x: rect.left + column * OVERVIEW_CELL_STRIDE + OVERVIEW_CELL_STRIDE / 2,
            y: rect.top + row * OVERVIEW_CELL_STRIDE - 6,
        };
    }

    function onPointerMove(event: PointerEvent): void {
        if (event.pointerType === "touch") return; // 触摸没有 hover，别在滑动时乱闪

        const next = cellAt(event);
        if (!next) {
            if (hovered) hovered = null;
            return;
        }
        // 还在同一格：不写 state，免得每个 pointermove 都触发一次渲染
        const current = hovered;
        if (current && current.column === next.column && current.row === next.row) {
            return;
        }
        hovered = next;
    }

    function onPointerLeave(): void {
        hovered = null;
    }

    function onClick(event: MouseEvent): void {
        const hit = cellAt(event);
        if (hit) onJump?.(hit.cell.id);
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
</script>

<OverviewCard
    title={title}
    class="min-w-44 flex-none"
    contentClass="gap-2"
>
    <!--
        整片网格是**一个**事件源：hover / 点击都按坐标算格子（见 `cellAt`）。
        `role="img"`：对读屏来说这是一张图，不是 300 个控件（以前每格一个
        `<button>`，Tab 要按 300 下才能穿过总览）。代价是格子没有键盘焦点，
        要跳题请用下面的列表——所以下面三个 a11y 提示在这里是**有意为之**。
    -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
        bind:this={gridEl}
        data-slot="overview-heatmap-grid"
        role="img"
        aria-label="{title}，共 {count} 个格子"
        class="relative shrink-0"
        style="width: {gridWidth}px; height: {OVERVIEW_HEATMAP_HEIGHT}px; {palette.style}"
        onpointermove={onPointerMove}
        onpointerleave={onPointerLeave}
        onclick={onClick}
    >
        {#each visibleColumns as column (column.index)}
            <!-- `contain: layout paint style`：每一列各自成一个布局 / 绘制单元，
                 视口外的列浏览器可以直接跳过（虚拟化已经减少了列数，这是第二道）。 -->
            <div
                data-column={column.index}
                class="absolute top-0 flex flex-col"
                style="left: {column.index * OVERVIEW_CELL_STRIDE}px; contain: layout paint style;"
            >
                {#each column.items as cell, row (row)}
                    <!-- 一格一个 div，没有内层方块：几何写在 `CELL_STYLE` 里，
                         颜色要么是 Tailwind 类（`bg-success` 之类），要么是调色板
                         变量（插值色）。占位阶段只是把颜色换成一层灰。 -->
                    <div
                        class={cell ? (cell.className ?? "") : "bg-foreground/8"}
                        style={cell && cell.color
                            ? `${CELL_STYLE} background-color: ${heatVar(cell.color)};`
                            : CELL_STYLE}
                    ></div>
                {/each}
            </div>
        {/each}

        <!--
            hover 高亮：**只有这一块**跑动画。`{#key}` 让它在换格子时重新挂载，
            于是每进一格都会重新弹一下（和以前每格自己 `hover:scale-125` 的观感
            一致），但 300 个格子身上不用再挂 `transition` 与 hover 规则。
            几何直接复用 `CELL_STYLE`（含那圈外边距），所以它和真格子一样大、
            落在同一个位置上——改常量时不用管这里第二份。
        -->
        {#if hovered}
            {#key `${hovered.column}:${hovered.row}`}
                <div
                    data-slot="overview-heatmap-hover"
                    class="animate-heat-pop pointer-events-none absolute {hovered
                        .cell.className ?? ''}"
                    style="left: {hovered.column *
                        OVERVIEW_CELL_STRIDE}px; top: {hovered.row *
                        OVERVIEW_CELL_STRIDE}px; {CELL_STYLE} {hovered.cell.color
                        ? `background-color: ${heatVar(hovered.cell.color)};`
                        : ''}"
                ></div>
            {/key}
        {/if}
    </div>
</OverviewCard>

<!-- tooltip 是卡片的**兄弟**而不是子节点，并且经 `portal` 挂到 body 上：
     留在卡片里会被 `overflow-hidden` 裁掉，留在 rail 里会被 `overflow-x: auto`
     裁掉。`fixed` + 视口坐标 + `--z-tooltip`，两处裁剪都绕开。 -->
{#if hovered}
    <div
        use:portal
        data-slot="overview-heatmap-tooltip"
        class="pointer-events-none fixed z-(--z-tooltip) -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-2.5 py-1 text-xs whitespace-nowrap text-background"
        style="left: {hovered.x}px; top: {hovered.y}px;"
    >
        <span class="font-mono">{hovered.cell.id}</span>
        <span class="text-background/60"> · {hovered.cell.status}</span>
    </div>
{/if}
