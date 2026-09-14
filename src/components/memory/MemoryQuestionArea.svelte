<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import CopyQuestionButton from "../quiz/CopyQuestionButton.svelte";
    import StreakIndicator from "../quiz/StreakIndicator.svelte";
    import { useMemorySession } from "@/features/memory/context";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import { prefersReducedMotion } from "$lib/utils";
    import { slide } from "svelte/transition";
    import { circOut } from "svelte/easing";
    import { Tween } from "svelte/motion";
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

    /**
     * 题干字号：1 = 题干页（大字号），0 = 答案页（常规字号）。
     *
     * 这里用 Svelte 的 `Tween` 而不是 CSS transition，就是为了和答案卡片的 `slide`
     * 共用同一条缓动函数（`circOut`）：CSS 的 `transition-timing-function` 只接受
     * cubic-bezier / steps / linear()，没法直接引用一个 JS 缓动函数——想用同一个
     * 曲线就只能让 JS 来驱动字号（字号档位写在组件的样式块里，响应式仍归 CSS）。
     */
    const textReveal = new Tween(1, {
        duration: prefersReducedMotion ? 0 : 200,
        easing: circOut,
    });

    // 只有在「同一次展示内部」（题干页 ↔ 答案页）才动画；
    // 换下一题 / 同一张卡被排回队尾重新出题时直接落位，否则又会看到「从小变大」。
    // 用 $effect.pre：DOM 更新前就把值摆好，避免新题先以小字号闪一帧。
    let lastSeq = session.presentationSeq;
    let lastShowResult = session.showResult;
    $effect.pre(() => {
        const seq = session.presentationSeq;
        const showing = session.showResult;

        if (seq !== lastSeq) {
            textReveal.set(1, { duration: 0 });
        } else if (showing !== lastShowResult) {
            textReveal.target = showing ? 0 : 1;
        }

        lastSeq = seq;
        lastShowResult = showing;
    });

    /**
     * 答案卡片的滑入：高度也是动画出来的，所以下方按钮是被平滑「推」下去，
     * 而不是瞬移。只写 `in:`（没有 `out:`）——换下一题时答案块直接卸载，
     * 两张卡片之间不该有任何动画。
     */
    const answerSlide = prefersReducedMotion
        ? { duration: 0 }
        : { duration: 200, easing: circOut };

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

    <!--
        题干 + 答案区。

        - `min-h-[6.5rem]`：给一段最小高度，短题干的卡片也占住答案将要出现的位置，
          一段答案之内的卡片展开时下方按钮完全不动（更长的答案由 slide 平滑推开）
        - 字号由 `textReveal` 这个 Tween 按 `--reveal` 逐帧插值（1 = 题干页档位，
          0 = 答案页档位），缓动与答案 slide 同为 `circOut`；换下一题 / 同一张卡被
          排回队尾重新出题时先把值落位再渲染，所以不会「从小变大」
    -->
    <div class="flex min-h-64 flex-col gap-2.5">
        {#key session.presentationSeq}
            <p
                class="question-text text-foreground whitespace-pre-wrap"
                style:--reveal={textReveal.current}
            >
                {session.currentQuestion.question}
            </p>
        {/key}

        {#if session.showResult && session.currentTypeDef}
            {@const InputComponent = session.currentTypeDef.Input}
            <div in:slide={answerSlide}>
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
            </div>
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

<style>
    /*
     * 题干字号的档位。--reveal 由组件里的 Tween 逐帧写入（1 = 题干页，0 = 答案页），
     * 这里只负责在两个档位之间插值——字号档位留在 CSS 里，响应式断点才不会跑到 JS 里。
     */
    .question-text {
        --question-font: 1.5rem; /* text-2xl */
        --question-line: 1.375; /* leading-snug */
        --answer-font: 1.125rem; /* text-lg */
        --answer-line: 1.625; /* leading-relaxed */

        font-size: calc(
            var(--answer-font) + (var(--question-font) - var(--answer-font)) *
                var(--reveal, 1)
        );
        line-height: calc(
            var(--answer-line) + (var(--question-line) - var(--answer-line)) *
                var(--reveal, 1)
        );
        /* 字重跟着一起走：600（题干页）→ 500（答案页） */
        font-weight: calc(500 + 100 * var(--reveal, 1));
    }

    @media (min-width: 40rem) {
        .question-text {
            --question-font: 1.875rem; /* sm:text-3xl */
        }
    }
</style>
