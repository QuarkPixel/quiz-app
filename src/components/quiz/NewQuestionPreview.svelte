<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import CopyQuestionButton from "./CopyQuestionButton.svelte";
    import StreakIndicator from "./StreakIndicator.svelte";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import type { Question } from "@/types";
    import type { ShuffledOption } from "@/quiz/types/types";
    import { useQuizSession } from "@/quiz/session/context";

    const session = useQuizSession();

    function previewShuffledOptions(question: Question): ShuffledOption[] {
        return (
            question.options?.map((option, originalIndex) => ({
                ...option,
                originalIndex,
            })) ?? []
        );
    }

    function previewSelectedAnswers(question: Question): number[] {
        if (question.type === "judgment") {
            return [(question.answer as boolean) ? 0 : 1];
        }
        if (question.type === "single" || question.type === "multiple") {
            return [...(question.answer as number[])];
        }
        return [];
    }

    function previewBlankAnswerInputs(question: Question): string[] {
        if (question.type !== "blank") return [];
        return Array.isArray(question.answer)
            ? [...(question.answer as string[])]
            : [question.answer as string];
    }
</script>

{#if session.currentNewQuestion}
    {@const question = session.currentNewQuestion}
    {@const typeDef = QUESTION_TYPES[question.type]}
    {@const TypeIcon = typeDef.icon}
    {@const InputComponent = typeDef.Input}
    <div class="flex items-center gap-3">
        <TypeIcon size={16} stroke={1.75} class="text-muted-foreground" />
        <div class="flex items-center gap-1 text-muted-foreground">
            <span class="text-xs font-mono">{question.id}</span>

            <CopyQuestionButton
                status={session.copyQuestionStatus}
                onclick={(event: MouseEvent) => {
                    event.stopPropagation();
                    void session.copyPreviewQuestion();
                }}
            />
        </div>

        <div class="ml-auto">
            <StreakIndicator
                variant="preview"
                onMaster={() => session.markPreviewQuestionAsMastered()}
            />
        </div>
    </div>

    <p
        class="text-foreground text-lg leading-relaxed font-medium whitespace-pre-wrap"
    >
        {question.question}
    </p>

    <div class="flex flex-col gap-2.5 pointer-events-none">
        <InputComponent
            {question}
            showResult={true}
            isCorrect={true}
            readonlyDisplayMode="preview"
            autoSubmitOnSelection={false}
            shuffledOptions={previewShuffledOptions(question)}
            selectedAnswers={previewSelectedAnswers(question)}
            blankAnswerInputs={previewBlankAnswerInputs(question)}
            onSelectedAnswersChange={() => {}}
            onBlankAnswerInputsChange={() => {}}
        />
    </div>

    <div class="flex h-9 items-center justify-end gap-2 pt-2">
        <Button
            size="lg"
            class="px-8"
            onclick={() => session.advanceQuestionFlow()}
        >
            我知道了
        </Button>
    </div>
{/if}
