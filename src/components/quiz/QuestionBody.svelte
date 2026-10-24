<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import SwapFade from "../shared/SwapFade.svelte";
    import { cn } from "$lib/utils";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import { useQuizSession } from "@/quiz/session/context";
    import { useQuizUiActions } from "@/quiz/session/uiContext";
    import type { Question } from "@/types";
    import type { QuestionInputProps } from "@/quiz/types/types";
    import IconConfetti from "@tabler/icons-svelte/icons/confetti";
    import IconInputCheck from "@tabler/icons-svelte/icons/input-check";
    import IconCircleArrowUpRightFilled from "@tabler/icons-svelte/icons/circle-arrow-up-right-filled";
    import IconFilterMinus from "@tabler/icons-svelte/icons/filter-minus";
    import IconRefresh from "@tabler/icons-svelte/icons/refresh";

    /**
     * 滚动区里的全部内容：题干 + 作答控件（没有题时是空状态）。
     *
     * 换题过渡套在最外面（`SwapFade`）：题号 / 连对进度那一行在固定区里，
     * 不参与过渡——只让「题面」这一层淡出淡入，视觉上就是纸换了一页。
     */
    const session = useQuizSession();
    const uiActions = useQuizUiActions();

    const previewing = $derived(session.isPreviewingNewQuestion);
    const question = $derived(
        previewing ? session.currentNewQuestion : session.currentQuestion,
    );
    const typeDef = $derived(
        question ? (QUESTION_TYPES[question.type] ?? null) : null,
    );

    /** 预览态：把「答案」当成用户的选择摊开，并锁死一切交互 */
    function previewShuffledOptions(q: Question) {
        return (
            q.options?.map((option, originalIndex) => ({
                ...option,
                originalIndex,
            })) ?? []
        );
    }

    function previewSelectedAnswers(q: Question): number[] {
        if (q.type === "judgment") return [(q.answer as boolean) ? 0 : 1];
        if (q.type === "single" || q.type === "multiple") {
            return [...(q.answer as number[])];
        }
        return [];
    }

    function previewBlankAnswerInputs(q: Question): string[] {
        if (q.type !== "blank") return [];
        return Array.isArray(q.answer)
            ? [...(q.answer as string[])]
            : [q.answer as string];
    }

    const inputProps = $derived.by<QuestionInputProps | null>(() => {
        if (!question) return null;

        if (previewing) {
            return {
                question,
                showResult: true,
                isCorrect: true,
                readonlyDisplayMode: "preview",
                autoSubmitOnSelection: false,
                shuffledOptions: previewShuffledOptions(question),
                selectedAnswers: previewSelectedAnswers(question),
                blankAnswerInputs: previewBlankAnswerInputs(question),
                onSelectedAnswersChange: () => {},
                onBlankAnswerInputsChange: () => {},
            };
        }

        return {
            question,
            showResult: session.showResult,
            isCorrect: session.isCorrect,
            autoSubmitOnSelection: session.globalSettings.autoSubmitOnSelection,
            shuffledOptions: session.shuffledOptions,
            selectedAnswers: session.selectedAnswers,
            blankAnswerInputs: session.blankAnswerInputs,
            onSelectedAnswersChange: (value) =>
                (session.selectedAnswers = value),
            onBlankAnswerInputsChange: (value) =>
                (session.blankAnswerInputs = value),
            onAutoSubmit: () => session.submit(),
        };
    });

    /** 换题（或进出预览态）才播过渡；同一道题里从「答题」到「出结果」不算换题 */
    const swapKey = $derived(`${session.presentationSeq}:${previewing}`);
</script>

{#if question && typeDef && inputProps}
    <SwapFade seq={swapKey}>
        <p
            class="text-foreground text-lg leading-relaxed font-medium whitespace-pre-wrap"
        >
            {question.question}
        </p>

        <div
            class={cn(
                "mt-6 flex flex-col gap-2.5",
                previewing && "pointer-events-none",
            )}
        >
            {#key question.type}
                {@const InputComponent = typeDef.Input}
                <InputComponent {...inputProps} />
            {/key}
        </div>
    </SwapFade>
{:else}
    <div
        class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-4 text-center"
    >
        {#if session.stats.total === 0}
            <span class="text-base">当前筛选条件下没有题目</span>
        {:else if session.stats.mastered === session.stats.total}
            {#if session.allMastered}
                <IconConfetti size={64} class="text-foreground opacity-30" />
                <span class="text-foreground text-lg font-bold mb-3">
                    所有题目已掌握
                </span>
                <Button onclick={uiActions.openReview}>
                    <IconCircleArrowUpRightFilled size={14} stroke={1.75} />
                    查看总览</Button
                >
                <ConfirmActionButton
                    variant="destructive"
                    size="xs"
                    onConfirm={() => session.reset()}
                    confirmClass="ring-destructive/40 ring-2"
                >
                    {#snippet children({ confirming })}
                        <IconRefresh size={14} stroke={1.75} />
                        {confirming ? "再次点击以清空进度" : "重新开始"}
                    {/snippet}
                </ConfirmActionButton>
            {:else}
                <IconInputCheck size={64} class="text-foreground opacity-30" />
                <span class="text-foreground text-lg font-bold mb-3">
                    当前题型筛选下所有题目已掌握
                </span>
                <Button onclick={() => session.setFilter("all")}>
                    <IconFilterMinus size={14} stroke={1.75} />
                    切换到全部题型
                </Button>
            {/if}
        {:else}
            <span class="text-sm">正在加载...</span>
        {/if}
    </div>
{/if}
