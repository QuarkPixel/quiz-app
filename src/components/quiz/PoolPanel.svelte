<script lang="ts">
    import type { Question, ActivePoolItem } from "../../types";
    import { getRequiredStreak } from "../../features/quiz";
    import { QUESTION_TYPES } from "../../quiz/types/registry";
    import {
        POOL_ITEM_FLIP_DURATION_MS,
        POOL_ITEM_OUT_DURATION_MS,
    } from "../../config";
    import { cn } from "$lib/utils";
    import { flip } from "svelte/animate";
    import { fly } from "svelte/transition";
    import { backOut, cubicOut } from "svelte/easing";
    import { onDestroy } from "svelte";
    import StreakIndicator from "./StreakIndicator.svelte";
    import { useQuizSession } from "../../quiz/session/context";

    const session = useQuizSession();

    const questionMap = $derived(
        new Map(session.questions.map((q) => [q.id, q])),
    );

    const ANSWER_POINTER_REVEAL_MS = 3000;
    const ANSWER_POINTER_TAP_MOVE_TOLERANCE_PX = 10;

    type PoolEntry = {
        item: ActivePoolItem;
        question: Question;
        requiredStreak: number;
        maxLevel: number;
        isLatest: boolean;
        answerText: string;
    };

    type PointerTapState = {
        id: string;
        pointerId: number;
        startX: number;
        startY: number;
    };

    let revealedAnswerKeys = $state<Record<string, number>>({});
    const revealAnswerTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const pointerTapStates = new Map<number, PointerTapState>();

    function clearRevealAnswerTimer(id: string): void {
        const timer = revealAnswerTimers.get(id);
        if (!timer) return;

        clearTimeout(timer);
        revealAnswerTimers.delete(id);
    }

    function hideRevealedAnswer(id: string): void {
        const nextRevealedAnswerKeys = { ...revealedAnswerKeys };
        delete nextRevealedAnswerKeys[id];
        revealedAnswerKeys = nextRevealedAnswerKeys;
    }

    function revealAnswerForPointerTap(id: string): void {
        clearRevealAnswerTimer(id);

        revealedAnswerKeys = {
            ...revealedAnswerKeys,
            [id]: (revealedAnswerKeys[id] ?? 0) + 1,
        };

        const timer = setTimeout(() => {
            if (revealAnswerTimers.get(id) !== timer) return;
            revealAnswerTimers.delete(id);
            hideRevealedAnswer(id);
        }, ANSWER_POINTER_REVEAL_MS);
        revealAnswerTimers.set(id, timer);
    }

    function canRevealAnswerWithPointer(event: PointerEvent): boolean {
        return event.pointerType === "touch" || event.pointerType === "pen";
    }

    function handlePoolItemPointerDown(event: PointerEvent, id: string): void {
        if (!canRevealAnswerWithPointer(event)) return;

        pointerTapStates.set(event.pointerId, {
            id,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
        });
    }

    function handlePoolItemPointerMove(event: PointerEvent): void {
        const pointerTapState = pointerTapStates.get(event.pointerId);
        if (!pointerTapState) return;

        const dx = event.clientX - pointerTapState.startX;
        const dy = event.clientY - pointerTapState.startY;
        if (Math.hypot(dx, dy) > ANSWER_POINTER_TAP_MOVE_TOLERANCE_PX) {
            pointerTapStates.delete(event.pointerId);
        }
    }

    function handlePoolItemPointerEnd(event: PointerEvent): void {
        if (!canRevealAnswerWithPointer(event)) return;

        const pointerTapState = pointerTapStates.get(event.pointerId);
        if (pointerTapState) {
            revealAnswerForPointerTap(pointerTapState.id);
            pointerTapStates.delete(event.pointerId);
        }
    }

    function handlePoolItemPointerCancel(event: PointerEvent): void {
        pointerTapStates.delete(event.pointerId);
    }

    onDestroy(() => {
        revealAnswerTimers.forEach((timer) => clearTimeout(timer));
        revealAnswerTimers.clear();
        pointerTapStates.clear();
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
                maxLevel: Math.max(
                    session.appState.settings.correctStreakToMaster,
                    session.appState.settings.correctStreakAfterMistake,
                ),
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
                            <span class="font-semibold font-mono text-success">
                                NEW
                            </span>
                        {/if}
                        <div class="ml-auto">
                            <StreakIndicator
                                item={entry.item}
                                requiredStreak={entry.requiredStreak}
                                maxLevel={entry.maxLevel}
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

                    {#key revealedAnswerKeys[entry.item.id] ?? 0}
                        <p
                            class={cn(
                                "pool-answer",
                                "text-success/90 text-[12px] leading-snug transition-opacity duration-300 ease-spring",
                                entry.isLatest
                                    ? "opacity-100"
                                    : revealedAnswerKeys[entry.item.id] !==
                                        undefined
                                      ? "pointer-reveal"
                                      : "opacity-0",
                            )}
                        >
                            {entry.answerText}
                        </p>
                    {/key}
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

    .pool-answer.pointer-reveal {
        animation: pool-answer-fade-out 3000ms linear forwards;
    }

    @keyframes pool-answer-fade-out {
        from {
            opacity: 1;
        }
        to {
            opacity: 0;
        }
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
