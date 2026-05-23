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

    import {
        buildFilterOptions,
        canSubmitCurrentAnswer,
        computeLearningSegments,
        createResetRuntimeState,
        evaluateAnswer,
        fillActivePool,
        getActivePoolItem,
        getCorrectChoiceLetters,
        getRequiredStreak,
        getStats,
        isEditingTarget,
        loadRuntimeState,
        processAnswer,
        reconcileAfterSettingsChange,
        rebuildRuntimeState,
        saveState,
        selectNextFromPool,
        shuffle,
    } from "./features/quiz";

    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { cn } from "$lib/utils";
    import IconCircleHalf2 from "@tabler/icons-svelte/icons/circle-half-2";
    import IconCircleDot from "@tabler/icons-svelte/icons/circle-dot";
    import IconChecks from "@tabler/icons-svelte/icons/checks";
    import IconCursorText from "@tabler/icons-svelte/icons/cursor-text";
    import IconBook2 from "@tabler/icons-svelte/icons/book-2";
    import IconCircleCheck from "@tabler/icons-svelte/icons/circle-check";
    import IconCheck from "@tabler/icons-svelte/icons/check";
    import IconX from "@tabler/icons-svelte/icons/x";

    // @ts-ignore
    import faviconRaw from "../icons/icon.svg?raw";
    // @ts-ignore
    import logoRaw from "../icons/logo.svg?raw";
    import { PROGRESS_SIDE_CAP_PERCENT } from "./config";
    const faviconUrl = `data:image/svg+xml,${encodeURIComponent(faviconRaw)}`;

    const filterOptions = buildFilterOptions(questions);

    function createInitialState(): RuntimeState {
        const result = loadRuntimeState(questions);
        if (result.kind === "hash_mismatch") {
            setTimeout(() => {
                if (
                    confirm(
                        `检测到题库已更新\n\n存档数据可能不兼容，是否清空所有进度重新开始？`,
                    )
                ) {
                    appState = createResetRuntimeState(questions);
                    initialize();
                }
            }, 0);
        }
        return result.state;
    }

    let appState = $state<RuntimeState>(createInitialState());

    let currentQuestion = $state<Question | null>(null);
    let shuffledOptions = $state<(Option & { originalIndex: number })[]>([]);
    let selectedAnswers = $state<number[]>([]);
    let blankAnswerInputs = $state<string[]>([]);
    let showResult = $state(false);
    let isCorrect = $state(false);
    let flashContainer: FlashContainer;

    let showReview = $state(false);

    let progressFocused = $state(false);

    let masteredConfirming = $state(false);
    let masteredTimer: ReturnType<typeof setTimeout> | null = null;

    function resetMasteredConfirm(): void {
        if (masteredTimer) clearTimeout(masteredTimer);
        masteredTimer = null;
        masteredConfirming = false;
    }

    function handleMasteredClick(): void {
        if (masteredConfirming) {
            resetMasteredConfirm();
            markCurrentAsMastered();
            return;
        }
        masteredConfirming = true;
        if (masteredTimer) clearTimeout(masteredTimer);
        masteredTimer = setTimeout(() => {
            masteredConfirming = false;
            masteredTimer = null;
        }, 3000);
    }

    function toggleProgressFocus(): void {
        if (stats.learning === 0) return;
        progressFocused = !progressFocused;
    }

    function focusBlankInputIfNeeded(): void {
        if (currentQuestion?.type !== "blank") return;

        void tick().then(() => {
            const el = document.querySelector<HTMLInputElement>(
                ".blank-input:not(:disabled)",
            );
            el?.focus();
        });
    }

    function initialize(): void {
        appState = fillActivePool(appState);
        saveState(appState);
        selectNextQuestion();
    }

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
        const answerCount = Array.isArray(currentQuestion?.answer)
            ? (currentQuestion.answer as string[]).length
            : 1;
        blankAnswerInputs = Array(answerCount).fill("");

        showResult = false;
        isCorrect = false;
        resetMasteredConfirm();
        focusBlankInputIfNeeded();
    }

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

    function submitAnswer(): void {
        if (
            !currentQuestion ||
            !canSubmitCurrentAnswer(
                currentQuestion,
                selectedAnswers,
                blankAnswerInputs,
            )
        ) {
            return;
        }

        const nextIsCorrect = evaluateAnswer(
            currentQuestion,
            selectedAnswers,
            blankAnswerInputs,
        );

        showResult = true;
        isCorrect = nextIsCorrect;

        flashContainer.flash(isCorrect);

        appState = processAnswer(appState, currentQuestion.id, isCorrect);
        appState = fillActivePool(appState);

        saveState(appState);

        if (isCorrect && appState.settings.autoNextOnCorrect) {
            selectNextQuestion();
        }
    }

    function handleKeydown(event: KeyboardEvent): void {
        if (event.code !== "Space" && event.code !== "Enter") return;

        const target = event.target as HTMLElement | null;
        const inDialog = !!target?.closest('[role="dialog"]');
        const inBlankInput = !!target?.classList?.contains("blank-input");

        // L2: 设置 / 答案预览 dialog 内 — Enter 让输入框 blur 触发 onchange
        if (inDialog) {
            if (event.code === "Enter" && isEditingTarget(event)) {
                (target as HTMLInputElement).blur();
            }
            return;
        }

        // L1: 填空题输入框 — Enter 提交 / 下一题（Space 不抢，让浏览器打空格）
        if (inBlankInput) {
            if (event.code !== "Enter") return;
            event.preventDefault();
            if (showResult) selectNextQuestion();
            else submitAnswer();
            return;
        }

        // 其他编辑目标（兜底）：保留默认
        if (isEditingTarget(event)) return;

        // L3: 全局
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

    function setFilterType(type: QuestionType | "all"): void {
        if (appState.filterType === type) return;
        appState = rebuildRuntimeState(questions, appState, type);
        appState = fillActivePool(appState);
        saveState(appState);
        selectNextQuestion();
    }

    function handleAlgorithmChange(): void {
        const reconcileResult = reconcileAfterSettingsChange(
            questions,
            appState,
            currentQuestion?.id,
        );

        appState = reconcileResult.state;
        saveState(appState);
    }

    function handlePreferenceChange(): void {
        saveState(appState);
    }

    function handleReset(): void {
        appState = createResetRuntimeState(questions);
        initialize();
    }

    function handleImport(newState: import("./types").StoredState): void {
        const stateWithPending: import("./types").RuntimeState = {
            ...newState,
            pendingIds: [],
        };
        appState = rebuildRuntimeState(
            questions,
            stateWithPending,
            newState.filterType,
        );
        saveState(appState);
        selectNextQuestion();
    }

    function markCurrentAsMastered(): void {
        if (!currentQuestion) return;

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

    function typeIconFor(type: QuestionType) {
        switch (type) {
            case "judgment":
                return IconCircleHalf2;
            case "single":
                return IconCircleDot;
            case "multiple":
                return IconChecks;
            case "blank":
                return IconCursorText;
        }
    }

    initialize();

    let stats = $derived(getStats(questions, appState));
    let currentPoolItem = $derived<ActivePoolItem | undefined>(
        currentQuestion
            ? getActivePoolItem(appState, currentQuestion.id)
            : undefined,
    );
    let requiredStreak = $derived(
        currentPoolItem ? getRequiredStreak(currentPoolItem, appState) : 1,
    );
    let masteredWidth = $derived(
        stats.total > 0 ? (stats.mastered / stats.total) * 100 : 0,
    );
    let learningWidth = $derived(
        stats.total > 0 ? (stats.learning / stats.total) * 100 : 0,
    );
    let learningSegments = $derived(
        computeLearningSegments(questions, appState),
    );
    let pendingWidth = $derived(
        stats.total > 0 ? (stats.pending / stats.total) * 100 : 0,
    );

    let masteredDisplayWidth = $derived(
        progressFocused
            ? Math.min(masteredWidth * 16, PROGRESS_SIDE_CAP_PERCENT)
            : masteredWidth,
    );
    let pendingDisplayWidth = $derived(
        progressFocused
            ? Math.min(pendingWidth * 16, PROGRESS_SIDE_CAP_PERCENT)
            : pendingWidth,
    );
    let learningDisplayWidth = $derived(
        progressFocused
            ? Math.max(0, 100 - masteredDisplayWidth - pendingDisplayWidth)
            : learningWidth,
    );

    // svelte-ignore state_referenced_locally
    let prevMastered = stats.mastered;
    let masteredCelebrating = $state(false);
    let celebrateTimer: ReturnType<typeof setTimeout> | null = null;

    $effect(() => {
        const m = stats.mastered;
        if (m > prevMastered) {
            masteredCelebrating = true;
            if (celebrateTimer) clearTimeout(celebrateTimer);
            celebrateTimer = setTimeout(() => {
                masteredCelebrating = false;
                celebrateTimer = null;
            }, 700);
        }
        prevMastered = m;
    });
</script>

<svelte:head>
    <link rel="icon" type="image/svg+xml" href={faviconUrl} />
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<FlashContainer bind:this={flashContainer} />

<div class="flex min-h-screen flex-col">
    <header class="flex items-center justify-center px-5 py-5 sm:px-8 sm:py-6">
        <div
            class="text-muted-foreground [&_svg]:h-4 [&_svg]:w-auto"
            aria-label="Quiz! aPP."
        >
            {@html logoRaw}
        </div>
    </header>

    <main class="flex flex-1 items-center justify-center px-4 sm:px-6">
        <div class="flex w-full max-w-2xl flex-col gap-5">
            <div class="flex flex-col gap-5">
                {#if currentQuestion && (currentPoolItem || showResult)}
                    {@const TypeIcon = typeIconFor(currentQuestion.type)}
                    <div class="flex items-center gap-3">
                        <TypeIcon
                            size={16}
                            stroke={1.75}
                            class="text-muted-foreground"
                        />
                        <span
                            class="text-muted-foreground text-xs tabular-nums"
                        >
                            {currentQuestion.id}
                        </span>

                        {#if currentPoolItem}
                            <div class="ml-auto flex items-center gap-1.5">
                                {#each Array(requiredStreak) as _, i}
                                    <span
                                        class={cn(
                                            "block size-1.5 rounded-full transition-colors",
                                            i <
                                                currentPoolItem.consecutiveCorrect
                                                ? currentPoolItem.hasEverMistaken
                                                    ? "bg-warning"
                                                    : "bg-success"
                                                : "bg-foreground/25",
                                        )}
                                    ></span>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    <p
                        class="text-foreground text-lg leading-relaxed font-medium whitespace-pre-wrap"
                    >
                        {currentQuestion.question}
                    </p>

                    <div class="flex flex-col gap-2.5">
                        {#if currentQuestion.type === "judgment"}
                            {#each [{ idx: 0, label: "正确", value: true, icon: IconCheck }, { idx: 1, label: "错误", value: false, icon: IconX }] as opt}
                                {@const isSelected = selectedAnswers.includes(
                                    opt.idx,
                                )}
                                {@const isOptionCorrect =
                                    showResult &&
                                    currentQuestion.answer === opt.value}
                                {@const isWrong =
                                    showResult &&
                                    isSelected &&
                                    currentQuestion.answer !== opt.value}
                                {@const OptIcon = opt.icon}
                                <button
                                    type="button"
                                    class={cn(
                                        "border-border bg-background hover:bg-muted flex items-center gap-3 rounded-lg border px-4 py-3.5 text-left text-base transition-colors disabled:cursor-default",
                                        isSelected &&
                                            !showResult &&
                                            "border-foreground bg-muted",
                                        isOptionCorrect &&
                                            "border-success bg-success/8 text-success",
                                        isWrong &&
                                            "border-destructive bg-destructive/8 text-destructive",
                                    )}
                                    onclick={() => toggleAnswer(opt.idx)}
                                    disabled={showResult}
                                >
                                    <OptIcon size={18} stroke={2} />
                                    {opt.label}
                                </button>
                            {/each}
                        {:else if currentQuestion.type === "blank"}
                            <div class="flex flex-col gap-2.5">
                                {#each Array.isArray(currentQuestion.answer) ? currentQuestion.answer : [currentQuestion.answer] as _ans, i}
                                    <Input
                                        data-slot="input"
                                        class="blank-input h-12 px-4 text-base"
                                        value={blankAnswerInputs[i] ?? ""}
                                        oninput={(e) => {
                                            blankAnswerInputs[i] = (
                                                e.target as HTMLInputElement
                                            ).value;
                                        }}
                                        placeholder={Array.isArray(
                                            currentQuestion.answer,
                                        )
                                            ? `第 ${i + 1} 空`
                                            : "根据提示默写答案"}
                                        autocomplete="off"
                                        autocapitalize="off"
                                        spellcheck="false"
                                        disabled={showResult}
                                    />
                                {/each}
                            </div>
                        {:else}
                            {#each shuffledOptions as opt, idx}
                                {@const correctAnswers =
                                    currentQuestion.answer as number[]}
                                {@const isSelected = selectedAnswers.includes(
                                    opt.originalIndex,
                                )}
                                {@const isOptionCorrect =
                                    showResult &&
                                    correctAnswers.includes(opt.originalIndex)}
                                {@const isWrong =
                                    showResult &&
                                    isSelected &&
                                    !correctAnswers.includes(opt.originalIndex)}
                                {@const displayLetter = String.fromCharCode(
                                    65 + idx,
                                )}
                                <button
                                    type="button"
                                    class={cn(
                                        "border-border bg-background hover:bg-muted flex items-start gap-3 rounded-lg border px-4 py-3.5 text-left text-base transition-colors disabled:cursor-default",
                                        isSelected &&
                                            !showResult &&
                                            "border-foreground bg-muted",
                                        isOptionCorrect &&
                                            "border-success bg-success/8",
                                        isWrong &&
                                            "border-destructive bg-destructive/8",
                                    )}
                                    onclick={() =>
                                        toggleAnswer(opt.originalIndex)}
                                    disabled={showResult}
                                >
                                    <span
                                        class={cn(
                                            "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
                                            isOptionCorrect
                                                ? "bg-success text-success-foreground"
                                                : isWrong
                                                  ? "bg-destructive text-destructive-foreground"
                                                  : isSelected && !showResult
                                                    ? "bg-foreground text-background"
                                                    : "bg-foreground/10 text-muted-foreground",
                                        )}
                                    >
                                        {displayLetter}
                                    </span>
                                    <span
                                        class={cn(
                                            "flex-1 leading-relaxed",
                                            isOptionCorrect && "text-success",
                                            isWrong && "text-destructive",
                                        )}
                                    >
                                        {opt.text}
                                    </span>
                                </button>
                            {/each}
                        {/if}
                    </div>

                    <div class="h-[76px]">
                        {#if showResult}
                            <div
                                class={cn(
                                    "flex h-full flex-col items-center justify-center gap-1 rounded-lg px-4 text-center",
                                    isCorrect
                                        ? "bg-success/10 text-success"
                                        : "bg-destructive/10 text-destructive",
                                )}
                            >
                                <span class="text-base font-semibold">
                                    {#if isCorrect}
                                        {currentPoolItem
                                            ? "回答正确"
                                            : "已掌握"}
                                    {:else}
                                        回答错误
                                    {/if}
                                </span>
                                {#if currentQuestion.type === "blank"}
                                    <span class="text-sm font-normal">
                                        {#if !isCorrect}正确答案：{/if}{Array.isArray(
                                            currentQuestion.answer,
                                        )
                                            ? (
                                                  currentQuestion.answer as string[]
                                              ).join(" | ")
                                            : (currentQuestion.answer as string)}
                                    </span>
                                {:else if !isCorrect && currentQuestion.type !== "judgment"}
                                    <span class="text-sm font-normal">
                                        正确答案：{getCorrectChoiceLetters(
                                            currentQuestion,
                                            shuffledOptions,
                                        )}
                                    </span>
                                {/if}
                            </div>
                        {/if}
                    </div>

                    <div class="flex h-9 items-center justify-end gap-2 pt-2">
                        {#if !showResult && (currentQuestion.type === "multiple" || currentQuestion.type === "blank")}
                            <Button
                                size="lg"
                                class="px-8"
                                onclick={submitAnswer}
                            >
                                提交答案
                            </Button>
                        {:else if showResult}
                            <Button
                                variant="outline"
                                size="icon-lg"
                                onclick={handleMasteredClick}
                                disabled={!currentPoolItem}
                                title={masteredConfirming
                                    ? "再次点击以确认"
                                    : "标记为已掌握"}
                                aria-label={masteredConfirming
                                    ? "再次点击以确认"
                                    : "标记为已掌握"}
                                class={cn(
                                    masteredConfirming &&
                                        "border-success text-success ring-success/30 ring-2",
                                )}
                            >
                                <IconCircleCheck stroke={1.75} />
                            </Button>
                            <Button
                                size="lg"
                                class="px-8"
                                onclick={selectNextQuestion}
                            >
                                下一题
                            </Button>
                        {/if}
                    </div>
                {:else}
                    <div
                        class="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-4 text-center"
                    >
                        {#if stats.total === 0}
                            <span class="text-base">当前筛选条件下没有题目</span
                            >
                        {:else if stats.mastered === stats.total}
                            <span class="text-foreground text-lg font-medium">
                                恭喜！所有题目已掌握
                            </span>
                            <Button variant="outline" onclick={handleReset}>
                                重新开始
                            </Button>
                        {:else}
                            <span class="text-sm">正在加载...</span>
                        {/if}
                    </div>
                {/if}
            </div>

            <button
                type="button"
                class={cn(
                    "group focus-visible:outline-foreground block w-full h-[42px] cursor-pointer rounded-md py-1.5 text-left focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-default",
                    progressFocused && "focused",
                )}
                onclick={toggleProgressFocus}
                disabled={stats.learning === 0}
                aria-label={progressFocused ? "显示完整进度" : "聚焦学习中进度"}
            >
                <div
                    class="text-muted-foreground mb-1.5 flex justify-between text-xs tabular-nums"
                >
                    <span>{stats.mastered}</span>
                    <span>
                        {progressFocused
                            ? stats.pending
                            : stats.learning + stats.pending}
                    </span>
                </div>
                <div
                    class={cn(
                        "progress-bar flex h-[3px] gap-1 transition-all duration-300",
                        "[&_*]:transition-all [&_*]:duration-700 [&_*]:ease-[cubic-bezier(0.32,1.3,0.41,1)]",
                        progressFocused && "h-[7px]",
                    )}
                >
                    <div
                        class={cn(
                            "mastered-segment bg-success rounded-sm",
                            progressFocused && "opacity-55",
                            masteredCelebrating && "celebrate",
                        )}
                        style="--w: {masteredDisplayWidth}%; --focused: {progressFocused
                            ? 1
                            : 0}"
                    ></div>
                    <div
                        class="flex overflow-hidden rounded-sm"
                        style="width: {learningDisplayWidth}%"
                    >
                        {#each learningSegments as seg}
                            <div
                                style="width: {seg.widthPercent}%; background: {seg.color}"
                            ></div>
                        {/each}
                    </div>
                    <div
                        class={cn(
                            "bg-foreground/15 rounded-sm",
                            progressFocused && "opacity-55",
                        )}
                        style="width: {pendingDisplayWidth}%"
                    ></div>
                </div>
            </button>
        </div>
    </main>

    <footer class="flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        <Settings
            bind:appState
            {filterOptions}
            onFilterChange={setFilterType}
            onReset={handleReset}
            onAlgorithmChange={handleAlgorithmChange}
            onPreferenceChange={handlePreferenceChange}
            onImport={handleImport}
        />
        <button
            type="button"
            class="text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:rotate-[10deg]"
            onclick={() => (showReview = true)}
            aria-label="答案预览"
            title="答案预览"
        >
            <IconBook2 size={22} stroke={1.5} />
        </button>
    </footer>
</div>

<ReviewView
    {questions}
    filterType={appState.filterType}
    masteredIds={appState.masteredIds}
    bind:open={showReview}
    onOpenChange={(o) => (showReview = o)}
/>

<style>
    .group:not(:disabled):hover .progress-bar {
        height: 4px;
    }
    .group.focused:not(:disabled):hover .progress-bar {
        height: 8px;
    }

    .mastered-segment {
        --offset: 0;
        width: var(--w);
        transform-origin: left center;
        will-change: transform, filter;
    }
    .mastered-segment.celebrate {
        animation: mastered-celebrate 700ms cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes mastered-celebrate {
        0% {
            filter: brightness(1) saturate(1);
        }
        35% {
            /* 只有在聚焦状态下才变换长度 */
            width: calc(var(--w) + (5% * var(--focused)));
            filter: brightness(1.45) saturate(1.3);
        }
        100% {
            filter: brightness(1) saturate(1);
        }
    }
</style>
