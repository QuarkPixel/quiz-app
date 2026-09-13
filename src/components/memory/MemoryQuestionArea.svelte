<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import CopyQuestionButton from "../quiz/CopyQuestionButton.svelte";
    import StreakIndicator from "../quiz/StreakIndicator.svelte";
    import { useMemorySession } from "@/features/memory/context";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import IconCheck from "@tabler/icons-svelte/icons/check";
    import IconX from "@tabler/icons-svelte/icons/x";

    /**
     * 记忆模式的答题区：版式与单选题 `QuestionArea.svelte` 完全一致，
     * 只是把「选项」整块拿掉，并把「提交答案 / 视作正确」换成「知道 / 忘记」。
     *
     *   题干页：题型图标 + 题号 + 复制 + 连对指示器 / 大字号题干 / 两个按钮
     *   答案页：同样的头部 + 常规字号题干 + 答案卡片 / 底部按钮
     *
     * 点「知道」或「忘记」只做两件事：题干回到常规字号、展示答案。
     */
    const session = useMemorySession();

    const typeIcon = $derived(
        session.currentQuestion
            ? (QUESTION_TYPES[session.currentQuestion.type]?.icon ?? null)
            : null,
    );

    /** 只展示题干时放大，进入答案页回归常规字号 */
    const questionTextClass = $derived(
        session.showResult
            ? "text-lg leading-relaxed font-medium"
            : "text-2xl leading-snug font-semibold sm:text-3xl",
    );

    function pick(knows: boolean): void {
        if (session.showResult) return;
        session.selectedAnswers = [knows ? 1 : 0];
        session.submit();
    }
</script>

{#if session.currentQuestion}
    <div class="flex items-center gap-3">
        {#if typeIcon}
            {@const TypeIcon = typeIcon}
            <TypeIcon size={16} stroke={1.75} class="text-muted-foreground" />
        {/if}
        <div class="flex items-center gap-1 text-muted-foreground">
            <span class="text-xs font-mono">
                {session.currentQuestion.id}
            </span>
            <CopyQuestionButton
                status={session.copyQuestionStatus}
                onclick={() => void session.copyCurrentQuestion()}
            />
        </div>
        {#if session.currentPoolItem}
            <div class="ml-auto">
                <!-- 只展示连对进度：刷题模式那个「双击标记为已掌握」在记忆模式里
                     没有对应语义（掌握只能靠连对够次数毕业），所以传 readonly，
                     不给出会误导的掌握按钮 -->
                <StreakIndicator
                    item={session.currentPoolItem}
                    requiredStreak={session.requiredStreak}
                    maxLevel={session.requiredStreak}
                    readonly
                />
            </div>
        {/if}
    </div>

    <!-- 不在字号上做 transition：换下一题时内容是新的，做过渡会看起来像「从小变大」 -->
    <p class="text-foreground whitespace-pre-wrap {questionTextClass}">
        {session.currentQuestion.question}
    </p>

    <div class="flex flex-col gap-2.5">
        {#if session.showResult && session.currentTypeDef}
            {@const InputComponent = session.currentTypeDef.Input}
            <InputComponent
                question={session.currentQuestion}
                showResult={session.showResult}
                isCorrect={session.isCorrect}
                autoSubmitOnSelection={session.globalSettings
                    .autoSubmitOnSelection}
                shuffledOptions={[]}
                selectedAnswers={session.selectedAnswers}
                blankAnswerInputs={[]}
            />
        {/if}
    </div>

    <!-- 按钮区：与 QuestionArea 底部同一位置 -->
    <div class="flex h-9 items-center justify-end gap-2 pt-2">
        {#if !session.showResult}
            <Button
                variant="outline"
                size="lg"
                class="px-8"
                onclick={() => pick(false)}
            >
                <IconX size={16} stroke={2} />
                忘记
            </Button>
            <Button size="lg" class="px-8" onclick={() => pick(true)}>
                <IconCheck size={16} stroke={2} />
                知道
            </Button>
        {:else}
            {#if session.isCorrect}
                <!-- 选了「知道」：给一个反悔入口（一步到位，把这张改成答错） -->
                <Button
                    variant="outline"
                    size="lg"
                    class="px-8"
                    onclick={() => session.markAsWrong()}
                >
                    <IconX size={16} stroke={2} />
                    记错了
                </Button>
            {/if}
            <Button
                size="lg"
                class="px-8"
                onclick={() => session.advanceQuestionFlow()}
            >
                下一题
            </Button>
        {/if}
    </div>
{:else}
    <!-- 兜底：run !== "idle" 时正常都会同步选好题，这里只是防御性占位。
         「所有卡片都已掌握 / 重新开始」由首页与设置面板负责，不放这里 -->
    <div
        class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-4 text-center"
    >
        <span class="text-sm">正在加载...</span>
    </div>
{/if}
