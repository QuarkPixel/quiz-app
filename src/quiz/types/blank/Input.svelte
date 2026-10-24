<script lang="ts">
    import type { QuestionInputProps } from "../types";
    import BlankField from "@/components/quiz/BlankField.svelte";
    import { computeBlankDiff } from "./diff";

    /**
     * 填空题的作答区：每个空一条下划线（`BlankField`）。
     *
     * 答错时那一条线换成只读的 diff（多打的划掉、漏掉的补灰）——**位置和字号都不变**，
     * 所以「我写的」和「错在哪」在同一个位置，不需要用户在两块 UI 之间来回看。
     */
    let {
        question,
        showResult,
        isCorrect,
        answerTone,
        readonlyDisplayMode = "answer",
        autoSubmitOnSelection: _autoSubmitOnSelection,
        blankAnswerInputs,
        onBlankAnswerInputsChange,
    }: QuestionInputProps = $props();

    const answers = $derived(
        Array.isArray(question.answer)
            ? (question.answer as string[])
            : [question.answer as string],
    );

    // 仅答错时逐空算 diff；为 null 的空回退到普通（禁用的）下划线。
    const diffs = $derived(
        showResult && !isCorrect
            ? answers.map((ans, i) =>
                  computeBlankDiff(blankAnswerInputs[i] ?? "", ans),
              )
            : answers.map(() => null),
    );

    /**
     * 下划线的颜色档位。预览态用 warning（与其它题型的预览同一套口径），
     * 作答后按对错走 success / destructive，记忆模式的「模糊」由 `answerTone` 带进来。
     */
    const tone = $derived.by<"neutral" | "success" | "warning" | "destructive">(
        () => {
            if (!showResult) return "neutral";
            if (readonlyDisplayMode === "preview") return "warning";
            if (answerTone === "warning") return "warning";
            if (answerTone === "destructive") return "destructive";
            return isCorrect ? "success" : "destructive";
        },
    );

    function setAt(i: number, value: string): void {
        const next = blankAnswerInputs.slice();
        next[i] = value;
        onBlankAnswerInputsChange?.(next);
    }
</script>

<div class="flex flex-col gap-1.5">
    {#each answers as _, i}
        {#if diffs[i]}
            <BlankField
                {tone}
                ariaLabel="你的作答与答案的差异"
                disabled
            >
                <span>
                    {#each diffs[i]! as seg}
                        {#if seg.type === "extra"}
                            <span class="text-destructive line-through"
                                >{seg.text}</span
                            >
                        {:else if seg.type === "missing"}
                            <span
                                class="text-muted-foreground/70 underline decoration-dotted underline-offset-2"
                                >{seg.text}</span
                            >
                        {:else}
                            <span>{seg.text}</span>
                        {/if}
                    {/each}
                </span>
            </BlankField>
        {:else}
            <BlankField
                {tone}
                value={blankAnswerInputs[i] ?? ""}
                onInput={(value) => setAt(i, value)}
                placeholder={Array.isArray(question.answer)
                    ? `第 ${i + 1} 空`
                    : "根据提示默写答案"}
                ariaLabel={
                    Array.isArray(question.answer)
                        ? `第 ${i + 1} 空`
                        : "填空答案"
                }
                disabled={showResult}
            />
        {/if}
    {/each}
</div>
