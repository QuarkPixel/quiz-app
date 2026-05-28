<script lang="ts">
    import type { QuestionReviewProps } from "../types";
    import { cn } from "$lib/utils";
    import IconCheck from "@tabler/icons-svelte/icons/check";

    let { question }: QuestionReviewProps = $props();
</script>

{#if question.options}
    {@const correctIndices = question.answer as number[]}
    <div class="flex flex-col gap-1">
        {#each question.options as opt, i}
            {@const isCorrect = correctIndices.includes(i)}
            <div
                class={cn(
                    "flex items-start gap-2 rounded px-1.5 py-1",
                    isCorrect && "bg-success/8",
                )}
            >
                <span
                    class={cn(
                        "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                        isCorrect
                            ? "bg-success text-success-foreground"
                            : "bg-muted text-muted-foreground",
                    )}
                >
                    {String.fromCharCode(65 + i)}
                </span>
                <span
                    class={cn(
                        "flex-1 text-sm leading-snug",
                        isCorrect
                            ? "text-success font-semibold"
                            : "text-muted-foreground",
                    )}
                >
                    {opt.text}
                </span>
                {#if isCorrect}
                    <IconCheck
                        size={14}
                        stroke={2.25}
                        class="text-success mt-0.5 shrink-0"
                    />
                {/if}
            </div>
        {/each}
    </div>
{/if}
