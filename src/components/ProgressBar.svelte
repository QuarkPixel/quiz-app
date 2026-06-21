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

    let calcFocused = $derived(focused && stats.mastered != stats.total);

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
        calcFocused
            ? Math.min(masteredWidth * 16, PROGRESS_SIDE_CAP_PERCENT)
            : masteredWidth,
    );
    let pendingDisplayWidth = $derived(
        calcFocused
            ? Math.min(pendingWidth * 16, PROGRESS_SIDE_CAP_PERCENT)
            : pendingWidth,
    );
    let learningDisplayWidth = $derived(
        calcFocused
            ? Math.max(0, 100 - masteredDisplayWidth - pendingDisplayWidth)
            : learningWidth,
    );

    // 已掌握数增加时短暂高亮 + 微微伸长（calcFocused 状态下才伸长）
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
        calcFocused && "focused",
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
            "progress-bar flex h-[3px] gap-1 transition-[height] duration-300",
            calcFocused && "h-[7px]",
        )}
    >
        <div
            class={cn(
                "mastered-segment bg-success rounded-sm",
                calcFocused && "opacity-55",
                celebrating && "celebrate",
            )}
            style="--w: {masteredDisplayWidth}%; --focused: {calcFocused ? 1 : 0}"
        ></div>
        <div
            class="learning-track flex overflow-hidden rounded-sm"
            style="width: {learningDisplayWidth}%"
        >
            {#each learningSegments as seg (seg.level)}
                <div
                    class="learning-segment"
                    style="--w: {seg.widthPercent}%; background-color: {seg.color}"
                ></div>
            {/each}
        </div>
        <div
            class={cn(
                "pending-segment bg-foreground/15 rounded-sm",
                calcFocused && "opacity-55",
            )}
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
        transition:
            width 500ms var(--ease-spring),
            opacity 500ms var(--ease-spring),
            filter 500ms var(--ease-spring);
    }
    .learning-track,
    .pending-segment {
        transition:
            width 500ms var(--ease-spring),
            opacity 500ms var(--ease-spring);
    }
    .learning-segment {
        flex: 0 0 var(--w);
        width: var(--w);
        min-width: 0;
        transition:
            flex-basis 500ms var(--ease-spring),
            width 500ms var(--ease-spring),
            background-color 500ms var(--ease-spring);
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
