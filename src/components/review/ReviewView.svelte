<script lang="ts">
    import { tick } from "svelte";
    import type { Question } from "@/types";
    import {
        getRequiredStreak,
        hasEverMistakenQuestion,
    } from "@/features/quiz";
    import { getAvailableQuestionTypes } from "@/features/quiz/filters";
    import {
        getLearningLevelColor,
        getMaxLearningLevel,
    } from "@/features/quiz/learningProgress";
    import {
        applyReviewFilter,
        createReviewFilterState,
        describeFilter,
        type ReviewFilterState,
    } from "@/features/quiz/reviewFilters";
    import { useQuizSource } from "@/source/context";
    import type { ToastVariant } from "@/quiz/session/QuizSession.svelte";
    import * as Card from "$lib/components/ui/card";
    import * as Dialog from "$lib/components/ui/dialog";
    import {
        QUESTION_TYPES,
        QUESTION_TYPE_ORDER,
    } from "@/quiz/types/registry";
    import { useQuizSession } from "@/quiz/session/context";
    import HeatmapSection from "./HeatmapSection.svelte";
    import QuestionListSection from "./QuestionListSection.svelte";
    import ReviewFilterBar from "./ReviewFilterBar.svelte";
    import {
        IconInnerShadowTopLeft,
        IconProgressCheck,
        IconTargetArrow,
    } from "@tabler/icons-svelte";
    import { isCoarsePointer } from "$lib/utils";
    import type {
        QuestionGroup,
        ReviewIndicator,
    } from "./virtualList/types";

    interface Props {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        onToast?: (title: string, description?: string, variant?: ToastVariant) => void;
    }

    let { open, onOpenChange, onToast }: Props = $props();

    const session = useQuizSession();
    const source = useQuizSource();

    let filter = $state<ReviewFilterState>(createReviewFilterState());
    let searchTerm = $state("");
    let selectedQuestionId = $state<string | null>(null);
    let jumpTargetId = $state<string | null>(null);
    let searchInputRef: HTMLInputElement | null = $state(null);

    $effect(() => {
        if (!open) {
            searchTerm = "";
            filter = createReviewFilterState();
        }
    });

    const masteredSet = $derived(new Set(session.appState.masteredIds));
    const activePoolById = $derived(
        new Map(session.appState.activePool.map((item) => [item.id, item])),
    );
    const masteredQuestions = $derived(
        session.questions.filter((q) => masteredSet.has(q.id)),
    );
    const maxLearningLevel = $derived(getMaxLearningLevel(session.appState));

    function normalizeSearchText(value: string): string {
        return value.trim().toLocaleLowerCase();
    }

    function matchesSearch(question: Question, query: string): boolean {
        if (query.length === 0) return true;
        const typeDef = QUESTION_TYPES[question.type];
        return [
            question.id,
            question.question,
            typeDef.formatAnswerText(question),
        ].some((text) => text.toLocaleLowerCase().includes(query));
    }

    const overview = $derived.by(() => {
        const hash = session.hash;
        const total = session.questions.length;
        const mastered = masteredQuestions.length;
        const active = session.appState.activePool.length;
        const unlearned = Math.max(0, total - mastered - active);
        const mistaken = session.questions.filter((q) =>
            hasEverMistakenQuestion(q, session.appState),
        ).length;
        const correct = masteredQuestions.filter(
            (q) => !hasEverMistakenQuestion(q, session.appState),
        ).length;
        return {
            hash,
            total,
            mastered,
            active,
            unlearned,
            correct,
            mistaken,
            accuracy:
                mastered > 0 ? Math.round((correct / mastered) * 100) : "--",
        };
    });

    // 两层筛选结果（不含搜索）：用于「导出为新题库」，名字仅描述这两层
    const filteredByState = $derived(
        applyReviewFilter(session.questions, filter, session.appState),
    );

    let filteredQuestions = $derived.by(() => {
        const query = normalizeSearchText(searchTerm);
        return filteredByState.filter((q) => matchesSearch(q, query));
    });

    const grouped = $derived.by<QuestionGroup[]>(() => {
        return QUESTION_TYPE_ORDER.map((type) => ({
            type,
            items: filteredQuestions
                .filter((q: Question) => q.type === type)
                .map((q) => ({
                    question: q,
                    indicator: getQuestionIndicator(q),
                })),
        })).filter((g) => g.items.length > 0);
    });

    function toPositiveInteger(value: unknown, fallback: number): number {
        const numberValue = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(numberValue)) return fallback;
        return Math.max(1, Math.round(numberValue));
    }

    function getQuestionIndicator(question: Question): ReviewIndicator | null {
        const activeItem = activePoolById.get(question.id);
        if (activeItem) {
            return {
                item: activeItem,
                requiredStreak: getRequiredStreak(activeItem, session.appState),
                maxLevel: maxLearningLevel,
            };
        }

        if (!masteredSet.has(question.id)) return null;

        const hasEverMistaken = session.appState.masteredMistakes[question.id] === true;
        const requiredStreak = toPositiveInteger(
            hasEverMistaken
                ? session.appState.settings.correctStreakAfterMistake
                : session.appState.settings.correctStreakToMaster,
            1,
        );

        return {
            item: {
                id: question.id,
                consecutiveCorrect: requiredStreak,
                hasEverMistaken,
                hasBeenShown: true,
                lastSelectedRound: session.appState.currentRound,
            },
            requiredStreak,
            maxLevel: maxLearningLevel,
        };
    }

    async function jumpToQuestion(id: string): Promise<void> {
        searchTerm = "";
        filter = createReviewFilterState();
        selectedQuestionId = id;
        await tick();
        jumpTargetId = id;
    }

    function onJumpHandled() {
        jumpTargetId = null;
    }

    function onFilterChange(next: ReviewFilterState): void {
        filter = next;
    }

    const canExport = source.mode === "library";

    async function exportAsNewBank(): Promise<void> {
        if (!source.importBank) return;
        const description = describeFilter(filter);
        const name = description
            ? `${session.bank.name} ${description}`
            : session.bank.name;
        const result = await source.importBank(
            name,
            JSON.stringify(filteredByState),
        );
        switch (result.kind) {
            case "ok":
                onToast?.("已另存为新题库", `已加入题库「${name}」，请在侧边栏查看。`, "success");
                break;
            case "duplicate":
                onToast?.(
                    "题库已存在",
                    "该筛选结果与现有题库内容相同，未重复导入。",
                    "default",
                );
                break;
            case "invalid":
                onToast?.("导出失败", result.errors.join("；"), "destructive");
                break;
            case "quota":
                onToast?.("导出失败", "浏览器存储空间不足。", "destructive");
                break;
        }
    }
</script>

<Dialog.Root bind:open {onOpenChange}>
    <Dialog.Content
        onOpenAutoFocus={(e) => {
            e.preventDefault();
            if (!isCoarsePointer) searchInputRef?.focus();
        }}
        class="bg-card flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
    >
        <Dialog.Header
            class="flex flex-row items-center justify-between gap-3 border-b px-5 py-3"
        >
            <div class="flex items-baseline gap-2">
                <Dialog.Title class="text-base font-semibold">总览</Dialog.Title
                >
                <span class="font-mono text-xs text-foreground/40">
                    {overview.hash}
                </span>
            </div>
        </Dialog.Header>

        <div
            class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4"
        >
            <div
                class="grid grid-cols-1 gap-3 sm:grid-cols-3 *:rounded-md *:bg-foreground/5"
            >
                <Card.Root size="sm">
                    <Card.Content class="flex flex-col gap-1 relative">
                        <IconProgressCheck
                            size={96}
                            class="absolute sm:top-1 sm:-right-3 -top-3 right-0 text-muted-foreground opacity-20 -z-1"
                        />
                        <span class="text-muted-foreground text-xs"
                            >已掌握 / 活动题池 / 未学习</span
                        >
                        <span
                            class="*:font-mono text-2xl font-semibold tabular-nums text-foreground/10"
                        >
                            <span class="text-success">{overview.mastered}</span
                            >&thinsp;/&thinsp;<span class="text-warning"
                                >{overview.active}</span
                            >&thinsp;/&thinsp;<span class="text-foreground/40"
                                >{overview.unlearned}</span
                            >
                        </span>
                        <span
                            class="text-muted-foreground text-xs tabular-nums"
                        >
                            当前题库进度
                        </span>
                    </Card.Content>
                </Card.Root>

                <Card.Root size="sm">
                    <Card.Content class="flex flex-col gap-1 relative">
                        <IconTargetArrow
                            size={96}
                            class="absolute sm:bottom-1 sm:right-0 -bottom-3 right-0 text-muted-foreground opacity-20 -z-1"
                        />
                        <span class="text-muted-foreground text-xs">正确率</span
                        >
                        <span
                            class="font-mono text-2xl font-semibold tabular-nums"
                            style:color={getLearningLevelColor(
                                100 - (overview.accuracy as number),
                                100,
                            )}
                        >
                            {overview.accuracy}%
                        </span>
                        <span
                            class="text-muted-foreground font-mono text-xs tabular-nums"
                        >
                            {overview.correct} 正确 / {overview.mistaken} 错误
                        </span>
                    </Card.Content>
                </Card.Root>

                <Card.Root size="sm">
                    <Card.Content class="flex flex-col gap-1 relative">
                        <IconInnerShadowTopLeft
                            size={96}
                            class="absolute sm:-bottom-12 sm:-right-5 -bottom-3 right-0 text-muted-foreground opacity-20 -z-1"
                        />
                        <span class="text-muted-foreground text-xs"
                            >全部题目</span
                        >
                        <span
                            class="font-mono text-2xl font-semibold tabular-nums text-foreground/60"
                        >
                            {overview.total}
                        </span>
                        <span
                            class="text-muted-foreground text-xs tabular-nums"
                        >
                            当前题库
                        </span>
                    </Card.Content>
                </Card.Root>
            </div>

            <HeatmapSection onJump={jumpToQuestion} />

            <div class="flex min-h-0 flex-1 flex-col gap-3">
                <ReviewFilterBar
                    {filter}
                    onFilterChange={onFilterChange}
                    {searchTerm}
                    onSearchChange={(v) => (searchTerm = v)}
                    {canExport}
                    onExport={exportAsNewBank}
                    bind:inputRef={searchInputRef}
                    availableTypes={getAvailableQuestionTypes(session.questions)}
                />

                <QuestionListSection
                    {grouped}
                    {selectedQuestionId}
                    jumpTarget={jumpTargetId}
                    {onJumpHandled}
                />
            </div>
        </div>
    </Dialog.Content>
</Dialog.Root>
