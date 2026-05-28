<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import { cn } from "$lib/utils";
    import { createConfirmAction } from "$lib/hooks/createConfirmAction.svelte";
    import IconCircleCheck from "@tabler/icons-svelte/icons/circle-check";
    import StreakIndicator from "./StreakIndicator.svelte";
    import { QUESTION_TYPES } from "../quiz/types/registry";
    import { getCorrectChoiceLetters } from "../features/quiz";
    import { useQuizSession } from "../quiz/session/context";

    const session = useQuizSession();

    const treatCorrectAction = createConfirmAction(() =>
        session.treatLastAnswerAsCorrect(),
    );
</script>

{#if session.currentQuestion && (session.currentPoolItem || session.showResult)}
    {@const TypeIcon = QUESTION_TYPES[session.currentQuestion.type].icon}
    <div class="flex items-center gap-3">
        <TypeIcon
            size={16}
            stroke={1.75}
            class="text-muted-foreground"
        />
        <span class="text-muted-foreground text-xs font-mono">
            {session.currentQuestion.id}
        </span>

        {#if session.currentPoolItem}
            <div class="ml-auto">
                <StreakIndicator
                    item={session.currentPoolItem}
                    requiredStreak={session.requiredStreak}
                    onMaster={() => session.markCurrentAsMastered()}
                />
            </div>
        {/if}
    </div>

    <p
        class="text-foreground text-lg leading-relaxed font-medium whitespace-pre-wrap"
    >
        {session.currentQuestion.question}
    </p>

    <div class="flex flex-col gap-2.5">
        {#if session.currentTypeDef}
            <!-- {#key} 让 type 切换时 Input 整体 unmount/remount，
                 避免 svelte dynamic component 在类型变化时重用旧实例 -->
            {#key session.currentQuestion.type}
                {@const InputComponent = session.currentTypeDef.Input}
                <InputComponent
                    question={session.currentQuestion}
                    showResult={session.showResult}
                    isCorrect={session.isCorrect}
                    shuffledOptions={session.shuffledOptions}
                    selectedAnswers={session.selectedAnswers}
                    blankAnswerInputs={session.blankAnswerInputs}
                    onSelectedAnswersChange={(v) =>
                        (session.selectedAnswers = v)}
                    onBlankAnswerInputsChange={(v) =>
                        (session.blankAnswerInputs = v)}
                    onAutoSubmit={() => session.submit()}
                />
            {/key}
        {/if}
    </div>

    <div class="h-[76px]">
        {#if session.showResult}
            <div
                class={cn(
                    "flex h-full flex-col items-center justify-center gap-1 rounded-lg px-4 text-center",
                    session.isCorrect
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive",
                )}
            >
                <span class="text-base font-semibold">
                    {#if session.isCorrect}
                        {session.currentPoolItem ? "回答正确" : "已掌握"}
                    {:else}
                        回答错误
                    {/if}
                </span>
                {#if session.currentQuestion.type === "blank"}
                    <span class="text-sm font-normal">
                        {#if !session.isCorrect}正确答案：{/if}{Array.isArray(
                            session.currentQuestion.answer,
                        )
                            ? (
                                  session.currentQuestion.answer as string[]
                              ).join(" | ")
                            : (session.currentQuestion.answer as string)}
                    </span>
                {:else if !session.isCorrect && session.currentQuestion.type !== "judgment"}
                    <span class="text-sm font-normal">
                        正确答案：{getCorrectChoiceLetters(
                            session.currentQuestion,
                            session.shuffledOptions,
                        )}
                    </span>
                {/if}
            </div>
        {/if}
    </div>

    <div class="flex h-9 items-center justify-end gap-2 pt-2">
        {#if session.showResult && !session.isCorrect}
            <Button
                variant="outline"
                size="icon-lg"
                onclick={treatCorrectAction.trigger}
                title={treatCorrectAction.confirming
                    ? "再次点击确认当作正确"
                    : "我打错了，当作正确"}
                aria-label={treatCorrectAction.confirming
                    ? "再次点击确认当作正确"
                    : "我打错了，当作正确"}
                class={cn(
                    treatCorrectAction.confirming &&
                        "border-success text-success ring-success/30 ring-2",
                )}
            >
                <IconCircleCheck stroke={1.75} />
            </Button>
        {/if}
        {#if !session.showResult}
            <Button size="lg" class="px-8" onclick={() => session.submit()}>
                提交答案
            </Button>
        {:else}
            <Button
                size="lg"
                class="px-8"
                onclick={() => session.selectNext()}
            >
                下一题
            </Button>
        {/if}
    </div>
{:else}
    <div
        class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-4 text-center"
    >
        {#if session.stats.total === 0}
            <span class="text-base">当前筛选条件下没有题目</span>
        {:else if session.stats.mastered === session.stats.total}
            {#if session.allMastered}
                <span class="text-foreground text-lg font-medium">
                    恭喜！所有题目已掌握
                </span>
                <Button variant="outline" onclick={() => session.reset()}>
                    重新开始
                </Button>
            {:else}
                <span class="text-foreground text-lg font-medium">
                    当前题型筛选下所有题目已掌握
                </span>
                <Button
                    variant="outline"
                    onclick={() => session.setFilter("all")}
                >
                    切换到全部题型
                </Button>
            {/if}
        {:else}
            <span class="text-sm">正在加载...</span>
        {/if}
    </div>
{/if}
