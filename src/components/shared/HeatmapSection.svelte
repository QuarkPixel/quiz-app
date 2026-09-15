<script module lang="ts">
    /**
     * 热力图的一个小方块。
     *
     * 定义在 `<script module>` 里，两个模式的包装组件才能 import 这个类型
     * （实例 script 的 export 是拿不到的）。
     */
    export interface HeatmapCell {
        id: string;
        /** 状态描述（**不要**自己带 id 前缀，无障碍标签由本组件统一拼） */
        status: string;
        /** 纯色格子用它（Tailwind 类，如 `bg-success`） */
        className?: string;
        /** 需要插值的格子用它（`background-color: …`） */
        style?: string;
    }
</script>

<script lang="ts">
    import { cn } from "$lib/utils";
    import IconAccessPoint from "@tabler/icons-svelte/icons/access-point";
    import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";

    /**
     * 热力图：折叠标题 + 小方块网格 + 轻量 tooltip。
     *
     * 刷题与记忆两个模式的热力图**只有「状态 → 颜色」的映射不同**，外壳（折叠、
     * 网格、悬浮提示的定位、无障碍标签）完全一样。以前是两份近 200 行的重复实现，
     * 连 aria-label 的拼法都漂了（一份拼 `${id}：${status}`，另一份的 status 里自带 id）。
     * 现在外壳只此一份，调用方只负责把题目算成 `cells`。
     */
    interface Props {
        /** 折叠条上的标题，如「答题热力图」/「卡片热力图」 */
        title: string;
        /**
         * 单元格数据。
         *
         * 传函数而不是数组，是为了保留原来的懒加载：收起时**不计算**颜色
         * （题库大时每个格子都要查一次进度，白白算一遍没有意义）。
         */
        cells: (expanded: boolean) => HeatmapCell[];
        onJump?: (id: string) => void;
    }

    let { title, cells, onJump }: Props = $props();

    let expanded = $state(false);

    const currentCells = $derived(cells(expanded));

    // ── 轻量 tooltip：自己算位置，不走浮层组件（在 Dialog 里会被层级 / 裁剪坑到）──
    let hoveredCellId = $state<string | null>(null);
    let tooltipX = $state(0);
    let tooltipY = $state(0);
    let anchorEl: HTMLElement | null = null;
    let sectionEl: HTMLElement | null = null;

    function updateTooltipPosition() {
        if (!anchorEl || !sectionEl) return;
        const elRect = anchorEl.getBoundingClientRect();
        const sectionRect = sectionEl.getBoundingClientRect();
        tooltipX = elRect.left - sectionRect.left + elRect.width / 2;
        tooltipY = elRect.top - sectionRect.top - 6;
    }

    function onCellEnter(cellId: string, e: MouseEvent) {
        hoveredCellId = cellId;
        anchorEl = e.currentTarget as HTMLElement;
        updateTooltipPosition();
    }

    function onCellLeave() {
        hoveredCellId = null;
        anchorEl = null;
    }
</script>

<div bind:this={sectionEl} class="relative flex flex-col gap-2">
    <button
        type="button"
        onclick={() => (expanded = !expanded)}
        aria-expanded={expanded}
        class="group -mx-3 flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-muted"
    >
        <IconAccessPoint
            size={16}
            stroke={1.75}
            class="text-muted-foreground shrink-0"
        />
        <span class="shrink-0 text-sm font-medium">{title}</span>
        <span class="dotted-leader text-muted-foreground/40 flex-1"></span>
        <IconChevronDown
            size={16}
            stroke={1.75}
            class={cn(
                "text-muted-foreground shrink-0 transition-transform duration-200",
                expanded && "rotate-180",
            )}
        />
    </button>

    <div class="heatmap-collapsible" class:expanded>
        <div class="heatmap-collapsible-inner">
            <div
                class="max-h-56 overflow-y-auto rounded-md border bg-muted/20 p-3"
                onscroll={updateTooltipPosition}
            >
                {#if expanded}
                    <div class="heatmap-grid grid">
                        {#each currentCells as cell (cell.id)}
                            <button
                                type="button"
                                class="block size-4 border-0 p-0.5 group"
                                aria-label="{cell.id}：{cell.status}"
                                onclick={() => onJump?.(cell.id)}
                                onmouseenter={(e) => onCellEnter(cell.id, e)}
                                onmouseleave={onCellLeave}
                            >
                                <div
                                    style={cell.style}
                                    class={cn(
                                        "size-full bg-transparent rounded-[3px] transition-transform group-hover:scale-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
                                        cell.className,
                                    )}
                                ></div>
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>

    {#if hoveredCellId}
        <div
            class="heatmap-tooltip pointer-events-none absolute z-(--z-tooltip) -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-3 py-1.5 text-xs text-background"
            style="left: {tooltipX}px; top: {tooltipY}px;"
        >
            <span class="font-mono">{hoveredCellId}</span>
        </div>
    {/if}
</div>
