<script lang="ts">
    import type { Question } from "@/types";
    import { cn } from "$lib/utils";
    import StreakIndicator from "../quiz/StreakIndicator.svelte";
    import CopyQuestionButton from "../quiz/CopyQuestionButton.svelte";
    import QuestionPreview from "../quiz/QuestionPreview.svelte";
    import type { ReviewIndicator } from "./virtualList/types";
    import type { CopyQuestionStatus } from "@/quiz/session/QuizSession.svelte";

    interface Props {
        question: Question;
        indicator: ReviewIndicator | null;
        selected: boolean;
        copyStatus: CopyQuestionStatus;
        onCopy: (event: MouseEvent, question: Question) => void;
    }

    let {
        question,
        indicator,
        selected,
        copyStatus,
        onCopy,
    }: Props = $props();
</script>

<QuestionPreview
    {question}
    data-review-question-id={question.id}
    class={cn(
        selected &&
            "border-foreground/20 bg-background ring-4 ring-foreground/5",
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
