<script lang="ts">
    import type { QuestionReviewProps } from "../types";
    import { splitAnswerParagraphs } from "./paragraphs";

    // 与 blank/Review.svelte 同构：左边「答案」标签，右边答案文本。
    // 多段答案按段落渲染，段间距与答题页保持一致。
    let { question }: QuestionReviewProps = $props();

    const paragraphs = $derived(
        splitAnswerParagraphs((question.answer as string) ?? ""),
    );
</script>

<div class="flex items-start gap-1.5">
    <span class="text-muted-foreground text-xs">答案</span>
    <div class="flex-1">
        {#each paragraphs as paragraph, index (index)}
            <span
                class="text-success my-2 block text-sm leading-snug font-semibold first:mt-0 last:mb-0"
            >
                {paragraph}
            </span>
        {/each}
    </div>
</div>
