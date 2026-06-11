<script lang="ts">
    import type { Question, ActivePoolItem } from "../types";
    import { getRequiredStreak } from "../features/quiz";
    import { QUESTION_TYPES } from "../quiz/types/registry";
    import {
        POOL_ITEM_FLIP_DURATION_MS,
        POOL_ITEM_OUT_DURATION_MS,
    } from "../config";
    import { cn } from "$lib/utils";
    import { flip } from "svelte/animate";
    import { fly } from "svelte/transition";
    import { backOut, cubicOut } from "svelte/easing";
    import { onDestroy } from "svelte";
    import StreakIndicator from "./StreakIndicator.svelte";
    import { useQuizSession } from "../quiz/session/context";

    const session = useQuizSession();

    const questionMap = $derived(
        new Map(session.questions.map((q) => [q.id, q])),
    );

    const ANSWER_TOUCH_REVEAL_MS = 3000;
    const ANSWER_TOUCH_TAP_MOVE_TOLERANCE_PX = 10;

    type PoolEntry = {
        item: ActivePoolItem;
        question: Question;
        requiredStreak: number;
        isLatest: boolean;
        answerText: string;
    };

    type TouchTapState = {
        id: string;
        pointerId: number;
        startX: number;
        startY: number;
    };

    let revealedAnswerId = $state<string | null>(null);
    let revealAnswerTimer: ReturnType<typeof setTimeout> | null = null;
    let touchTapState: TouchTapState | null = null;

    function clearRevealAnswerTimer(): void {
        if (!revealAnswerTimer) return;
        clearTimeout(revealAnswerTimer);
        revealAnswerTimer = null;
    }

    function revealAnswerForTouch(id: string): void {
        clearRevealAnswerTimer();
        revealedAnswerId = id;
        revealAnswerTimer = setTimeout(() => {
            revealedAnswerId = null;
            revealAnswerTimer = null;
        }, ANSWER_TOUCH_REVEAL_MS);
    }

    function handlePoolItemPointerDown(event: PointerEvent, id: string): void {
        if (event.pointerType !== "touch") return;

        touchTapState = {
            id,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
        };
    }

    function handlePoolItemPointerMove(event: PointerEvent): void {
        if (!touchTapState || event.pointerId !== touchTapState.pointerId) {
            return;
        }

        const dx = event.clientX - touchTapState.startX;
        const dy = event.clientY - touchTapState.startY;
        if (Math.hypot(dx, dy) > ANSWER_TOUCH_TAP_MOVE_TOLERANCE_PX) {
            touchTapState = null;
        }
    }

    function handlePoolItemPointerEnd(event: PointerEvent): void {
        if (event.pointerType !== "touch") return;

        if (touchTapState?.pointerId === event.pointerId) {
            revealAnswerForTouch(touchTapState.id);
            touchTapState = null;
        }
    }

    function handlePoolItemPointerCancel(event: PointerEvent): void {
        if (touchTapState?.pointerId === event.pointerId) {
            touchTapState = null;
        }
    }

    onDestroy(() => {
        clearRevealAnswerTimer();
    });

    let entries = $derived.by<PoolEntry[]>(() => {
        const currentId = session.currentQuestion?.id ?? null;
        const visible = session.appState.activePool.filter(
            (item) => item.id !== currentId,
        );
        // 最近被选过的（lastSelectedRound 最大）在最上面
        const sorted = visible
            .slice()
            .sort((a, b) => b.lastSelectedRound - a.lastSelectedRound);
        const result: PoolEntry[] = [];
        for (let i = 0; i < sorted.length; i++) {
            const item = sorted[i];
            const q = questionMap.get(item.id);
            if (!q) continue;
            result.push({
                item,
                question: q,
                requiredStreak: getRequiredStreak(item, session.appState),
                isLatest: i === 0,
                answerText: QUESTION_TYPES[q.type].formatAnswerText(q),
            });
        }
        return result;
    });
</script>

<div class="pool-mask flex-1 min-h-0 overflow-y-auto" aria-label="活动题目池">
    {#if entries.length === 0}
        <p class="text-muted-foreground/60 px-3 py-12 text-center text-xs">
            池中暂无其它题目
        </p>
    {:else}
        <ul class="flex flex-col gap-4 py-5 px-1">
            {#each entries as entry (entry.item.id)}
                <li
                    animate:flip={{ duration: POOL_ITEM_FLIP_DURATION_MS }}
                    in:fly={{
                        y: -14,
                        duration: POOL_ITEM_FLIP_DURATION_MS,
                        easing: backOut,
                        opacity: 0,
                    }}
                    out:fly={{
                        x: -12,
                        duration: POOL_ITEM_OUT_DURATION_MS,
                        easing: cubicOut,
                        opacity: 0,
                    }}
                    class="pool-item flex flex-col gap-1.5"
                    onpointerdown={(event) =>
                        handlePoolItemPointerDown(event, entry.item.id)}
                    onpointermove={handlePoolItemPointerMove}
                    onpointerup={handlePoolItemPointerEnd}
                    onpointercancel={handlePoolItemPointerCancel}
                >
                    <div
                        class="text-muted-foreground/70 flex items-center gap-2 text-[10px]"
                    >
                        <span class="font-mono">{entry.item.id}</span>
                        {#if !entry.item.hasBeenShown}
                            <span
                                class="font-semibold font-mono text-success"
                            >
                                NEW
                            </span>
                        {/if}
                        <div class="ml-auto">
                            <StreakIndicator
                                item={entry.item}
                                requiredStreak={entry.requiredStreak}
                                size="compact"
                                onMaster={() =>
                                    session.markAsMastered(entry.item.id)}
                            />
                        </div>
                    </div>

                    <p
                        class="text-foreground/90 line-clamp-2 text-[13px] leading-snug whitespace-pre-wrap"
                    >
                        {entry.question.question}
                    </p>

                    <p
                        class={cn(
                            "pool-answer",
                            "text-success/90 truncate text-[12px] leading-snug transition-opacity duration-300 ease-spring",
                            entry.isLatest ||
                                revealedAnswerId === entry.item.id
                                ? "opacity-100"
                                : "opacity-0",
                        )}
                    >
                        {entry.answerText}
                    </p>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    /* 上下 20px 渐变蒙版 */
    .pool-mask {
        --mask: linear-gradient(
            to bottom,
            transparent 0,
            black 20px,
            black calc(100% - 20px),
            transparent 100%
        );
        -webkit-mask-image: var(--mask);
        mask-image: var(--mask);
        scrollbar-width: none;
    }
    .pool-mask::-webkit-scrollbar {
        display: none;
    }

    @media (hover: hover) and (pointer: fine) {
        .pool-item:hover .pool-answer {
            opacity: 1;
        }
    }

    @media (hover: none) and (pointer: coarse) {
        .pool-item {
            -webkit-touch-callout: none;
            -webkit-user-select: none;
            touch-action: manipulation;
            user-select: none;
        }
    }
</style>
