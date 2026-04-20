<script lang="ts">
    import { tick } from "svelte";
    import "./app.css";
    import { questions } from "./questions";
    import type {
        Question,
        QuestionType,
        Option,
        RuntimeState,
        ActivePoolItem,
    } from "./types";
    import FlashContainer from "./components/FlashContainer.svelte";
    import ReviewView from "./components/ReviewView.svelte";
    import Settings from "./components/Settings.svelte";
    import QuestionFilters from "./components/QuestionFilters.svelte";
    import {
        buildFilterOptions,
        canSubmitCurrentAnswer,
        createResetRuntimeState,
        evaluateAnswer,
        fillActivePool,
        getActivePoolItem,
        getCorrectChoiceLetters,
        getRequiredStreak,
        getStats,
        getTypeName,
        isEditingTarget,
        loadRuntimeState,
        processAnswer,
        reconcileAfterSettingsChange,
        rebuildRuntimeState,
        saveState,
        selectNextFromPool,
        shuffle,
    } from "./features/quiz";

    // 动态导入 favicon SVG
    // @ts-ignore
    import faviconRaw from "../icons/MaterialSymbolsBookmarkCheckRounded.svg?raw";
    // @ts-ignore
    import bookIconRaw from "../icons/MaterialSymbolsBook5Rounded.svg?raw";
    const faviconUrl = `data:image/svg+xml,${encodeURIComponent(faviconRaw)}`;

    const filterOptions = buildFilterOptions(questions);

    function createInitialState(): RuntimeState {
        return loadRuntimeState(questions);
    }

    // 应用状态
    let appState = $state<RuntimeState>(createInitialState());

    // UI 状态
    let currentQuestion = $state<Question | null>(null);
    let shuffledOptions = $state<(Option & { originalIndex: number })[]>([]);
    let selectedAnswers = $state<number[]>([]);
    let blankAnswerInput = $state("");
    let showResult = $state(false);
    let isCorrect = $state(false);
    let flashContainer: FlashContainer;
    let blankInputElement = $state<HTMLInputElement | null>(null);
    let showReview = $state(false);

    function focusBlankInputIfNeeded(): void {
        if (currentQuestion?.type !== "blank") return;

        void tick().then(() => {
            blankInputElement?.focus();
        });
    }

    // 初始化活动池并选择第一题
    function initialize(): void {
        appState = fillActivePool(appState);
        saveState(appState);
        selectNextQuestion();
    }

    // 选择下一题
    function selectNextQuestion(): void {
        currentQuestion = selectNextFromPool(
            questions,
            appState,
            currentQuestion?.id,
        );

        if (currentQuestion?.options) {
            const optionsWithIndex = currentQuestion.options.map(
                (opt, idx) => ({
                    ...opt,
                    originalIndex: idx,
                }),
            );
            shuffledOptions = shuffle(optionsWithIndex);
        } else {
            shuffledOptions = [];
        }

        selectedAnswers = [];
        blankAnswerInput = "";
        showResult = false;
        isCorrect = false;
        focusBlankInputIfNeeded();
    }

    // 切换选项
    function toggleAnswer(originalIndex: number): void {
        if (showResult) return;

        if (
            currentQuestion?.type === "single" ||
            currentQuestion?.type === "judgment"
        ) {
            selectedAnswers = [originalIndex];
            submitAnswer();
        } else {
            if (selectedAnswers.includes(originalIndex)) {
                selectedAnswers = selectedAnswers.filter(
                    (i) => i !== originalIndex,
                );
            } else {
                selectedAnswers = [...selectedAnswers, originalIndex];
            }
        }
    }

    // 提交答案
    function submitAnswer(): void {
        if (
            !currentQuestion ||
            !canSubmitCurrentAnswer(
                currentQuestion,
                selectedAnswers,
                blankAnswerInput,
            )
        ) {
            return;
        }

        const nextIsCorrect = evaluateAnswer(
            currentQuestion,
            selectedAnswers,
            blankAnswerInput,
        );

        showResult = true;
        isCorrect = nextIsCorrect;

        // 触发背景闪烁
        flashContainer.flash(isCorrect);

        // 更新状态
        appState = processAnswer(appState, currentQuestion.id, isCorrect);

        // 如果掌握了，填充新题
        appState = fillActivePool(appState);

        saveState(appState);

        // 如果答对且开启了自动下一题，立即跳转
        if (isCorrect && appState.settings.autoNextOnCorrect) {
            selectNextQuestion();
        }
    }

    // 键盘事件
    function handleKeydown(event: KeyboardEvent): void {
        if (
            !(
                (event.code === "Space" && !isEditingTarget(event)) ||
                event.code === "Enter"
            )
        )
            return;

        event.preventDefault();
        if (showResult) {
            selectNextQuestion();
        } else if (
            currentQuestion?.type === "multiple" ||
            currentQuestion?.type === "blank"
        ) {
            submitAnswer();
        }
    }

    // 切换题型筛选
    function setFilterType(type: QuestionType | "all"): void {
        if (appState.filterType === type) return;
        appState = rebuildRuntimeState(questions, appState, type);
        appState = fillActivePool(appState);
        saveState(appState);
        selectNextQuestion();
    }

    // 参数变更后重建状态，保证活动池/统计/当前题一致
    function handleSettingsChange(): void {
        const reconcileResult = reconcileAfterSettingsChange(
            questions,
            appState,
            currentQuestion?.id,
        );

        appState = reconcileResult.state;
        saveState(appState);

        if (reconcileResult.shouldSelectNext) {
            selectNextQuestion();
        }
    }

    // 重置进度
    function handleReset(): void {
        if (confirm("确定要重置所有学习进度吗？")) {
            appState = createResetRuntimeState(questions);
            initialize();
        }
    }

    function markCurrentAsMastered(): void {
        if (!currentQuestion) return;

        if (!confirm("确定将本题直接标记为已掌握吗？")) return;

        const questionId = currentQuestion.id;
        const nextState: RuntimeState = {
            ...appState,
            activePool: [...appState.activePool],
            masteredIds: [...appState.masteredIds],
            pendingIds: [...appState.pendingIds],
        };

        const activeIndex = nextState.activePool.findIndex(
            (item) => item.id === questionId,
        );
        if (activeIndex !== -1) {
            nextState.activePool.splice(activeIndex, 1);
        }

        if (!nextState.masteredIds.includes(questionId)) {
            nextState.masteredIds.push(questionId);
        }

        nextState.pendingIds = nextState.pendingIds.filter(
            (id) => id !== questionId,
        );

        appState = fillActivePool(nextState);
        saveState(appState);
        selectNextQuestion();
    }

    // 初始化
    initialize();

    // 派生状态
    let stats = $derived(getStats(questions, appState));
    let currentPoolItem = $derived<ActivePoolItem | undefined>(
        currentQuestion
            ? getActivePoolItem(appState, currentQuestion.id)
            : undefined,
    );
    let requiredStreak = $derived(
        currentPoolItem ? getRequiredStreak(currentPoolItem, appState) : 1,
    );
    let canSubmitCurrent = $derived(
        canSubmitCurrentAnswer(
            currentQuestion,
            selectedAnswers,
            blankAnswerInput,
        ),
    );
    let masteredWidth = $derived(
        stats.total > 0 ? (stats.mastered / stats.total) * 100 : 0,
    );
    let learningWidth = $derived(
        stats.total > 0 ? (stats.learning / stats.total) * 100 : 0,
    );
    let pendingWidth = $derived(
        stats.total > 0 ? (stats.pending / stats.total) * 100 : 0,
    );
</script>

<svelte:head>
    <link rel="icon" type="image/svg+xml" href={faviconUrl} />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<!-- 闪烁层容器 -->
<FlashContainer bind:this={flashContainer} />

<main>
    <header>
        <h1>Quiz! app</h1>
        <QuestionFilters
            options={filterOptions}
            activeType={appState.filterType}
            onSelect={setFilterType}
        />
    </header>

    {#if currentQuestion && (currentPoolItem || showResult)}
        <div class="question-card">
            <div class="question-header">
                <span class="question-type"
                    >{getTypeName(currentQuestion.type)}</span
                >
                <span class="question-id">{currentQuestion.id}</span>

                <!-- 进度指示器 -->
                {#if currentPoolItem}
                    <div class="progress-indicator">
                        {#each Array(requiredStreak) as _, i}
                            <span
                                class="progress-dot"
                                class:filled={i <
                                    currentPoolItem.consecutiveCorrect}
                                class:error={currentPoolItem.hasEverMistaken}
                            ></span>
                        {/each}
                    </div>
                {/if}
            </div>

            <div class="question-text">{currentQuestion.question}</div>

            <div class="options">
                {#if currentQuestion.type === "judgment"}
                    <button
                        class="option"
                        class:selected={selectedAnswers.includes(0)}
                        class:correct={showResult &&
                            currentQuestion.answer === true}
                        class:wrong={showResult &&
                            selectedAnswers.includes(0) &&
                            currentQuestion.answer !== true}
                        onclick={() => toggleAnswer(0)}
                        disabled={showResult}
                    >
                        正确
                    </button>
                    <button
                        class="option"
                        class:selected={selectedAnswers.includes(1)}
                        class:correct={showResult &&
                            currentQuestion.answer === false}
                        class:wrong={showResult &&
                            selectedAnswers.includes(1) &&
                            currentQuestion.answer !== false}
                        onclick={() => toggleAnswer(1)}
                        disabled={showResult}
                    >
                        错误
                    </button>
                {:else if currentQuestion.type === "blank"}
                    <div class="blank-answer">
                        <input
                            class="blank-input"
                            type="text"
                            bind:value={blankAnswerInput}
                            bind:this={blankInputElement}
                            placeholder="根据中文默写英文词组"
                            autocomplete="off"
                            autocapitalize="off"
                            spellcheck="false"
                            disabled={showResult}
                        />
                    </div>
                {:else}
                    {#each shuffledOptions as opt, idx}
                        {@const correctAnswers =
                            currentQuestion.answer as number[]}
                        {@const isSelected = selectedAnswers.includes(
                            opt.originalIndex,
                        )}
                        {@const isOptionCorrect = correctAnswers.includes(
                            opt.originalIndex,
                        )}
                        {@const displayLetter = String.fromCharCode(65 + idx)}
                        <button
                            class="option"
                            class:selected={isSelected}
                            class:correct={showResult && isOptionCorrect}
                            class:wrong={showResult &&
                                isSelected &&
                                !isOptionCorrect}
                            onclick={() => toggleAnswer(opt.originalIndex)}
                            disabled={showResult}
                        >
                            <span class="option-letter">{displayLetter}</span>
                            <span class="option-text">{opt.text}</span>
                        </button>
                    {/each}
                {/if}
            </div>

            {#if showResult}
                <div
                    class="result"
                    class:correct={isCorrect}
                    class:wrong={!isCorrect}
                >
                    {#if isCorrect}
                        {#if !currentPoolItem}
                            已掌握！
                            {#if currentQuestion.type === "blank"}
                                <div class="correct-answer">
                                    {currentQuestion.answer}
                                </div>
                            {/if}
                        {:else}
                            回答正确
                            {#if currentQuestion.type === "blank"}
                                <div class="correct-answer">
                                    {currentQuestion.answer}
                                </div>
                            {/if}
                        {/if}
                    {:else}
                        回答错误
                        {#if currentQuestion.type === "blank"}
                            <div class="correct-answer">
                                正确答案: {currentQuestion.answer as string}
                            </div>
                        {:else if currentQuestion.type !== "judgment"}
                            <div class="correct-answer">
                                正确答案:
                                {getCorrectChoiceLetters(
                                    currentQuestion,
                                    shuffledOptions,
                                )}
                            </div>
                        {/if}
                    {/if}
                </div>
            {/if}

            <div class="actions">
                {#if !showResult && currentQuestion.type === "multiple"}
                    <button
                        class="btn-primary"
                        onclick={submitAnswer}
                        disabled={!canSubmitCurrent}
                    >
                        提交答案
                    </button>
                {:else if !showResult && currentQuestion.type === "blank"}
                    <button
                        class="btn-primary"
                        onclick={submitAnswer}
                        disabled={!canSubmitCurrent}
                    >
                        提交答案
                    </button>
                {:else if showResult}
                    <button class="btn-primary" onclick={selectNextQuestion}>
                        下一题
                    </button>
                    {#if currentPoolItem}
                        <button
                            class="btn-secondary btn-small"
                            onclick={markCurrentAsMastered}
                        >
                            已掌握
                        </button>
                    {/if}
                {/if}
            </div>
        </div>
    {:else}
        <div class="no-questions">
            {#if stats.total === 0}
                当前筛选条件下没有题目
            {:else if stats.mastered === stats.total}
                恭喜！所有题目已掌握！
            {:else}
                正在加载...
            {/if}
        </div>
    {/if}
    <!-- 进度条 -->
    <div class="progress-bar-container">
        <div class="progress-labels">
            <span class="label-left">{stats.mastered}</span>
            <span class="label-right">{stats.learning + stats.pending}</span>
        </div>
        <div class="progress-bar">
            <div
                class="progress-segment mastered"
                style="width: {masteredWidth}%"
            ></div>
            <div
                class="progress-segment learning"
                style="width: {learningWidth}%"
            ></div>
            <div
                class="progress-segment pending"
                style="width: {pendingWidth}%"
            ></div>
        </div>
    </div>

    <!-- 设置按钮 -->
    <Settings
        {appState}
        onReset={handleReset}
        onSettingsChange={handleSettingsChange}
    />

    <!-- 预览答案按钮 -->
    <button
        class="review-toggle"
        onclick={() => (showReview = true)}
        aria-label="答案预览"
        title="答案预览"
    >
        {@html bookIconRaw}
    </button>
</main>

<!-- 答案预览面板 -->
{#if showReview}
    <ReviewView
        questions={questions}
        filterType={appState.filterType}
        onClose={() => (showReview = false)}
    />
{/if}
