<script lang="ts">
    import SwapFade from "../shared/SwapFade.svelte";
    import { useMemorySession } from "@/features/memory/context";
    import { prefersReducedMotion } from "$lib/utils";
    import { slide } from "svelte/transition";
    import { circOut } from "svelte/easing";
    import { Tween } from "svelte/motion";

    /**
     * 记忆模式的滚动区内容：题干 + （答完之后）答案卡片。
     *
     * 与刷题模式的 `QuestionBody` 同一个位置、同一个换题过渡（`SwapFade`），
     * 区别只有两点：
     *   1. 题干字号会随「题干页 → 答案页」缩一档（`textReveal` 这个 Tween 逐帧插值，
     *      与答案卡片的 `slide` 共用同一条 `circOut`——CSS 的 timing-function 引用不了
     *      JS 缓动函数，想用同一条曲线就只能让 JS 驱动字号）；
     *   2. 答案卡片只在 `showResult` 之后才出现，并且是「滑开」而不是换页。
     *
     * 注意 `SwapFade` 换的是它内部那层 DOM，**组件本身不会重建**，所以 `textReveal`
     * 这个 Tween 是跨题共享的，换题时必须手动落位（见下面的 effect）。
     */
    const session = useMemorySession();

    /**
     * 字号档位：1 = 题干页（大字号），0 = 答案页（常规字号）。
     *
     * 这里用 Svelte 的 `Tween` 而不是 CSS transition，就是为了和答案卡片的 `slide`
     * 共用同一条缓动函数（`circOut`）：CSS 的 `transition-timing-function` 只接受
     * cubic-bezier / steps / linear()，没法直接引用一个 JS 缓动函数——想用同一个
     * 曲线就只能让 JS 来驱动字号（字号档位写在样式块里，响应式仍归 CSS）。
     *
     * **这个 Tween 是跨题共享的**：`SwapFade` 换的是它里面那层 DOM，组件本身没有
     * 重建。所以换题时必须手动把值「落位」，见下面的 effect。
     */
    const textReveal = new Tween(1, {
        duration: prefersReducedMotion ? 0 : 200,
        easing: circOut,
    });

    /**
     * 只有「同一次展示内部」（题干页 ↔ 答案页）才动画。
     *
     * 换题（`presentationSeq` 变了）时**直接落位、不做过渡**：新题的题干一出现就该是
     * 大字号，不能从小字号「长」上来——否则换题会同时播「缩放淡入」和「字号变大」
     * 两段动画，看着很乱。
     *
     * 用 `$effect.pre`：DOM 更新前就把值摆好，避免新题先以小字号闪一帧。
     */
    let lastSeq = session.presentationSeq;
    $effect.pre(() => {
        const seq = session.presentationSeq;
        const showing = session.showResult;

        if (seq !== lastSeq) {
            textReveal.set(showing ? 0 : 1, { duration: 0 });
            lastSeq = seq;
            return;
        }

        textReveal.target = showing ? 0 : 1;
    });

    /**
     * 答案卡片的滑入：高度也是动画出来的，所以下方按钮是被平滑「推」下去，
     * 而不是瞬移。只写 `in:`（没有 `out:`）——换下一题时答案块直接卸载，
     * 两道卡片之间不该有任何动画。
     */
    const answerSlide = prefersReducedMotion
        ? { duration: 0 }
        : { duration: 200, easing: circOut };

    /**
     * 答案卡片的配色档位：知道 = 中性、模糊 = 警示、忘记 = 红。
     *
     * `session.isCorrect` 把「模糊」也算作没答错（反馈音 / 闪烁按答对处理），
     * 所以配色不能只看 isCorrect——那样「模糊」和「知道」长得一模一样。
     */
    const answerTone = $derived(
        session.answerKind === "forget"
            ? "destructive"
            : session.answerKind === "fuzzy"
              ? "warning"
              : "neutral",
    );
</script>

<SwapFade seq={session.presentationSeq}>
    <!--
        题干 + 答案区。

        - `.question-stage` 给一段**会自己让路**的最小高度：宽裕时留出答案卡片要占的
          那块地方（卡片出现时整组高度不变，题面不会往上跳）；屏幕不够高时这段预留
          按 `100svh` 一路收到 0，不会留下一截「能滚但没内容」的空白
        - 字号由 `textReveal` 这个 Tween 按 `--reveal` 逐帧插值（1 = 题干页档位，
          0 = 答案页档位）
    -->
    <div class="question-stage flex flex-col gap-2.5">
        {#if session.currentQuestion}
            <p
                class="question-text text-foreground whitespace-pre-wrap"
                style:--reveal={textReveal.current}
            >
                {session.currentQuestion.question}
            </p>
        {/if}

        {#if session.showResult && session.currentQuestion && session.currentTypeDef}
            {@const InputComponent = session.currentTypeDef.Input}
            <div in:slide={answerSlide}>
                <InputComponent
                    question={session.currentQuestion}
                    showResult={session.showResult}
                    isCorrect={session.isCorrect}
                    {answerTone}
                    autoSubmitOnSelection={session.globalSettings
                        .autoSubmitOnSelection}
                    shuffledOptions={[]}
                    selectedAnswers={session.selectedAnswers}
                    blankAnswerInputs={[]}
                />
            </div>
        {/if}
    </div>
</SwapFade>

<style>
    /*
     * 答案卡片的预留高度。
     *
     * 它只在**空间宽裕**时才有意义（避免答案出现时整组高度变化 → 居中的题面往上跳）。
     * 屏幕不够高的时候，这段预留反而会变成「滚到底也什么都没有」的多余空间，
     * 所以用 `100svh` 减掉固定的外框（页头 ~6rem + 题号行 ~4rem + 操作条 ~3.25rem
     * + 进度条 ~2.6rem + 工具栏 ~3.25rem + 内边距 ≈ 20rem，再留 7rem 给题干），
     * 一路收到 0。纯 CSS，不量高度、也不会有「先渲染再纠正」的闪动。
     */
    .question-stage {
        min-height: 14rem;
    }

    @supports (height: 100svh) {
        .question-stage {
            min-height: clamp(0rem, calc(100svh - 27rem), 14rem);
        }
    }

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
