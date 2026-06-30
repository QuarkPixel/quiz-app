<script lang="ts">
    import type { QuestionInputProps } from "../types";
    import { Input } from "$lib/components/ui/input";
    import { computeBlankDiff } from "./diff";
    import { cn } from "$lib/utils";

    let {
        question,
        showResult,
        isCorrect,
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

    // 仅答错时逐空算 diff；为 null 的空回退到普通禁用输入框。
    const diffs = $derived(
        showResult && !isCorrect
            ? answers.map((ans, i) =>
                  computeBlankDiff(blankAnswerInputs[i] ?? "", ans),
              )
            : answers.map(() => null),
    );

    function setAt(i: number, value: string): void {
        const next = blankAnswerInputs.slice();
        next[i] = value;
        onBlankAnswerInputsChange?.(next);
    }
</script>

<div class="flex flex-col gap-2.5">
    {#each answers as _, i}
        {#if diffs[i]}
            <div
                class="blank-diff border-input bg-input/50 text-foreground flex min-h-12 w-full items-center rounded-lg border px-4 text-base"
                aria-label="你的作答与答案的差异"
            >
                <span class="whitespace-pre-wrap">
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
            </div>
        {:else}
            <Input
                data-slot="input"
                class={cn(
                    "blank-input h-12 px-4 text-lg md:text-lg",
                    showResult &&
                        readonlyDisplayMode === "preview" &&
                        "border-warning bg-warning/8 text-foreground disabled:opacity-100 disabled:text-foreground disabled:bg-warning/8",
                )}
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
        {/if}
    {/each}
</div>
