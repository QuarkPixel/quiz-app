<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import { cn, prefersReducedMotion } from "$lib/utils";
    import { getCorrectChoiceLetters } from "@/features/quiz";
    import { useQuizSession } from "@/quiz/session/context";
    import { slide } from "svelte/transition";
    import { circOut } from "svelte/easing";
    import IconCircleCheck from "@tabler/icons-svelte/icons/circle-check";
    import IconCircleCheckFilled from "@tabler/icons-svelte/icons/circle-check-filled";
    import IconCircleDashedCheck from "@tabler/icons-svelte/icons/circle-dashed-check";
    import IconCircleDashedX from "@tabler/icons-svelte/icons/circle-dashed-x";
    import IconDiscountCheck from "@tabler/icons-svelte/icons/rosette-discount-check";

    /**
     * 底部固定区的第一行：对错反馈条 + 操作按钮。
     *
     * 反馈条从滚动区里搬到了这里——它回答的是「刚才那一下对不对」，
     * 而滚动区只剩题面与作答，答完把结论推到视线正下方比留在题干末尾更近。
     *
     * 换题时它跟着卸载（`showResult` 归位），所以不需要 `out` 过渡：
     * 两道题之间不该出现「上一条反馈滑走」的画面。
     */
    const session = useQuizSession();

    const previewing = $derived(session.isPreviewingNewQuestion);
    const showFeedback = $derived(!previewing && session.showResult);
    /**
     * 屏上根本没有题（空状态 / 全部掌握）时整块不渲染。
     * 否则「提交答案」会孤零零地挂在空状态下面——它没有可提交的东西。
     */
    const hasQuestion = $derived(
        previewing || session.currentQuestion !== null,
    );
    const slideIn = prefersReducedMotion
        ? { duration: 0 }
        : { duration: 180, easing: circOut };
</script>

{#if hasQuestion}
    <!--
        反馈条的位置**常驻**（`.feedback-slot` 自带高度），里面的内容才是条件渲染的。

        为什么不让整个槽跟着 `showFeedback` 一起出现 / 消失：
        紧凑版面下（内容放得下、整体居中、不滚动）反馈条一出现就会把
        「提交答案」和整组内容顶上去，一题一跳；预留出这段高度后，答完只是
        槽里长出内容，别处一动不动。

        反过来，内容超出、上下已经固定住的时候，这段预留就是纯浪费——它会把可滚
        区域压矮一截，还可能留下「能滚但没内容」的空白。**但「可不可滚」不能拿来
        当这个开关**：预留本身会改变滚动区的高度，于是「可滚 → 收预留 → 不可滚 →
        加预留 → 可滚」在同一点上互相触发，窗口高度刚好卡在那一段时整块 UI 会
        高频抽搐，控制台刷满 `ResizeObserver loop completed with undelivered
        notifications`。所以改成按视口高度用 `clamp` 一路收到 0（见样式块），
        和 `.question-stage` 是同一套办法：纯 CSS、没有反馈回路。
    -->
    <div class="feedback-slot" data-slot="quiz-feedback">
        {#if showFeedback}
            <div in:slide={slideIn} class="overflow-hidden">
                <div
                    class={cn(
                        "relative mb-1 flex h-16 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg px-4 text-center",
                        session.isCorrect
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive",
                    )}
                    role="status"
                >
                    <span class="text-base font-semibold">
                        {#if session.isCorrect}
                            {session.currentPoolItem ? "回答正确" : "已掌握"}
                        {:else}
                            回答错误
                        {/if}
                    </span>
                    {#if session.currentQuestion?.type === "blank"}
                        <span class="text-sm font-normal">
                            {#if !session.isCorrect}正确答案：{/if}{Array.isArray(
                                session.currentQuestion.answer,
                            )
                                ? (
                                      session.currentQuestion.answer as string[]
                                  ).join(" | ")
                                : (session.currentQuestion.answer as string)}
                        </span>
                    {:else if !session.isCorrect && session.currentQuestion && session.currentQuestion.type !== "judgment"}
                        <span class="text-sm font-normal">
                            正确答案：{getCorrectChoiceLetters(
                                session.currentQuestion,
                                session.shuffledOptions,
                            )}
                        </span>
                    {/if}

                    <div
                        class="pointer-events-none absolute -bottom-6 left-[calc(50%+72px)] rotate-10 opacity-20 *:size-24"
                    >
                        {#if session.isCorrect}
                            {#if session.currentPoolItem}
                                <IconCircleDashedCheck />
                            {:else}
                                <IconDiscountCheck />
                            {/if}
                        {:else}
                            <IconCircleDashedX />
                        {/if}
                    </div>
                </div>
            </div>
        {/if}
    </div>

    <div class="flex min-h-11 items-center justify-end gap-2">
        {#if previewing}
            <Button
                size="lg"
                class="px-8"
                onclick={() => session.advanceQuestionFlow()}
            >
                我知道了
            </Button>
        {:else if session.showResult}
            {#if !session.isCorrect}
                <ConfirmActionButton
                    variant="outline"
                    size="icon-lg"
                    onConfirm={() => session.treatLastAnswerAsCorrect()}
                    idleTitle="视作正确"
                    confirmTitle="再次点击确认"
                    idleAriaLabel="视作正确"
                    confirmAriaLabel="再次点击确认"
                    confirmClass="border-success text-success ring-success/30 ring-2"
                >
                    {#snippet children({ confirming })}
                        {#if confirming}
                            <IconCircleCheckFilled stroke={1.75} />
                        {:else}
                            <IconCircleCheck stroke={1.75} />
                        {/if}
                    {/snippet}
                </ConfirmActionButton>
            {/if}
            <Button
                size="lg"
                class="px-8"
                onclick={() => session.advanceQuestionFlow()}
            >
                下一题
            </Button>
        {:else}
            <Button size="lg" class="px-8" onclick={() => session.submit()}>
                提交答案
            </Button>
        {/if}
    </div>
{/if}

<style>
    /*
     * 反馈条的常驻占位：`h-16`(4rem) + `mb-1`(0.25rem)。
     *
     * 用 `clamp` 按视口高度自己让路，**不看「当前可不可滚」**——那个判据和这段
     * 预留会互相触发（预留改变滚动区高度 → 改变「可不可滚」→ 改变预留），
     * 卡在临界高度上就是无限抖动。这里减掉的 30rem 是固定外框（页头、题号行、
     * 按钮行、进度条、工具栏、内边距）+ 留给题面的最小高度，屏幕再矮这段预留
     * 就一路收到 0，一点不留。
     */
    .feedback-slot {
        min-height: 4.25rem;
    }

    @supports (height: 100svh) {
        .feedback-slot {
            min-height: clamp(0rem, calc(100svh - 30rem), 4.25rem);
        }
    }
</style>
