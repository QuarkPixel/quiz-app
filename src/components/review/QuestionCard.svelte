<script lang="ts">
    import type { Question } from "@/types";
    import { cn } from "$lib/utils";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import StreakIndicator from "../quiz/StreakIndicator.svelte";
    import CopyQuestionButton from "../quiz/CopyQuestionButton.svelte";
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

    const ReviewComponent = $derived(QUESTION_TYPES[question.type].Review);
</script>

<div
    data-review-question-id={question.id}
    class={cn(
        "border-border/60 bg-muted/40 flex flex-col gap-2 rounded-lg border px-4 py-3 transition-[background-color,border-color,box-shadow] duration-300",
        selected &&
            "border-foreground/20 bg-background ring-4 ring-foreground/5",
    )}
>
    <div class="flex gap-2">
        <div class="flex-1 flex items-center">
            <span
                class="text-foreground text-sm leading-relaxed font-medium whitespace-pre-wrap"
            >
                {question.question}
            </span>
            <CopyQuestionButton
                status={copyStatus}
                onclick={(e: MouseEvent) => onCopy(e, question)}
            />
        </div>
        <div class="flex shrink-0 items-center gap-2 pt-0.5">
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
        </div>
    </div>

    <ReviewComponent {question} />
</div>
