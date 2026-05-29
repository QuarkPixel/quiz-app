<script lang="ts">
    import type { Stats } from "../types";
    import type { LearningSegment } from "../features/quiz";
    import {
        PROGRESS_SIDE_CAP_PERCENT,
        MASTERED_CELEBRATE_DURATION_MS,
    } from "../config";
    import { cn } from "$lib/utils";
    import NumberFlow, { continuous } from "@number-flow/svelte";

    interface Props {
        stats: Stats;
        learningSegments: LearningSegment[];
        focused: boolean;
        onToggleFocus: () => void;
    }

    let { stats, learningSegments, focused, onToggleFocus }: Props = $props();

    let masteredWidth = $derived(
        stats.total > 0 ? (stats.mastered / stats.total) * 100 : 0,
    );
    let learningWidth = $derived(
        stats.total > 0 ? (stats.learning / stats.total) * 100 : 0,
    );
    let pendingWidth = $derived(
        stats.total > 0 ? (stats.pending / stats.total) * 100 : 0,
    );

    let masteredDisplayWidth = $derived(
        focused
            ? Math.min(masteredWidth * 16, PROGRESS_SIDE_CAP_PERCENT)
            : masteredWidth,
    );
    let pendingDisplayWidth = $derived(
        focused
            ? Math.min(pendingWidth * 16, PROGRESS_SIDE_CAP_PERCENT)
            : pendingWidth,
    );
    let learningDisplayWidth = $derived(
        focused
            ? Math.max(0, 100 - masteredDisplayWidth - pendingDisplayWidth)
            : learningWidth,
    );

    // 已掌握数增加时短暂高亮 + 微微伸长（focused 状态下才伸长）
    // svelte-ignore state_referenced_locally
    let prevMastered = stats.mastered;
    let celebrating = $state(false);
    let celebrateTimer: ReturnType<typeof setTimeout> | null = null;

    $effect(() => {
        const m = stats.mastered;
        if (m > prevMastered) {
            celebrating = true;
            if (celebrateTimer) clearTimeout(celebrateTimer);
            celebrateTimer = setTimeout(() => {
                celebrating = false;
                celebrateTimer = null;
            }, MASTERED_CELEBRATE_DURATION_MS);
        }
        prevMastered = m;
    });
</script>

<button
    type="button"
    class={cn(
        "group focus-visible:outline-foreground block w-full h-[42px] cursor-pointer rounded-md py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-default",
        focused && "focused",
    )}
    onclick={onToggleFocus}
    disabled={stats.learning === 0}
    aria-label={focused ? "显示完整进度" : "聚焦学习中进度"}
>
    <div
        class="text-muted-foreground mb-1.5 flex justify-between text-xs tabular-nums"
    >
        <NumberFlow plugins={[continuous]} value={stats.mastered} />
        <NumberFlow
            plugins={[continuous]}
            value={focused ? stats.pending : stats.learning + stats.pending}
        />
    </div>
    <div
        class={cn(
            "progress-bar flex h-[3px] gap-1 transition-all duration-300",
            "[&_*]:transition-all [&_*]:duration-500 [&_*]:ease-spring",
            focused && "h-[7px]",
        )}
    >
        <div
            class={cn(
                "mastered-segment bg-success rounded-sm",
                focused && "opacity-55",
                celebrating && "celebrate",
            )}
            style="--w: {masteredDisplayWidth}%; --focused: {focused ? 1 : 0}"
        ></div>
        <div
            class="flex overflow-hidden rounded-sm"
            style="width: {learningDisplayWidth}%"
        >
            {#each learningSegments as seg}
                <div
                    style="width: {seg.widthPercent}%; background: {seg.color}"
                ></div>
            {/each}
        </div>
        <div
            class={cn("bg-foreground/15 rounded-sm", focused && "opacity-55")}
            style="width: {pendingDisplayWidth}%"
        ></div>
    </div>
</button>

<style>
    .group:not(:disabled):hover .progress-bar {
        height: 4px;
    }
    .group.focused:not(:disabled):hover .progress-bar {
        height: 8px;
    }

    .mastered-segment {
        --offset: 0;
        width: var(--w);
        transform-origin: left center;
        will-change: transform, filter;
    }
    .mastered-segment.celebrate {
        animation: mastered-celebrate 700ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes mastered-celebrate {
        0% {
            filter: brightness(1) saturate(1);
        }
        35% {
            /* 只有在聚焦状态下才变换长度 */
            width: calc(var(--w) + (5% * var(--focused)));
            filter: brightness(1.45) saturate(1.3);
        }
        100% {
            filter: brightness(1) saturate(1);
        }
    }
</style>
