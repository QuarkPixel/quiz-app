<script lang="ts">
    import type { QuestionInputProps } from "../types";
    import { cn } from "$lib/utils";

    let {
        question,
        showResult,
        shuffledOptions,
        selectedAnswers = $bindable(),
    }: QuestionInputProps = $props();

    function handleClick(originalIndex: number): void {
        if (showResult) return;
        if (selectedAnswers.includes(originalIndex)) {
            selectedAnswers = selectedAnswers.filter((i) => i !== originalIndex);
        } else {
            selectedAnswers = [...selectedAnswers, originalIndex];
        }
    }
</script>

{#each shuffledOptions as opt, idx}
    {@const correctAnswers = question.answer as number[]}
    {@const isSelected = selectedAnswers.includes(opt.originalIndex)}
    {@const isOptionCorrect =
        showResult && correctAnswers.includes(opt.originalIndex)}
    {@const isWrong =
        showResult &&
        isSelected &&
        !correctAnswers.includes(opt.originalIndex)}
    {@const displayLetter = String.fromCharCode(65 + idx)}
    <button
        type="button"
        class={cn(
            "border-border bg-background hover:bg-muted flex items-start gap-3 rounded-lg border px-4 py-3.5 text-left text-base transition-colors disabled:cursor-default",
            isSelected && !showResult && "border-foreground bg-muted",
            isOptionCorrect && "border-success bg-success/8",
            isWrong && "border-destructive bg-destructive/8",
        )}
        onclick={() => handleClick(opt.originalIndex)}
        disabled={showResult}
    >
        <span
            class={cn(
                "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                isOptionCorrect
                    ? "bg-success text-success-foreground"
                    : isWrong
                      ? "bg-destructive text-destructive-foreground"
                      : isSelected && !showResult
                        ? "bg-foreground text-background"
                        : "bg-foreground/10 text-muted-foreground",
            )}
        >
            {displayLetter}
        </span>
        <span
            class={cn(
                "flex-1 leading-relaxed",
                isOptionCorrect && "text-success",
                isWrong && "text-destructive",
            )}
        >
            {opt.text}
        </span>
    </button>
{/each}
