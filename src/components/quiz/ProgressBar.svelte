<script lang="ts">
    import type { Stats } from "@/types";
    import type { LearningSegment } from "@/features/quiz";
    import {
        PROGRESS_SIDE_CAP_PERCENT,
        MASTERED_CELEBRATE_DURATION_MS,
    } from "@/config";
    import { cn } from "$lib/utils";
    import {
        preloadNumberFlow,
        formatNumberFallback,
    } from "$lib/numberFlow";

    interface Props {
        stats: Stats;
        learningSegments: LearningSegment[];
        /** 聚焦态（只有刷题模式用得上：点一下就放大学习中那一段） */
        focused?: boolean;
        onToggleFocus?: () => void;
        /**
         * 中间不显示百分比，改成这句文案（记忆模式用来显示「3/5」）。
         */
        label?: string;
        /**
         * 右侧数字的覆盖值。
         *
         * 默认是「进度范围末端」= 已掌握 + 剩余（刷题模式的口径：左「已掌握」、
         * 右「还没掌握的」）。记忆模式的口径是「已完成 / 本轮总数」，所以显式
         * 传 total 进来，而不是让两边各自实现一套数字行。
         */
        rightValue?: number;
        /**
         * 是否可交互（默认 true）。记忆模式的进度条是纯展示，不做聚焦放大，
         * 传 false 就渲染成非按钮、不吃 hover / 点击。
         */
        interactive?: boolean;
        /** 非交互态的 aria-label（交互态用「聚焦/显示完整进度」那两句） */
        ariaLabel?: string;
    }

    let {
        stats,
        learningSegments,
        focused = false,
        onToggleFocus,
        label,
        rightValue,
        interactive = true,
        ariaLabel = "进度",
    }: Props = $props();

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

    let barFocused = $derived(
        interactive && focused && stats.mastered !== stats.total,
    );
    let segmentWidths = $derived(getSegmentWidths());
    let displayWidths = $derived(getDisplayWidths(segmentWidths, barFocused));

    // 已掌握数增加时短暂高亮 + 微微伸长（仅聚焦视图下才伸长）
    // svelte-ignore state_referenced_locally
    let prevMastered = stats.mastered;
    let celebrating = $state(false);
    let celebrateTimer: ReturnType<typeof setTimeout> | null = null;

    let progressRangeStart = $derived(stats.mastered);
    let progressRangeEnd = $derived(
        rightValue ?? (barFocused ? stats.pending : stats.learning + stats.pending),
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

<!--
    一个会滚的数字。

    `@number-flow/svelte` 是动态拉的（见 `$lib/numberFlow.ts`），所以这里用
    `{#await}` 把它兜住：包还没到时先写纯文本——同一个 `Intl` 格式化结果，
    长得一模一样，只是不滚动；到了之后换成 `NumberFlow`，此后的变化照常动画。
    三个数字共用同一个 Promise，只会拉一次。
-->
{#snippet counter(
    value: number,
    format?: Intl.NumberFormatOptions,
    className?: string,
)}
    {#await preloadNumberFlow()}
        <span class={className}>{formatNumberFallback(value, format)}</span>
    {:then engine}
        <engine.Component
            plugins={[engine.continuous]}
            {value}
            {format}
            class={className}
        />
    {/await}
{/snippet}

{#snippet barContent()}
    <div
        class="text-muted-foreground mb-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end text-xs tabular-nums"
    >
        <div class="justify-self-start">
            {@render counter(progressRangeStart)}
        </div>
        {#if label !== undefined}
            <span class="justify-self-center text-[smaller] font-mono opacity-70">
                {label}
            </span>
        {:else}
            {@render counter(
                progressPercent,
                { style: "percent", maximumFractionDigits: 2 },
                "justify-self-center text-[smaller] font-mono opacity-70",
            )}
        {/if}
        <div class="justify-self-end">
            {@render counter(progressRangeEnd)}
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
{/snippet}

{#if interactive}
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
        {@render barContent()}
    </button>
{:else}
    <!-- 纯展示形态（记忆模式）：同一个条、同一套数字动画，只是不可点 -->
    <div
        class="block w-full h-[42px] py-1.5 text-left"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={stats.mastered}
        aria-valuemin={0}
        aria-valuemax={stats.total}
    >
        {@render barContent()}
    </div>
{/if}

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
