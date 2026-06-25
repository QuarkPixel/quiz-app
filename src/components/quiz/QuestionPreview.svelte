<script lang="ts">
    import type { Snippet } from "svelte";
    import type { Question } from "@/types";
    import type { HTMLAttributes } from "svelte/elements";
    import { cn } from "$lib/utils";
    import { QUESTION_TYPES } from "@/quiz/types/registry";

    interface Props extends HTMLAttributes<HTMLDivElement> {
        question: Question;
        /** 题干右侧紧贴的内联内容（如复制按钮）。 */
        action?: Snippet;
        /** 整行最右侧内容（如进度指示器、题号）。 */
        trailing?: Snippet;
    }

    let {
        question,
        action,
        trailing,
        class: className,
        ...rest
    }: Props = $props();

    const ReviewComponent = $derived(QUESTION_TYPES[question.type].Review);
</script>

<div
    class={cn(
        "border-border/60 bg-muted/40 flex flex-col gap-2 rounded-lg border px-4 py-3 transition-[background-color,border-color,box-shadow] duration-300",
        className,
    )}
    {...rest}
>
    <div class="flex gap-2">
        <div class="flex-1 flex items-center">
            <span
                class="text-foreground text-sm leading-relaxed font-medium whitespace-pre-wrap"
            >
                {question.question}
            </span>
            {@render action?.()}
        </div>
        {#if trailing}
            <div class="flex shrink-0 items-center gap-2 pt-0.5">
                {@render trailing()}
            </div>
        {/if}
    </div>

    <ReviewComponent {question} />
</div>
