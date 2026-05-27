<script lang="ts">
    import type { Question, RuntimeState, ActivePoolItem } from "../types";
    import { getRequiredStreak } from "../features/quiz";
    import { cn } from "$lib/utils";
    import { flip } from "svelte/animate";
    import { fly } from "svelte/transition";
    import { backOut, cubicOut } from "svelte/easing";

    interface Props {
        questions: Question[];
        state: RuntimeState;
        currentQuestionId: string | null;
    }

    let { questions, state, currentQuestionId }: Props = $props();

    const questionMap = $derived(
        new Map(questions.map((q) => [q.id, q])),
    );

    type PoolEntry = {
        item: ActivePoolItem;
        question: Question;
        requiredStreak: number;
        isLatest: boolean;
        answerText: string;
    };

    function describeAnswer(q: Question): string {
        switch (q.type) {
            case "judgment":
                return q.answer ? "正确" : "错误";
            case "blank":
                if (Array.isArray(q.answer)) {
                    return (q.answer as string[]).join(" | ");
                }
                return q.answer as string;
            default: {
                const indices = q.answer as number[];
                if (!q.options) return "";
                return indices
                    .slice()
                    .sort((a, b) => a - b)
                    .map((idx) => q.options![idx]?.text ?? "")
                    .filter(Boolean)
                    .join(" / ");
            }
        }
    }

    let entries = $derived.by<PoolEntry[]>(() => {
        const visible = state.activePool.filter(
            (item) => item.id !== currentQuestionId,
        );
        // 最近被选过的（lastSelectedRound 最大）在最上面
        const sorted = visible.slice().sort(
            (a, b) => b.lastSelectedRound - a.lastSelectedRound,
        );
        const result: PoolEntry[] = [];
        for (let i = 0; i < sorted.length; i++) {
            const item = sorted[i];
            const q = questionMap.get(item.id);
            if (!q) continue;
            result.push({
                item,
                question: q,
                requiredStreak: getRequiredStreak(item, state),
                isLatest: i === 0,
                answerText: describeAnswer(q),
            });
        }
        return result;
    });
</script>

<div
    class="pool-mask flex-1 min-h-0 overflow-y-auto"
    aria-label="活动题目池"
>
    {#if entries.length === 0}
        <p
            class="text-muted-foreground/60 px-3 py-12 text-center text-xs"
        >
            池中暂无其它题目
        </p>
    {:else}
        <ul class="flex flex-col gap-4 py-5 px-1">
            {#each entries as entry (entry.item.id)}
                <li
                    animate:flip={{ duration: 420 }}
                    in:fly={{
                        y: -14,
                        duration: 420,
                        easing: backOut,
                        opacity: 0,
                    }}
                    out:fly={{
                        x: -12,
                        duration: 260,
                        easing: cubicOut,
                        opacity: 0,
                    }}
                    class="group/pool-item flex flex-col gap-1.5"
                >
                    <div
                        class="text-muted-foreground/70 flex items-center gap-2 text-[10px]"
                    >
                        <span class="font-mono">{entry.item.id}</span>
                        <div
                            class="bg-foreground/8 ml-auto flex items-center gap-1 rounded-full p-[3px]"
                        >
                            {#each Array(entry.requiredStreak) as _, i}
                                <span
                                    class={cn(
                                        "block size-1 rounded-full",
                                        i < entry.item.consecutiveCorrect
                                            ? entry.item.hasEverMistaken
                                                ? "bg-warning"
                                                : "bg-success"
                                            : "bg-background",
                                    )}
                                ></span>
                            {/each}
                        </div>
                    </div>

                    <p
                        class="text-foreground/90 line-clamp-2 text-[13px] leading-snug whitespace-pre-wrap"
                    >
                        {entry.question.question}
                    </p>

                    <p
                        class={cn(
                            "text-success/90 truncate text-[12px] leading-snug transition-opacity duration-300 ease-spring",
                            entry.isLatest
                                ? "opacity-100"
                                : "opacity-0 group-hover/pool-item:opacity-100",
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
</style>
