<script lang="ts">
    import { tick } from "svelte";
    import type { ActivePoolItem, Question } from "../types";
    import { getRequiredStreak } from "../features/quiz";
    import {
        getLearningLevelColor,
        getMaxLearningLevel,
    } from "../features/quiz/learningProgress";
    import * as Card from "$lib/components/ui/card";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Input } from "$lib/components/ui/input";
    import { Switch } from "$lib/components/ui/switch";
    import { Label } from "$lib/components/ui/label";
    import {
        QUESTION_TYPES,
        QUESTION_TYPE_ORDER,
    } from "../quiz/types/registry";
    import { useQuizSession } from "../quiz/session/context";
    import HeatmapSection from "./HeatmapSection.svelte";
    import QuestionListSection from "./QuestionListSection.svelte";
    import IconAlignBoxLeftStretch from "@tabler/icons-svelte/icons/align-box-left-stretch";
    import IconSearch from "@tabler/icons-svelte/icons/search";

    interface Props {
        open: boolean;
        onOpenChange: (open: boolean) => void;
    }

    let { open, onOpenChange }: Props = $props();

    const session = useQuizSession();

    let showUnmasteredOnly = $state(false);
    let searchTerm = $state("");
    let selectedQuestionId = $state<string | null>(null);
    let jumpTargetId = $state<string | null>(null);

    const masteredSet = $derived(new Set(session.appState.masteredIds));
    const activePoolById = $derived(
        new Map(session.appState.activePool.map((item) => [item.id, item])),
    );
    const masteredQuestions = $derived(
        session.questions.filter((q) => masteredSet.has(q.id)),
    );
    const masteredMistakes = $derived(session.appState.masteredMistakes ?? {});
    const maxLearningLevel = $derived(getMaxLearningLevel(session.appState));

    interface ReviewIndicator {
        item: ActivePoolItem;
        requiredStreak: number;
        maxLevel: number;
    }

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
        const mistaken = masteredQuestions.filter(
            (question) => masteredMistakes[question.id] === true,
        ).length;
        const correct = mastered - mistaken;
        return {
            hash,
            total,
            mastered,
            active: session.appState.activePool.length,
            unmastered: Math.max(0, total - mastered),
            correct,
            mistaken,
            accuracy:
                mastered > 0 ? Math.round((correct / mastered) * 100) : "--",
        };
    });

    let filteredQuestions = $derived.by(() => {
        const query = normalizeSearchText(searchTerm);
        const byMastered = showUnmasteredOnly
            ? session.questions.filter((q) => !masteredSet.has(q.id))
            : session.questions;
        return byMastered.filter((q) => matchesSearch(q, query));
    });

    const grouped = $derived.by(() => {
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

        const hasEverMistaken = masteredMistakes[question.id] === true;
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
        showUnmasteredOnly = false;
        selectedQuestionId = id;
        await tick();
        jumpTargetId = id;
    }

    function onJumpHandled() {
        jumpTargetId = null;
    }
</script>

<Dialog.Root bind:open {onOpenChange}>
    <Dialog.Content
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
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Card.Root size="sm" class="rounded-md">
                    <Card.Content class="flex flex-col gap-1">
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

                <Card.Root size="sm" class="rounded-md">
                    <Card.Content class="flex flex-col gap-1">
                        <span class="text-muted-foreground text-xs"
                            >已掌握 / 活动题池 / 未掌握</span
                        >
                        <span
                            class="font-mono text-2xl font-semibold tabular-nums text-foreground/10"
                        >
                            <span class="text-success">{overview.mastered}</span
                            >
                            /
                            <span class="text-warning">{overview.active}</span>
                            /
                            <span class="text-foreground/40"
                                >{overview.unmastered}</span
                            >
                        </span>
                        <span
                            class="text-muted-foreground text-xs tabular-nums"
                        >
                            当前题库进度
                        </span>
                    </Card.Content>
                </Card.Root>

                <Card.Root size="sm" class="rounded-md">
                    <Card.Content class="flex flex-col gap-1">
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
                <div class="flex flex-wrap items-center gap-x-2 gap-y-3">
                    <IconAlignBoxLeftStretch
                        size={16}
                        stroke={1.75}
                        class="text-muted-foreground shrink-0"
                    />
                    <span class="shrink-0 text-sm font-medium">展示题目</span>
                    <span
                        class="dotted-leader text-muted-foreground/40 min-w-8 flex-1"
                    ></span>
                    <div class="flex items-center gap-2">
                        <Switch
                            id="unmastered-only"
                            bind:checked={showUnmasteredOnly}
                            size="sm"
                        />
                        <Label
                            for="unmastered-only"
                            class="text-muted-foreground text-xs"
                        >
                            仅看未掌握
                        </Label>
                    </div>
                    <div class="relative w-full sm:w-72">
                        <IconSearch
                            class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
                        />
                        <Input
                            bind:value={searchTerm}
                            class="pl-8"
                            placeholder="搜索 编号、题干、正确答案"
                            aria-label="搜索题目"
                        />
                    </div>
                </div>

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

<style>
    .dotted-leader {
        height: 4px;
        align-self: center;
        background-image: radial-gradient(
            circle,
            currentColor 1px,
            transparent 1.4px
        );
        background-size: 6px 4px;
        background-position: center;
        background-repeat: repeat-x;
    }
</style>
