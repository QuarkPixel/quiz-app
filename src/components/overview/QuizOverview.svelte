<script lang="ts">
    import { tick } from "svelte";
    import type { Question, QuestionType } from "@/types";
    import { getRequiredStreak } from "@/features/quiz";
    import { getAvailableQuestionTypes } from "@/features/quiz/filters";
    import type {
        Correctness,
        LearningStatus,
    } from "@/features/quiz/questionClassification";
    import { getMaxLearningLevel } from "@/features/quiz/learningProgress";
    import {
        applyReviewScope,
        createReviewFilterState,
        describeReviewScope,
        hasReviewScope,
        type ReviewFilterState,
    } from "@/features/quiz/reviewFilters";
    import { useQuizSource } from "@/source/context";    import { useQuizSession } from "@/quiz/session/context";
    import {
        QUESTION_TYPES,
        QUESTION_TYPE_ORDER,
    } from "@/quiz/types/registry";
    import { toastStore } from "@/features/toast.svelte";
    import type { FilterGroupDef } from "@/components/shared/FilterBar.svelte";
    import type {
        QuestionGroup,
        ReviewIndicator,
    } from "@/components/overview/list/types";
    import OverviewDialog from "@/components/overview/OverviewDialog.svelte";
    import QuizOverviewRow from "@/components/overview/QuizOverviewRow.svelte";
    import QuizOverviewCards from "@/components/overview/QuizOverviewCards.svelte";
    import { QuestionCopyStatusStore } from "../quiz/useQuestionCopyStatus.svelte";

    /**
     * 刷题模式的总览：只准备数据 + 画每一行。
     *
     * 版面（横向 rail、卡片、筛选栏、虚拟列表）全在
     * `components/overview/OverviewDialog.svelte` 那一份共享外壳里；顶部那一排
     * 卡片是 `QuizOverviewCards.svelte`（记忆模式对应
     * `MemoryOverviewCards.svelte`，两边同一套规格）。
     */
    interface Props {
        open: boolean;
        onOpenChange: (open: boolean) => void;
    }

    let { open, onOpenChange }: Props = $props();

    const session = useQuizSession();
    const source = useQuizSource();

    let filter = $state<ReviewFilterState>(createReviewFilterState());
    let searchTerm = $state("");
    let selectedQuestionId = $state<string | null>(null);
    let jumpTargetId = $state<string | null>(null);

    // 关掉总览就丢掉筛选与搜索词：留着上次的条件，下次打开会看到一份
    // 「少了半题库」的列表，而搜索框 / 勾选项都在看不见的地方。
    $effect(() => {
        if (!open) {
            searchTerm = "";
            filter = createReviewFilterState();
            selectedQuestionId = null;
        }
    });

    const masteredSet = $derived(new Set(session.appState.masteredIds));
    const activePoolById = $derived(
        new Map(session.appState.activePool.map((item) => [item.id, item])),
    );
    const maxLearningLevel = $derived(getMaxLearningLevel(session.appState));

    const filteredQuestions = $derived(
        applyReviewScope(
            session.questions,
            filter,
            session.appState,
            searchTerm,
        ),
    );

    const scopeApplied = $derived(hasReviewScope(filter, searchTerm));

    const grouped = $derived.by<QuestionGroup[]>(() =>
        QUESTION_TYPE_ORDER.map((type) => ({
            type,
            items: filteredQuestions
                .filter((q: Question) => q.type === type)
                .map((q) => ({
                    question: q,
                    indicator: getQuestionIndicator(q),
                })),
        })).filter((g) => g.items.length > 0),
    );

    const availableTypes = $derived(getAvailableQuestionTypes(session.questions));

    const filterGroups = $derived<FilterGroupDef[]>([
        {
            label: "学习进度",
            values: [...filter.learning],
            onChange: (values) =>
                (filter = {
                    ...filter,
                    learning: new Set(values as LearningStatus[]),
                }),
            items: [
                { value: "mastered", label: "已掌握" },
                { value: "learning", label: "学习中" },
                { value: "unlearned", label: "未学习" },
            ],
        },
        {
            label: "答题正误",
            values: [...filter.correctness],
            onChange: (values) =>
                (filter = {
                    ...filter,
                    correctness: new Set(values as Correctness[]),
                }),
            items: [
                { value: "correct", label: "正确" },
                { value: "incorrect", label: "错误" },
            ],
        },
        // 只有一种题型时这一组没有意义，直接不显示
        ...(availableTypes.length > 1
            ? [
                  {
                      label: "题目类型",
                      values: [...filter.types],
                      onChange: (values: string[]) =>
                          (filter = {
                              ...filter,
                              types: new Set(values as QuestionType[]),
                          }),
                      items: availableTypes.map((type) => {
                          const def = QUESTION_TYPES[type];
                          return {
                              value: def.id,
                              label: def.shortName,
                              name: def.name,
                              icon: def.icon,
                          };
                      }),
                  },
              ]
            : []),
    ]);

    const copy = new QuestionCopyStatusStore(session);

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

        const hasEverMistaken =
            session.appState.masteredMistakes[question.id] === true;
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
        // 跳转前先清筛选：虚拟列表只认识「当前结果里的题」，
        // 目标要是被筛掉了就永远滚不到
        searchTerm = "";
        filter = createReviewFilterState();
        selectedQuestionId = id;
        await tick();
        jumpTargetId = id;
    }

    function onJumpHandled(): void {
        jumpTargetId = null;
    }

    /**
     * 把当前筛选结果另存为一份新的题库。
     *
     * 只写 `mode` 与 `questions`，不带 `state`：另存出来的是一份纯题目集合，
     * 不继承原题库的进度（进度按题目 hash 存，本来也对不上）。
     */
    async function exportAsNewBank(): Promise<void> {
        const description = describeReviewScope(filter, searchTerm);
        const name = description
            ? `${session.bank.name} ${description}`
            : session.bank.name;
        const result = await source.importBank(
            name,
            JSON.stringify({
                mode: session.bank.mode,
                questions: filteredQuestions,
            }),
        );
        switch (result.kind) {
            case "ok":
                toastStore.show(
                    "已另存为新题库",
                    `已加入题库「${name}」，请在侧边栏查看。`,
                    "success",
                );
                break;
            case "duplicate":
                toastStore.show(
                    "题库已存在",
                    "内容与现有题库相同，未重复导入。",
                );
                break;
            case "invalid":
                toastStore.show(
                    "导出失败",
                    result.errors.join("；"),
                    "destructive",
                );
                break;
            case "quota":
                toastStore.show("导出失败", "浏览器存储空间不足。", "destructive");
                break;
        }
    }
</script>

<OverviewDialog
    {open}
    {onOpenChange}
    hash={session.bank.hash}
    filter={{
        subject: "展示题目",
        searchTerm,
        onSearchChange: (value) => (searchTerm = value),
        searchPlaceholder: "搜索 编号、题干、正确答案",
        searchLabel: "搜索题目",
        groups: filterGroups,
        scopeApplied,
        onExport: exportAsNewBank,
        resultCount: filteredQuestions.length,
    }}
    list={{
        groups: grouped,
        withHeaders: true,
        jumpTarget: jumpTargetId,
        onJumpHandled,
        highlightId: selectedQuestionId,
        emptyText: "当前筛选条件下没有题目",
    }}
>
    <!-- 顶部那一排卡片：三张统计卡 + 热力图，都在同一个文件里 -->
    {#snippet cards()}
        <QuizOverviewCards onJump={jumpToQuestion} />
    {/snippet}

    {#snippet row({ question, highlight })}
        <QuizOverviewRow
            {question}
            indicator={getQuestionIndicator(question)}
            selected={selectedQuestionId === question.id}
            copyStatus={copy.get(question.id)}
            onCopy={(e, q) => copy.copy(e, q)}
            class={highlight ? "ring-2 ring-foreground/20" : undefined}
        />
    {/snippet}
</OverviewDialog>
