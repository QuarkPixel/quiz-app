<script lang="ts">
    import { cn } from "$lib/utils";
    import { useMemorySession } from "@/features/memory/context";
    import { reviewProgress } from "@/features/memory/algorithm";
    import type { MemoryProgress } from "@/types";
    import IconAccessPoint from "@tabler/icons-svelte/icons/access-point";
    import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";

    /**
     * 记忆模式的答题热力图。逻辑与刷题模式的 `HeatmapSection.svelte` 一一对应，
     * 只是「状态 → 颜色」的映射换成记忆模式那一套：
     *
     *   未学习 / 学习中 → 灰色（`bg-foreground/15`）
     *   复习中         → 橙色 → 绿色按复习进度插值（复习到第几级 / 掌握阈值）
     *   已掌握         → 绿色（`bg-success`）
     */
    interface Props {
        onJump?: (id: string) => void;
    }

    let { onJump }: Props = $props();

    const session = useMemorySession();

    let expanded = $state(false);

    const threshold = $derived(Math.max(1, session.memorySettings.graduateLevel));

    /**
     * 复习中的橙色 → 绿色插值。进度直接用算法的 `reviewProgress`
     * （`(level - 1) / threshold`），别在 UI 里再抄一份公式。
     */
    function reviewColor(item: MemoryProgress): string {
        const t = reviewProgress(item, threshold);
        return `color-mix(in oklab, var(--success) ${(t * 100).toFixed(1)}%, var(--warning))`;
    }

    function describe(item: MemoryProgress | undefined, id: string): string {
        if (!item) return `${id}：未学习`;
        if (item.state === "mastered") return `${id}：已掌握`;
        if (item.state === "learning") return `${id}：学习中`;
        return `${id}：复习中 ${item.level - 1}/${threshold}`;
    }

    interface CellInfo {
        id: string;
        status: string;
        className: string;
        style: string;
    }

    // 懒加载：收起时不计算 cells
    const cells = $derived.by((): CellInfo[] => {
        if (!expanded) return [];
        return session.questions.map((question) => {
            const item = session.progress[question.id];

            if (!item || item.state === "learning") {
                // 未学习与学习中共用灰色
                return {
                    id: question.id,
                    status: describe(item, question.id),
                    className: "bg-foreground/15",
                    style: "",
                };
            }

            if (item.state === "mastered") {
                return {
                    id: question.id,
                    status: describe(item, question.id),
                    className: "bg-success",
                    style: "",
                };
            }

            return {
                id: question.id,
                status: describe(item, question.id),
                className: "",
                style: `background-color: ${reviewColor(item)}`,
            };
        });
    });

    // ── 共享轻量 tooltip ──

    let hoveredCellId = $state<string | null>(null);
    let tooltipX = $state(0);
    let tooltipY = $state(0);
    let anchorEl: HTMLElement | null = null;
    let sectionEl: HTMLElement | null = null;

    const hoveredCell = $derived(
        hoveredCellId != null
            ? (cells.find((c) => c.id === hoveredCellId) ?? null)
            : null,
    );

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

    function onGridScroll() {
        updateTooltipPosition();
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
        <span class="shrink-0 text-sm font-medium">卡片热力图</span>
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
                onscroll={onGridScroll}
            >
                {#if expanded}
                    <div class="heatmap-grid grid">
                        {#each cells as cell (cell.id)}
                            <button
                                type="button"
                                class="block size-4 border-0 p-0.5 group"
                                aria-label={cell.status}
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

    {#if hoveredCell}
        <div
            class="heatmap-tooltip pointer-events-none absolute z-[80] -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-3 py-1.5 text-xs text-background"
            style="left: {tooltipX}px; top: {tooltipY}px;"
        >
            <span class="font-mono">{hoveredCell.id}</span>
        </div>
    {/if}
</div>
