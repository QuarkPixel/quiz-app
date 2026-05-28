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
    import { Input } from "$lib/components/ui/input";
    import * as Dialog from "$lib/components/ui/dialog";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import { cn } from "$lib/utils";
    import { modKeyLabel } from "$lib/platform";
    import IconCircleHalf2 from "@tabler/icons-svelte/icons/circle-half-2";
    import IconCircleDot from "@tabler/icons-svelte/icons/circle-dot";
    import IconChecks from "@tabler/icons-svelte/icons/checks";
    import IconCursorText from "@tabler/icons-svelte/icons/cursor-text";
    import IconBook2 from "@tabler/icons-svelte/icons/book-2";
    import IconCircleCheck from "@tabler/icons-svelte/icons/circle-check";
    import IconCheck from "@tabler/icons-svelte/icons/check";
    import IconX from "@tabler/icons-svelte/icons/x";
    import IconStack2 from "@tabler/icons-svelte/icons/stack-2";
    import IconSettings from "@tabler/icons-svelte/icons/settings";

    import {
        PROGRESS_SIDE_CAP_PERCENT,
        SHORTCUTS,
        CONFIRM_TIMEOUT_MS,
        MASTERED_CELEBRATE_DURATION_MS,
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
        }, CONFIRM_TIMEOUT_MS);
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
    let allMastered = $derived.by(() => {
        if (questions.length === 0) return false;
        const masteredSet = new Set(appState.masteredIds);
        return questions.every((q) => masteredSet.has(q.id));
    });

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
            }, MASTERED_CELEBRATE_DURATION_MS);
        }
        prevMastered = m;
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
                {@const TypeIcon = typeIconFor(currentQuestion.type)}
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
                        <div
                            class="ml-auto flex items-center gap-1.5 p-1 bg-foreground/10 rounded-full"
                        >
                            {#each Array(requiredStreak) as _, i}
                                <span
                                    class={cn(
                                        "block size-1.5 rounded-full transition-colors",
                                        i < currentPoolItem.consecutiveCorrect
                                            ? currentPoolItem.hasEverMistaken
                                                ? "bg-warning"
                                                : "bg-success"
                                            : "bg-background",
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
                                onclick={() => toggleAnswer(opt.originalIndex)}
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
                        "[&_*]:transition-all [&_*]:duration-500 [&_*]:ease-spring",
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
