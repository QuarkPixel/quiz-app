<script lang="ts">
    import type { QuestionInputProps } from "../types";
    import { cn } from "$lib/utils";
    import IconCheck from "@tabler/icons-svelte/icons/check";
    import IconX from "@tabler/icons-svelte/icons/x";

    let {
        question,
        showResult,
        selectedAnswers = $bindable(),
        onAutoSubmit,
    }: QuestionInputProps = $props();

    const options = [
        { idx: 0, label: "正确", value: true, icon: IconCheck },
        { idx: 1, label: "错误", value: false, icon: IconX },
    ];

    function handleClick(idx: number): void {
        if (showResult) return;
        selectedAnswers = [idx];
        onAutoSubmit?.();
    }
</script>

{#each options as opt}
    {@const isSelected = selectedAnswers.includes(opt.idx)}
    {@const isOptionCorrect =
        showResult && (question.answer as boolean) === opt.value}
    {@const isWrong =
        showResult && isSelected && (question.answer as boolean) !== opt.value}
    {@const OptIcon = opt.icon}
    <button
        type="button"
        class={cn(
            "border-border bg-background hover:bg-muted flex items-center gap-3 rounded-lg border px-4 py-3.5 text-left text-base transition-colors disabled:cursor-default",
            isSelected && !showResult && "border-foreground bg-muted",
            isOptionCorrect &&
                "border-success bg-success/8 text-success",
            isWrong && "border-destructive bg-destructive/8 text-destructive",
        )}
        onclick={() => handleClick(opt.idx)}
        disabled={showResult}
    >
        <OptIcon size={18} stroke={2} />
        {opt.label}
    </button>
{/each}
