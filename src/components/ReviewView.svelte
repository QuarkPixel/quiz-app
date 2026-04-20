<script lang="ts">
    // @ts-ignore
    import bookIconRaw from "../../icons/MaterialSymbolsBook5Rounded.svg?raw";
    import type { Question, QuestionType } from "../types";

    interface Props {
        questions: Question[];
        filterType: QuestionType | "all";
        onClose: () => void;
    }

    let { questions, filterType, onClose }: Props = $props();

    function getTypeName(type: QuestionType): string {
        switch (type) {
            case "judgment":
                return "判断题";
            case "single":
                return "单选题";
            case "multiple":
                return "多选题";
            case "blank":
                return "填空题";
        }
    }

    function getTypeColor(type: QuestionType): string {
        switch (type) {
            case "judgment":
                return "#6c757d";
            case "single":
                return "#007bff";
            case "multiple":
                return "#6f42c1";
            case "blank":
                return "#fd7e14";
        }
    }

    function getJudgmentAnswer(answer: boolean): string {
        return answer ? "正确 ✓" : "错误 ✗";
    }

    let filteredQuestions = $derived(
        filterType === "all"
            ? questions
            : questions.filter((q) => q.type === filterType),
    );

    // 按题型分组
    const typeOrder: QuestionType[] = [
        "judgment",
        "single",
        "multiple",
        "blank",
    ];

    let grouped = $derived(
        filterType !== "all"
            ? [{ type: filterType as QuestionType, items: filteredQuestions }]
            : typeOrder
                  .map((type) => ({
                      type,
                      items: filteredQuestions.filter((q) => q.type === type),
                  }))
                  .filter((g) => g.items.length > 0),
    );

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            onClose();
        }
    }

    function showModal(node: HTMLDialogElement) {
        node.showModal();
        return {
            destroy() {
                node.close();
            }
        };
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<dialog
    class="review-overlay"
    aria-label="答案预览"
    use:showModal
    onclick={(e) => {
        if (e.target === e.currentTarget) onClose();
    }}
>
    <div class="review-panel">
        <div class="review-header">
            <div class="review-title">
                <span class="review-icon">{@html bookIconRaw}</span>
                <h2>答案预览</h2>
                <span class="review-count">{filteredQuestions.length} 题</span>
            </div>
            <button class="close-btn" onclick={onClose} aria-label="关闭"
                >✕</button
            >
        </div>

        <div class="review-content">
            {#each grouped as group}
                <div class="type-section">
                    <div
                        class="type-heading"
                        style="--type-color: {getTypeColor(group.type)}"
                    >
                        <span class="type-badge">{getTypeName(group.type)}</span
                        >
                        <span class="type-count">{group.items.length} 题</span>
                    </div>

                    {#each group.items as question, idx}
                        <div class="question-item">
                            <div class="question-stem">
                                <span class="question-num">{idx + 1}.</span>
                                <span class="question-text"
                                    >{question.question}</span
                                >
                            </div>

                            {#if question.type === "judgment"}
                                <div class="answer-row">
                                    <span class="answer-label">答案：</span>
                                    <span
                                        class="answer-value judgment {question.answer ===
                                        true
                                            ? 'correct-true'
                                            : 'correct-false'}"
                                    >
                                        {getJudgmentAnswer(
                                            question.answer as boolean,
                                        )}
                                    </span>
                                </div>
                            {:else if question.type === "blank"}
                                <div class="answer-row">
                                    <span class="answer-label">答案：</span>
                                    <span class="answer-value blank-answer"
                                        >{question.answer as string}</span
                                    >
                                </div>
                            {:else if question.options}
                                {@const correctIndices =
                                    question.answer as number[]}
                                <div class="options-list">
                                    {#each question.options as opt, i}
                                        {@const isCorrect =
                                            correctIndices.includes(i)}
                                        <div
                                            class="option-row"
                                            class:is-correct={isCorrect}
                                        >
                                            <span
                                                class="opt-letter"
                                                class:correct-letter={isCorrect}
                                            >
                                                {String.fromCharCode(65 + i)}
                                            </span>
                                            <span
                                                class="opt-text"
                                                class:correct-text={isCorrect}
                                            >
                                                {opt.text}
                                            </span>
                                            {#if isCorrect}
                                                <span class="correct-mark"
                                                    >✓</span
                                                >
                                            {/if}
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            {/each}

            {#if filteredQuestions.length === 0}
                <div class="empty-state">当前筛选条件下没有题目</div>
            {/if}
        </div>
    </div>
</dialog>

<style>
    .review-overlay {
        position: fixed;
        inset: 0;
        margin: 0;
        width: 100%;
        height: 100%;
        max-width: 100%;
        max-height: 100%;
        border: none;
        background: rgba(0, 0, 0, 0.45);
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
        padding: 32px;
        box-sizing: border-box;
    }

    .review-overlay::backdrop {
        display: none;
    }

    .review-panel {
        width: 100%;
        max-width: 780px;
        height: 100%;
        max-height: 100%;
        background: #fff;
        border-radius: 16px;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.28);
        animation: scale-in 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
        overflow: hidden;
    }

    @media (prefers-color-scheme: dark) {
        .review-panel {
            background: #1e1e1e;
        }
    }

    @keyframes scale-in {
        from {
            transform: scale(0.96);
            opacity: 0;
        }
        to {
            transform: scale(1);
            opacity: 1;
        }
    }

    /* ── Header ── */
    .review-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 24px;
        border-bottom: 1px solid #e5e7eb;
        flex-shrink: 0;
    }

    @media (prefers-color-scheme: dark) {
        .review-header {
            border-bottom-color: #333;
        }
    }

    .review-title {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .review-icon {
        display: flex;
        align-items: center;
        color: #555;
    }

    .review-icon :global(svg) {
        width: 22px;
        height: 22px;
    }

    @media (prefers-color-scheme: dark) {
        .review-icon {
            color: #aaa;
        }
    }

    .review-title h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 700;
        color: #111;
    }

    @media (prefers-color-scheme: dark) {
        .review-title h2 {
            color: #f0f0f0;
        }
    }

    .review-count {
        font-size: 13px;
        color: #888;
        background: #f3f4f6;
        padding: 2px 10px;
        border-radius: 20px;
    }

    @media (prefers-color-scheme: dark) {
        .review-count {
            background: #2a2a2a;
            color: #aaa;
        }
    }

    .close-btn {
        width: 34px;
        height: 34px;
        border: none;
        background: #f3f4f6;
        border-radius: 50%;
        font-size: 15px;
        cursor: pointer;
        color: #555;
        display: flex;
        align-items: center;
        justify-content: center;
        transition:
            background 0.15s,
            color 0.15s;
        flex-shrink: 0;
    }

    .close-btn:hover {
        background: #e5e7eb;
        color: #111;
    }

    @media (prefers-color-scheme: dark) {
        .close-btn {
            background: #2a2a2a;
            color: #ccc;
        }
        .close-btn:hover {
            background: #3a3a3a;
            color: #fff;
        }
    }

    /* ── Scrollable content ── */
    .review-content {
        flex: 1;
        overflow-y: auto;
        padding: 24px;
        display: flex;
        flex-direction: column;
        gap: 32px;
    }

    /* ── Type section ── */
    .type-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .type-heading {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 4px;
        position: sticky;
        top: -24px;
        background: #fff;
        padding: 6px 0;
        z-index: 1;
    }

    @media (prefers-color-scheme: dark) {
        .type-heading {
            background: #1e1e1e;
        }
    }

    .type-badge {
        font-size: 13px;
        font-weight: 700;
        color: var(--type-color);
        border: 1.5px solid var(--type-color);
        border-radius: 12px;
        padding: 2px 12px;
        letter-spacing: 0.03em;
    }

    .type-count {
        font-size: 12px;
        color: #aaa;
    }

    /* ── Question item ── */
    .question-item {
        background: #f9fafb;
        border-radius: 10px;
        padding: 16px 18px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        border: 1px solid #e5e7eb;
    }

    @media (prefers-color-scheme: dark) {
        .question-item {
            background: #252525;
            border-color: #333;
        }
    }

    .question-stem {
        display: flex;
        gap: 8px;
        align-items: flex-start;
    }

    .question-num {
        font-size: 13px;
        color: #aaa;
        flex-shrink: 0;
        margin-top: 1px;
        font-variant-numeric: tabular-nums;
        min-width: 24px;
    }

    .question-text {
        font-size: 15px;
        font-weight: 600;
        color: #111;
        line-height: 1.65;
        flex: 1;
        white-space: pre-wrap;
    }

    @media (prefers-color-scheme: dark) {
        .question-text {
            color: #eee;
        }
    }

    /* ── Answer row (judgment / blank) ── */
    .answer-row {
        display: flex;
        align-items: center;
        gap: 6px;
        padding-left: 32px;
    }

    .answer-label {
        font-size: 12px;
        color: #aaa;
        flex-shrink: 0;
    }

    .answer-value {
        font-size: 14px;
        font-weight: 700;
    }

    .judgment.correct-true {
        color: #16a34a;
    }

    .judgment.correct-false {
        color: #dc2626;
    }

    @media (prefers-color-scheme: dark) {
        .judgment.correct-true {
            color: #4ade80;
        }
        .judgment.correct-false {
            color: #f87171;
        }
    }

    .blank-answer {
        color: #1d4ed8;
        letter-spacing: 0.03em;
    }

    @media (prefers-color-scheme: dark) {
        .blank-answer {
            color: #60a5fa;
        }
    }

    /* ── Options list (single / multiple) ── */
    .options-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-left: 32px;
    }

    .option-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 4px 6px;
        border-radius: 6px;
        transition: background 0.1s;
    }

    .option-row.is-correct {
        background: #f0fdf4;
    }

    @media (prefers-color-scheme: dark) {
        .option-row.is-correct {
            background: #14532d33;
        }
    }

    .opt-letter {
        font-size: 11px;
        font-weight: 700;
        color: #bbb;
        flex-shrink: 0;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #e5e7eb;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-top: 1px;
        transition:
            background 0.1s,
            color 0.1s;
    }

    @media (prefers-color-scheme: dark) {
        .opt-letter {
            background: #333;
            color: #888;
        }
    }

    .opt-letter.correct-letter {
        background: #16a34a;
        color: #fff;
    }

    .opt-text {
        font-size: 13px;
        color: #888;
        line-height: 1.55;
        flex: 1;
    }

    @media (prefers-color-scheme: dark) {
        .opt-text {
            color: #777;
        }
    }

    .opt-text.correct-text {
        font-size: 14px;
        font-weight: 700;
        color: #15803d;
    }

    @media (prefers-color-scheme: dark) {
        .opt-text.correct-text {
            color: #4ade80;
        }
    }

    .correct-mark {
        font-size: 14px;
        color: #16a34a;
        flex-shrink: 0;
        font-weight: 700;
        margin-top: 1px;
    }

    @media (prefers-color-scheme: dark) {
        .correct-mark {
            color: #4ade80;
        }
    }

    /* ── Empty ── */
    .empty-state {
        text-align: center;
        padding: 60px 20px;
        color: #aaa;
        font-size: 16px;
    }

    /* ── Mobile ── */
    @media (max-width: 600px) {
        .review-overlay {
            padding: 16px;
        }

        .review-panel {
            border-radius: 12px;
        }

        .review-content {
            padding: 16px;
        }

        .review-header {
            padding: 14px 16px;
        }
    }
</style>
