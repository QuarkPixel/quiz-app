<script lang="ts">
    import type { QuestionInputProps } from "../types";
    import { Input } from "$lib/components/ui/input";

    let {
        question,
        showResult,
        blankAnswerInputs,
        onBlankAnswerInputsChange,
    }: QuestionInputProps = $props();

    const blankCount = $derived(
        Array.isArray(question.answer) ? question.answer.length : 1,
    );

    function setAt(i: number, value: string): void {
        const next = blankAnswerInputs.slice();
        next[i] = value;
        onBlankAnswerInputsChange?.(next);
    }
</script>

<div class="flex flex-col gap-2.5">
    {#each Array(blankCount) as _, i}
        <Input
            data-slot="input"
            class="blank-input h-12 px-4 text-base"
            value={blankAnswerInputs[i] ?? ""}
            oninput={(e) => setAt(i, (e.target as HTMLInputElement).value)}
            placeholder={Array.isArray(question.answer)
                ? `第 ${i + 1} 空`
                : "根据提示默写答案"}
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            disabled={showResult}
        />
    {/each}
</div>
