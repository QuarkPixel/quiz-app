<script lang="ts">
    import type { Stats } from "@/types";
    import type { LearningSegment } from "@/features/quiz";
    import {
        PROGRESS_SIDE_CAP_PERCENT,
        MASTERED_CELEBRATE_DURATION_MS,
    } from "@/config";
    import { cn } from "$lib/utils";
    import NumberFlow, { continuous } from "@number-flow/svelte";

    interface Props {
        stats: Stats;
        learningSegments: LearningSegment[];
        focused: boolean;
        onToggleFocus: () => void;
    }

    let { stats, learningSegments, focused, onToggleFocus }: Props = $props();

    type SegmentWidths = {
        mastered: number;
        learning: number;
        pending: number;
    };

    function getSegmentWidths(): SegmentWidths {
        if (stats.total <= 0) {
            return { mastered: 0, learning: 0, pending: 0 };
        }

        const unit = 100 / stats.total;
        return {
            mastered: stats.mastered * unit,
            learning: stats.learning * unit,
            pending: stats.pending * unit,
        };
    }

    function getDisplayWidths(
        widths: SegmentWidths,
        isFocused: boolean,
    ): SegmentWidths {
        if (!isFocused) return widths;

        const mastered = Math.min(
            widths.mastered * 16,
            PROGRESS_SIDE_CAP_PERCENT,
        );
        const pending = Math.min(
            widths.pending * 16,
            PROGRESS_SIDE_CAP_PERCENT,
        );

        return {
            mastered,
            pending,
            learning: Math.max(0, 100 - mastered - pending),
        };
    }

    function getLearningProgress(learningWidth: number): number {
        if (learningSegments.length === 0 || learningWidth <= 0) return 0;

        let weightedPercent = 0;
        for (const segment of learningSegments) {
            const weight =
                (learningSegments.length - segment.level) /
                learningSegments.length;
            weightedPercent += weight * segment.widthPercent;
        }

        return (weightedPercent / 100) * (learningWidth / 100);
    }

    let barFocused = $derived(focused && stats.mastered !== stats.total);
    let segmentWidths = $derived(getSegmentWidths());
    let displayWidths = $derived(getDisplayWidths(segmentWidths, barFocused));

    // 已掌握数增加时短暂高亮 + 微微伸长（仅聚焦视图下才伸长）
    // svelte-ignore state_referenced_locally
    let prevMastered = stats.mastered;
    let celebrating = $state(false);
    let celebrateTimer: ReturnType<typeof setTimeout> | null = null;

    let progressRangeStart = $derived(stats.mastered);
    let progressRangeEnd = $derived(
        barFocused ? stats.pending : stats.learning + stats.pending,
    );
    let progressPercent = $derived(
        stats.total > 0
            ? segmentWidths.mastered / 100 +
                  getLearningProgress(segmentWidths.learning)
            : 0,
    );

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
        barFocused && "focused",
    )}
    onclick={onToggleFocus}
    disabled={stats.learning === 0}
    aria-label={barFocused ? "显示完整进度" : "聚焦学习中进度"}
>
    <div
        class="text-muted-foreground mb-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end text-xs tabular-nums"
    >
        <div class="justify-self-start">
            <NumberFlow plugins={[continuous]} value={progressRangeStart} />
        </div>
        <NumberFlow
            plugins={[continuous]}
            value={progressPercent}
            format={{ style: "percent", maximumFractionDigits: 2 }}
            class="justify-self-center text-[smaller] font-mono opacity-70"
        />
        <div class="justify-self-end">
            <NumberFlow plugins={[continuous]} value={progressRangeEnd} />
        </div>
    </div>
    <div
        class={cn(
            "progress-bar flex h-[3px] gap-1 transition-[height] duration-300",
            barFocused && "h-[7px]",
        )}
    >
        <div
            class={cn(
                "mastered-segment bg-success rounded-sm",
                barFocused && "opacity-55",
                celebrating && "celebrate",
            )}
            style="--w: {displayWidths.mastered}%; --focused: {barFocused
                ? 1
                : 0}"
        ></div>
        <div
            class="learning-track flex overflow-hidden rounded-sm"
            style="width: {displayWidths.learning}%"
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
                barFocused && "opacity-55",
            )}
            style="width: {displayWidths.pending}%"
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
