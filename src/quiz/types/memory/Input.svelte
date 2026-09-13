<script lang="ts">
    import type { QuestionInputProps } from "../types";
    import { cn } from "$lib/utils";
    import { splitAnswerParagraphs } from "./paragraphs";

    /**
     * 记忆题型在「答案页」展示的答案卡片。
     *
     * 按钮（知道 / 忘记）由 `MemoryQuestionArea.svelte` 的按钮区负责，位置与刷题
     * 模式的「提交答案 / 视作正确」一致，所以这里只渲染答案本身：
     *   - 不显示「答案」标签（谁都知道那是答案）
     *   - `answer` 里一个换行 = 一个段落，按段落渲染并留出段间距
     */
    let { question, isCorrect, showResult }: QuestionInputProps = $props();

    const paragraphs = $derived(
        splitAnswerParagraphs((question.answer as string) ?? ""),
    );
</script>

{#if showResult}
    <div
        class={cn(
            "border-border bg-muted/40 rounded-xl border px-5 py-4",
            !isCorrect && "border-destructive/30 bg-destructive/5",
        )}
    >
        {#each paragraphs as paragraph, index (index)}
            <p
                class="text-foreground my-3 text-base leading-7 font-normal first:mt-0 last:mb-0"
            >
                {paragraph}
            </p>
        {/each}
    </div>
{/if}
