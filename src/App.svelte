<script lang="ts">
    import "./app.css";
    import { questions } from "./questions";
    import type {
        Question,
        QuestionType,
        Option,
        RuntimeState,
        ActivePoolItem,
    } from "./types";
    import {
        loadStoredState,
        saveState,
        resetStoredState,
        buildRuntimeState,
        getActivePoolItem,
    } from "./store";
    import {
        fillActivePool,
        selectNextFromPool,
        processAnswer,
        getStats,
        getRequiredStreak,
        shuffle,
    } from "./algorithm";
    import FlashContainer from "./FlashContainer.svelte";
    import Settings from "./Settings.svelte";

    // 动态导入 favicon SVG
    // @ts-ignore
    import faviconRaw from "../icons/MaterialSymbolsBookmarkCheckRounded.svg?raw";
    const faviconUrl = `data:image/svg+xml,${encodeURIComponent(faviconRaw)}`;

    // 应用状态
    let appState = $state<RuntimeState>(
        buildRuntimeState(questions, loadStoredState()),
    );

    // UI 状态
    let currentQuestion = $state<Question | null>(null);
    let shuffledOptions = $state<(Option & { originalIndex: number })[]>([]);
    let selectedAnswers = $state<number[]>([]);
    let showResult = $state(false);
    let isCorrect = $state(false);
    let flashContainer: FlashContainer;

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
        showResult = false;
        isCorrect = false;
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
        if (!currentQuestion || selectedAnswers.length === 0) return;

        showResult = true;

        // 检查答案
        if (currentQuestion.type === "judgment") {
            isCorrect = (selectedAnswers[0] === 0) === currentQuestion.answer;
        } else {
            const correctAnswers = currentQuestion.answer as number[];
            isCorrect =
                selectedAnswers.length === correctAnswers.length &&
                selectedAnswers.every((a) => correctAnswers.includes(a));
        }

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
        if (event.code === "Space" || event.code === "Enter") {
            event.preventDefault();
            if (showResult) {
                selectNextQuestion();
            } else if (
                selectedAnswers.length > 0 &&
                currentQuestion?.type === "multiple"
            ) {
                submitAnswer();
            }
        }
    }

    // 切换题型筛选
    function setFilterType(type: QuestionType | "all"): void {
        appState.filterType = type;
        appState = buildRuntimeState(questions, appState);
        appState = fillActivePool(appState);
        saveState(appState);
        selectNextQuestion();
    }

    // 重置进度
    function handleReset(): void {
        if (confirm("确定要重置所有学习进度吗？")) {
            appState = buildRuntimeState(questions, resetStoredState());
            initialize();
        }
    }

    // 获取题型名称
    function getTypeName(type: QuestionType): string {
        const names: Record<QuestionType, string> = {
            judgment: "判断题",
            single: "单选题",
            multiple: "多选题",
        };
        return names[type];
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
        <div class="filters">
            <button
                class:active={appState.filterType === "all"}
                onclick={() => setFilterType("all")}
            >
                全部
            </button>
            <button
                class:active={appState.filterType === "judgment"}
                onclick={() => setFilterType("judgment")}
            >
                判断题
            </button>
            <button
                class:active={appState.filterType === "single"}
                onclick={() => setFilterType("single")}
            >
                单选题
            </button>
            <button
                class:active={appState.filterType === "multiple"}
                onclick={() => setFilterType("multiple")}
            >
                多选题
            </button>
        </div>
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
                        {:else}
                            回答正确
                        {/if}
                    {:else}
                        回答错误
                        {#if currentQuestion.type !== "judgment"}
                            {@const correctAnswers =
                                currentQuestion.answer as number[]}
                            {@const correctLetters = correctAnswers
                                .map((origIdx) => {
                                    const pos = shuffledOptions.findIndex(
                                        (opt) => opt.originalIndex === origIdx,
                                    );
                                    return String.fromCharCode(65 + pos);
                                })
                                .sort()
                                .join("")}
                            <div class="correct-answer">
                                正确答案: {correctLetters}
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
                        disabled={selectedAnswers.length === 0}
                    >
                        提交答案
                    </button>
                {:else if showResult}
                    <button class="btn-primary" onclick={selectNextQuestion}>
                        下一题
                    </button>
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
                style="width: {(stats.mastered / stats.total) * 100}%"
            ></div>
            <div
                class="progress-segment learning"
                style="width: {(stats.learning / stats.total) * 100}%"
            ></div>
            <div
                class="progress-segment pending"
                style="width: {(stats.pending / stats.total) * 100}%"
            ></div>
        </div>
    </div>

    <!-- 设置按钮 -->
    <Settings {appState} onReset={handleReset} />
</main>
