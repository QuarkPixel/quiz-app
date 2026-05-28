<script lang="ts">
    import { tick } from "svelte";
    import type {
        Question,
        QuestionType,
        Option,
        RuntimeState,
        ActivePoolItem,
        StoredState,
    } from "../types";
    import FlashContainer from "./FlashContainer.svelte";
    import ReviewView from "./ReviewView.svelte";
    import Settings from "./Settings.svelte";
    import PoolPanel from "./PoolPanel.svelte";
    import AlertToast from "./AlertToast.svelte";
    import StreakIndicator from "./StreakIndicator.svelte";
    import ProgressBar from "./ProgressBar.svelte";

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
        applyAnswer,
        reconcileAfterSettingsChange,
        rebuildRuntimeState,
        saveState,
        selectNextFromPool,
        shuffle,
    } from "../features/quiz";
    import {
        copyProgressToClipboard,
        readProgressFromClipboard,
        parseImportedProgress,
    } from "../features/quiz/progressActions";

    import { Button } from "$lib/components/ui/button";
    import * as Dialog from "$lib/components/ui/dialog";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import { cn } from "$lib/utils";
    import { modKeyLabel } from "$lib/platform";
    import { createConfirmAction } from "$lib/hooks/createConfirmAction.svelte";
    import { QUESTION_TYPES } from "../quiz/types/registry";
    import IconCircleCheck from "@tabler/icons-svelte/icons/circle-check";
    import IconBook2 from "@tabler/icons-svelte/icons/book-2";
    import IconStack2 from "@tabler/icons-svelte/icons/stack-2";
    import IconSettings from "@tabler/icons-svelte/icons/settings";

    import {
        SHORTCUTS,
        EXPORT_STATUS_SUCCESS_RESET_MS,
        EXPORT_STATUS_ERROR_RESET_MS,
    } from "../config";
    import type { Bank } from "../source/types";

    let { bank }: { bank: Bank } = $props();

    // bank 在外层用 {#key bank.hash} 控制重建，所以这里把 bank.* 当作不变量处理
    // svelte-ignore state_referenced_locally
    const questions: Question[] = bank.questions;
    // svelte-ignore state_referenced_locally
    const hash: string = bank.hash;
    const filterOptions = buildFilterOptions(questions);

    let appState = $state<RuntimeState>(loadRuntimeState(questions, hash));

    let currentQuestion = $state<Question | null>(null);
    let shuffledOptions = $state<(Option & { originalIndex: number })[]>([]);
    let selectedAnswers = $state<number[]>([]);
    let blankAnswerInputs = $state<string[]>([]);
    let showResult = $state(false);
    let isCorrect = $state(false);
    let flashContainer: FlashContainer;
    let toast: AlertToast;

    let showReview = $state(false);
    let showSettings = $state(false);
    let showPool = $state(false);

    let exportStatus = $state<"idle" | "copied" | "error">("idle");
    let importConfirmText = $state<string | null>(null);

    /**
     * submit 之前的 appState 快照。
     * 用于答错后用户点「当作正确」按钮：rewind 到 submit 前的状态再以 isCorrect=true 重跑，
     * 这样 hasEverMistaken 不会因为这次 typo 被打上、streak 自然 +1。
     */
    let preSubmitState: RuntimeState | null = null;

    const treatCorrectAction = createConfirmAction(() =>
        treatLastAnswerAsCorrect(),
    );

    function toggleProgressFocus(): void {
        if (stats.learning === 0) return;
        appState.ui.progressFocused = !appState.ui.progressFocused;
        saveState(hash, appState);
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
        saveState(hash, appState);
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
        preSubmitState = null;
        treatCorrectAction.reset();
        focusBlankInputIfNeeded();
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

        // 快照 submit 前的 state，用于 treatLastAnswerAsCorrect 的 rewind
        preSubmitState = appState;

        showResult = true;
        isCorrect = nextIsCorrect;

        flashContainer.flash(isCorrect);

        appState = applyAnswer(appState, currentQuestion.id, isCorrect);

        saveState(hash, appState);

        if (isCorrect && appState.settings.autoNextOnCorrect) {
            selectNextQuestion();
        }
    }

    function togglePool(): void {
        showPool = !showPool;
    }
    function toggleReview(): void {
        showReview = !showReview;
    }
    function toggleSettings(): void {
        showSettings = !showSettings;
    }
    function toggleAutoNext(): void {
        const next = !appState.settings.autoNextOnCorrect;
        appState.settings.autoNextOnCorrect = next;
        handlePreferenceChange();
        toast?.show(
            next ? "答对自动下一题已开启" : "答对自动下一题已关闭",
            next
                ? "答对后会立即进入下一题，无需手动点击。"
                : "答对后停留在结果页，按空格 / 回车继续。",
        );
    }

    async function handleExport(): Promise<void> {
        if (exportStatus !== "idle") return;
        const result = await copyProgressToClipboard(appState, hash);
        if (result.ok) {
            exportStatus = "copied";
            setTimeout(() => (exportStatus = "idle"), EXPORT_STATUS_SUCCESS_RESET_MS);
            toast?.show("进度已复制到剪贴板", "粘贴到任意位置即可备份。", "success");
        } else {
            exportStatus = "error";
            setTimeout(() => (exportStatus = "idle"), EXPORT_STATUS_ERROR_RESET_MS);
            toast?.show("导出失败", result.error, "destructive");
        }
    }

    async function handleImport(): Promise<void> {
        const result = await readProgressFromClipboard();
        if (!result.ok) {
            toast?.show("无法导入", result.error, "destructive");
            return;
        }
        importConfirmText = result.text;
    }

    async function commitImport(): Promise<void> {
        if (!importConfirmText) return;
        const text = importConfirmText;
        importConfirmText = null;
        const parsed = await parseImportedProgress(text, hash);
        if (!parsed.ok) {
            toast?.show("导入失败", parsed.error, "destructive");
            return;
        }
        onImport(parsed.state);
        toast?.show("进度已导入", "已覆盖当前进度。", "success");
    }

    function handleKeydown(event: KeyboardEvent): void {
        const isMod = event.metaKey || event.ctrlKey;

        // Cmd/Ctrl + 单键：全局快捷键。在输入框内不抢，让 Cmd+A 等浏览器默认生效。
        if (isMod && !event.altKey && !event.shiftKey && !isEditingTarget(event)) {
            const key = event.key.toLowerCase();
            // Cmd+B (sidebar) 留给 Sidebar context 处理
            if (key === SHORTCUTS.sidebar) return;
            if (key === SHORTCUTS.togglePool) {
                event.preventDefault();
                togglePool();
                return;
            }
            if (key === SHORTCUTS.toggleReview) {
                event.preventDefault();
                toggleReview();
                return;
            }
            if (key === SHORTCUTS.toggleSettings) {
                event.preventDefault();
                toggleSettings();
                return;
            }
            if (key === SHORTCUTS.toggleAutoNext) {
                event.preventDefault();
                toggleAutoNext();
                return;
            }
            if (key === SHORTCUTS.importProgress) {
                event.preventDefault();
                handleImport();
                return;
            }
            if (key === SHORTCUTS.exportProgress) {
                event.preventDefault();
                handleExport();
                return;
            }
            return;
        }

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
        } else {
            submitAnswer();
        }
    }

    function setFilterType(type: QuestionType | "all"): void {
        if (appState.filterType === type) return;
        appState = rebuildRuntimeState(questions, appState, type);
        appState = fillActivePool(appState);
        saveState(hash, appState);
        selectNextQuestion();
    }

    function handleAlgorithmChange(): void {
        const reconcileResult = reconcileAfterSettingsChange(
            questions,
            appState,
            currentQuestion?.id,
        );

        appState = reconcileResult.state;
        saveState(hash, appState);
    }

    function handlePreferenceChange(): void {
        saveState(hash, appState);
    }

    function handleReset(): void {
        appState = createResetRuntimeState(questions, hash);
        initialize();
    }

    function onImport(newState: StoredState): void {
        const stateWithPending: RuntimeState = {
            ...newState,
            pendingIds: [],
        };
        appState = rebuildRuntimeState(
            questions,
            stateWithPending,
            newState.filterType,
        );
        saveState(hash, appState);
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
        saveState(hash, appState);
        selectNextQuestion();
    }

    /**
     * 「当作正确」：把上次 submit 时记下的 preSubmitState 当起点，
     * 以 isCorrect=true 重新走 applyAnswer。这样：
     *   - consecutiveCorrect 从 submit 前的值 +1（而不是从 0 起）
     *   - hasEverMistaken 保持 submit 前的值（不会因为这次 typo 被打上）
     *   - currentRound 只前进一格（rewind 后只重跑一次）
     * 用户场景："这题我打错了，但我意思是对的"。
     */
    function treatLastAnswerAsCorrect(): void {
        if (!preSubmitState || !currentQuestion) return;
        appState = applyAnswer(preSubmitState, currentQuestion.id, true);
        preSubmitState = null;
        saveState(hash, appState);
        isCorrect = true;
        flashContainer.flash(true);
    }

    initialize();

    let stats = $derived(getStats(questions, appState));
    let currentTypeDef = $derived(
        currentQuestion ? QUESTION_TYPES[currentQuestion.type] : null,
    );
    let currentPoolItem = $derived<ActivePoolItem | undefined>(
        currentQuestion
            ? getActivePoolItem(appState, currentQuestion.id)
            : undefined,
    );
    let requiredStreak = $derived(
        currentPoolItem ? getRequiredStreak(currentPoolItem, appState) : 1,
    );
    let learningSegments = $derived(
        computeLearningSegments(questions, appState),
    );
    let allMastered = $derived.by(() => {
        if (questions.length === 0) return false;
        const masteredSet = new Set(appState.masteredIds);
        return questions.every((q) => masteredSet.has(q.id));
    });
</script>

<svelte:window onkeydown={handleKeydown} />

<FlashContainer bind:this={flashContainer} />
<AlertToast bind:this={toast} />

<main
    class="flex flex-1 min-h-0 items-center justify-center px-4 sm:px-6 overflow-y-auto"
>
    <div
        class={cn(
            "grid w-full max-w-5xl items-stretch justify-center transition-[grid-template-columns,grid-template-rows,gap] duration-[450ms] ease-emphasized",
            "grid-cols-[minmax(0,42rem)_0px] grid-rows-[auto_0px] gap-0",
            showPool && "max-lg:grid-rows-[auto_min(45vh,300px)] max-lg:gap-y-6",
            showPool && "lg:grid-cols-[minmax(0,42rem)_280px]",
        )}
    >
        <div class="flex w-full min-w-0 flex-col gap-5">
            {#if currentQuestion && (currentPoolItem || showResult)}
                {@const TypeIcon = QUESTION_TYPES[currentQuestion.type].icon}
                <div class="flex items-center gap-3">
                    <TypeIcon
                        size={16}
                        stroke={1.75}
                        class="text-muted-foreground"
                    />
                    <span class="text-muted-foreground text-xs font-mono">
                        {currentQuestion.id}
                    </span>

                    {#if currentPoolItem}
                        <div class="ml-auto">
                            <StreakIndicator
                                item={currentPoolItem}
                                {requiredStreak}
                                onMaster={markCurrentAsMastered}
                            />
                        </div>
                    {/if}
                </div>

                <p
                    class="text-foreground text-lg leading-relaxed font-medium whitespace-pre-wrap"
                >
                    {currentQuestion.question}
                </p>

                <div class="flex flex-col gap-2.5">
                    {#if currentTypeDef}
                        <currentTypeDef.Input
                            question={currentQuestion}
                            {showResult}
                            {isCorrect}
                            {shuffledOptions}
                            bind:selectedAnswers
                            bind:blankAnswerInputs
                            onAutoSubmit={submitAnswer}
                        />
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
                                    {currentPoolItem ? "回答正确" : "已掌握"}
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
                    {#if showResult && !isCorrect}
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
                    {#if !showResult}
                        <Button size="lg" class="px-8" onclick={submitAnswer}>
                            提交答案
                        </Button>
                    {:else if showResult}
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
                        <span class="text-base">当前筛选条件下没有题目</span>
                    {:else if stats.mastered === stats.total}
                        {#if allMastered}
                            <span class="text-foreground text-lg font-medium">
                                恭喜！所有题目已掌握
                            </span>
                            <Button variant="outline" onclick={handleReset}>
                                重新开始
                            </Button>
                        {:else}
                            <span class="text-foreground text-lg font-medium">
                                当前题型筛选下所有题目已掌握
                            </span>
                            <Button
                                variant="outline"
                                onclick={() => setFilterType("all")}
                            >
                                切换到全部题型
                            </Button>
                        {/if}
                    {:else}
                        <span class="text-sm">正在加载...</span>
                    {/if}
                </div>
            {/if}

            <ProgressBar
                {stats}
                {learningSegments}
                focused={appState.ui.progressFocused}
                onToggleFocus={toggleProgressFocus}
            />
        </div>

        <aside
            class={cn(
                "pool-edge-mask min-w-0 overflow-hidden",
                "row-start-2 col-start-1",
                "lg:row-start-1 lg:col-start-2 lg:flex lg:justify-end",
            )}
            aria-hidden={!showPool}
        >
            <div
                class={cn(
                    "flex h-full w-full flex-col",
                    "lg:h-[min(70vh,520px)] lg:w-[280px] lg:shrink-0 lg:pl-8",
                )}
            >
                <PoolPanel
                    {questions}
                    state={appState}
                    currentQuestionId={currentQuestion?.id ?? null}
                />
            </div>
        </aside>
    </div>
</main>

<footer
    class="flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5"
>
    <Tooltip.Root>
        <Tooltip.Trigger>
            {#snippet child({ props })}
                <button
                    {...props}
                    type="button"
                    class="text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:rotate-[30deg] aria-expanded:text-foreground"
                    aria-expanded={showSettings}
                    aria-label="当前题库设置"
                    onclick={toggleSettings}
                >
                    <IconSettings size={22} stroke={1.5} />
                </button>
            {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">
            <span>设置</span>
            <KbdGroup>
                <Kbd>{modKeyLabel}</Kbd>
                <Kbd>{SHORTCUTS.toggleSettings.toUpperCase()}</Kbd>
            </KbdGroup>
        </Tooltip.Content>
    </Tooltip.Root>

    <div class="flex items-center gap-1">
        <Tooltip.Root>
            <Tooltip.Trigger>
                {#snippet child({ props })}
                    <button
                        {...props}
                        type="button"
                        class={cn(
                            "text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:-rotate-[8deg]",
                            showPool && "text-foreground bg-foreground/8",
                        )}
                        aria-pressed={showPool}
                        aria-label="查看活动池"
                        onclick={togglePool}
                    >
                        <IconStack2 size={22} stroke={1.5} />
                    </button>
                {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">
                <span>{showPool ? "收起" : "展开"}活动池</span>
                <KbdGroup>
                    <Kbd>{modKeyLabel}</Kbd>
                    <Kbd>{SHORTCUTS.togglePool.toUpperCase()}</Kbd>
                </KbdGroup>
            </Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
            <Tooltip.Trigger>
                {#snippet child({ props })}
                    <button
                        {...props}
                        type="button"
                        class="text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:rotate-[10deg]"
                        aria-label="答案预览"
                        onclick={toggleReview}
                    >
                        <IconBook2 size={22} stroke={1.5} />
                    </button>
                {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">
                <span>答案预览</span>
                <KbdGroup>
                    <Kbd>{modKeyLabel}</Kbd>
                    <Kbd>{SHORTCUTS.toggleReview.toUpperCase()}</Kbd>
                </KbdGroup>
            </Tooltip.Content>
        </Tooltip.Root>
    </div>
</footer>

<Settings
    bind:open={showSettings}
    bind:appState
    {filterOptions}
    {exportStatus}
    onFilterChange={setFilterType}
    onReset={handleReset}
    onAlgorithmChange={handleAlgorithmChange}
    onPreferenceChange={handlePreferenceChange}
    onExport={handleExport}
    onImport={handleImport}
/>

<ReviewView
    {questions}
    filterType={appState.filterType}
    masteredIds={appState.masteredIds}
    open={showReview}
    onOpenChange={(o) => (showReview = o)}
/>

<!-- 导入确认 dialog（独立于 Settings） -->
<Dialog.Root
    open={importConfirmText !== null}
    onOpenChange={(open) => {
        if (!open) importConfirmText = null;
    }}
>
    <Dialog.Content class="max-w-sm">
        <Dialog.Header>
            <Dialog.Title>导入进度</Dialog.Title>
            <Dialog.Description>
                导入进度将覆盖当前所有进度，无法撤销，确定继续吗？
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
            <Button
                variant="outline"
                onclick={() => (importConfirmText = null)}
            >
                取消
            </Button>
            <Button onclick={commitImport}>导入</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<style>
    /* 大屏左右布局时给活动池左侧加渐变 mask，柔化裁切边。
       小屏上下布局时无需 mask（PoolPanel 自身顶/底有渐变）。 */
    @media (min-width: 64rem) {
        .pool-edge-mask {
            -webkit-mask-image: linear-gradient(
                to right,
                transparent 0,
                black 32px,
                black 100%
            );
            mask-image: linear-gradient(
                to right,
                transparent 0,
                black 32px,
                black 100%
            );
        }
    }
</style>
