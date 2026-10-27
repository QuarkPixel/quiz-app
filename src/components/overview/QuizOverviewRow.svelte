<script lang="ts">
    import type { Question } from "@/types";
    import { cn } from "$lib/utils";
    import StreakIndicator from "../quiz/StreakIndicator.svelte";
    import CopyQuestionButton from "../quiz/CopyQuestionButton.svelte";
    import QuestionPreview from "../quiz/QuestionPreview.svelte";
    import type { ReviewIndicator } from "./list/types";
    import type { CopyQuestionStatus } from "@/quiz/session/types";

    /**
     * 刷题模式总览的一行：题目预览 + 连对指示器 + 题号。
     *
     * 记忆模式的那一行结构不同（状态文字本身就是「标熟」按钮），所以行渲染
     * 留在各自的适配器里，`OverviewList` 只负责虚拟布局。
     */

    interface Props {
        question: Question;
        indicator: ReviewIndicator | null;
        selected: boolean;
        copyStatus: CopyQuestionStatus;
        onCopy: (event: MouseEvent, question: Question) => void;
        /** 额外的卡片样式（热力图跳转过来的高亮） */
        class?: string;
    }

    let {
        question,
        indicator,
        selected,
        copyStatus,
        onCopy,
        class: className,
    }: Props = $props();
</script>

<QuestionPreview
    {question}
    data-review-question-id={question.id}
    class={cn(
        selected &&
            "border-foreground/20 bg-background ring-4 ring-foreground/5",
        className,
    )}
>
    {#snippet action()}
        <CopyQuestionButton
            status={copyStatus}
            onclick={(e: MouseEvent) => onCopy(e, question)}
        />
    {/snippet}
    {#snippet trailing()}
        {#if indicator}
            <StreakIndicator
                item={indicator.item}
                requiredStreak={indicator.requiredStreak}
                maxLevel={indicator.maxLevel}
                size="compact"
                readonly
            />
        {/if}
        <span class="text-muted-foreground text-xs font-mono">
            {question.id}
        </span>
    {/snippet}
</QuestionPreview>
