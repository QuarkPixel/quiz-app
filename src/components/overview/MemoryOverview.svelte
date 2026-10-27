<script lang="ts">
    import { tick } from "svelte";
    import { CARD_HIGHLIGHT_MS } from "@/config";
    import { useMemorySession } from "@/features/memory/context";
    import { startOfDay, studyDay } from "@/features/memory/algorithm";
    import {
        createMemoryFilterState,
        describeMemoryScope,
        hasMemoryScope,
        matchesMemoryFilter,
        type MemoryDueStatus,
        type MemoryFilterState,
        type MemoryLearningStatus,
    } from "@/features/memory/filters";
    import { useQuizSource } from "@/source/context";
    import { toastStore } from "@/features/toast.svelte";
    import { cn } from "$lib/utils";
    import type { FilterGroupDef } from "@/components/shared/FilterBar.svelte";
    import type { QuestionGroup } from "./list/types";
    import type { MemoryQuestion } from "@/types";
    import QuestionPreview from "@/components/quiz/QuestionPreview.svelte";
    import CopyQuestionButton from "@/components/quiz/CopyQuestionButton.svelte";
    import { QuestionCopyStatusStore } from "@/components/quiz/useQuestionCopyStatus.svelte";
    import MemoryMasteryButton from "@/components/memory/MemoryMasteryButton.svelte";
    import MemoryOverviewCards from "@/components/overview/MemoryOverviewCards.svelte";
    import OverviewDialog from "./OverviewDialog.svelte";

    /**
     * 记忆模式的总览：只准备数据 + 画每一行。
     *
     * 与 `QuizOverview.svelte` 是同一个外壳的两个调用方——版面、卡片、筛选栏、
     * 虚拟列表全部共享。记忆模式的差别只有三处：
     *   - 筛选口径（学习进度 / 复习进度，见 `features/memory/filters.ts`）
     *   - 每一行是「题干 + 复制 + 状态（可点两下标熟）+ 题号」，没有连对圆点
     *   - 列表不带题型分组头（只有一种题型）
     */
    interface Props {
        open: boolean;
        onOpenChange: (open: boolean) => void;
    }

    let { open, onOpenChange }: Props = $props();

    const session = useMemorySession();
    const source = useQuizSource();

    let filter = $state<MemoryFilterState>(createMemoryFilterState());
    let searchTerm = $state("");
    /** 交给虚拟列表去收敛的跳转目标（`null` = 当前没有待处理的跳转） */
    let jumpTargetId = $state<string | null>(null);

    // 关掉总览就丢掉筛选与搜索词（与刷题模式同一行为）
    $effect(() => {
        if (!open) {
            searchTerm = "";
            filter = createMemoryFilterState();
        }
    });

    /** 点热力图的小方块时，把列表里对应那道卡滚动到视野中央并高亮一下 */
    let highlightedId = $state<string | null>(null);
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;

    const copy = new QuestionCopyStatusStore(session);

    // 必须用 session.now：它带调试的「时间修改」偏移，
    // 否则调试里加一天之后「N 天后复习」不会变。
    // 用 studyDay 而不是 startOfDay：一天从凌晨 5 点开始算。
    const today = $derived(studyDay(session.now));

    const rows = $derived.by(() =>
        session.questions.map((question) => {
            const item = session.progress[question.id];
            const daysUntilDue =
                item?.state === "reviewing"
                    ? Math.round((startOfDay(item.nextDue) - today) / 86_400_000)
                    : null;
            return { question, item, daysUntilDue };
        }),
    );

    const filteredRows = $derived(
        rows.filter((row) =>
            matchesMemoryFilter({
                filter,
                searchTerm,
                item: row.item,
                id: row.question.id,
                question: row.question.question,
                answer: row.question.answer as string,
                daysUntilDue: row.daysUntilDue,
            }),
        ),
    );

    /**
     * 虚拟列表的输入。记忆模式只有一种题型，所以最多一组；列表也不画分组头。
     * 结果为空时给空数组——列表据此显示「没有卡片」，而不是一片空白。
     */
    const grouped = $derived<QuestionGroup[]>(
        filteredRows.length === 0
            ? []
            : [
                  {
                      type: "memory",
                      items: filteredRows.map((row) => ({
                          question: row.question,
                          indicator: null,
                      })),
                  },
              ],
    );

    /** 是否收窄了卡片范围：导出按钮只在收窄后才有意义（与刷题模式同一判定） */
    const scopeApplied = $derived(hasMemoryScope(filter, searchTerm));

    const filterGroups = $derived<FilterGroupDef[]>([
        {
            label: "学习进度",
            values: [...filter.learning],
            onChange: (values) =>
                (filter = {
                    ...filter,
                    learning: new Set(values as MemoryLearningStatus[]),
                }),
            items: [
                { value: "mastered", label: "已掌握" },
                { value: "learning", label: "学习中" },
                { value: "unlearned", label: "未学习" },
            ],
        },
        {
            label: "复习进度",
            values: [...filter.due],
            onChange: (values) =>
                (filter = {
                    ...filter,
                    due: new Set(values as MemoryDueStatus[]),
                }),
            items: [
                { value: "today", label: "今天复习" },
                { value: "tomorrow", label: "明天复习" },
                { value: "soon", label: "近期复习" },
                { value: "later", label: "以后复习" },
            ],
        },
    ]);

    /**
     * 跳转前先清掉筛选与搜索词：虚拟列表只认识「当前结果里的题」，
     * 目标要是被筛掉了就永远滚不到。
     */
    async function jumpToCard(id: string): Promise<void> {
        searchTerm = "";
        filter = createMemoryFilterState();
        highlightedId = id;
        if (highlightTimer) clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => (highlightedId = null), CARD_HIGHLIGHT_MS);

        // 等清筛选后的列表渲染出来，再把目标交给虚拟列表去收敛
        await tick();
        jumpTargetId = id;
    }

    function onJumpHandled(): void {
        jumpTargetId = null;
    }

    /**
     * 把当前筛选结果另存为一份新的记忆题库。
     *
     * 只写 `mode` 与 `questions`，不带 `state`——另存出来的是一份纯题目集合，
     * 不继承原题库的进度。题库名带上筛选描述，方便在侧边栏一眼看出是哪一批卡。
     */
    async function exportAsNewBank(): Promise<void> {
        const description = describeMemoryScope(filter, searchTerm);
        const name = description
            ? `${session.bank.name} ${description}`
            : session.bank.name;
        const result = await source.importBank(
            name,
            JSON.stringify({
                mode: session.bank.mode,
                questions: filteredRows.map((row) => row.question),
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
        subject: "展示卡片",
        searchTerm,
        onSearchChange: (value) => (searchTerm = value),
        searchPlaceholder: "搜索 编号、题干、答案",
        searchLabel: "搜索卡片",
        groups: filterGroups,
        scopeApplied,
        onExport: exportAsNewBank,
        resultCount: filteredRows.length,
    }}
    list={{
        groups: grouped,
        withHeaders: false,
        jumpTarget: jumpTargetId,
        onJumpHandled,
        highlightId: highlightedId,
        emptyText: "当前筛选条件下没有卡片",
    }}
>
    <!-- 顶部那一排卡片：两张统计卡 + 热力图，都在同一个文件里（与首页共用） -->
    {#snippet cards()}
        <MemoryOverviewCards onJump={jumpToCard} />
    {/snippet}

    {#snippet row({ question, highlight })}
        {@const item = session.progress[question.id]}
        <!-- data-review-question-id 是虚拟滚动跳转时认行的标记，
             自定义行必须自己打上 -->
        <QuestionPreview
            question={question as MemoryQuestion}
            data-review-question-id={question.id}
            class={cn(
                "transition-shadow duration-300",
                highlight && "ring-2 ring-foreground/20",
            )}
        >
            {#snippet action()}
                <CopyQuestionButton
                    status={copy.get(question.id)}
                    onclick={(e) => copy.copy(e, question)}
                />
            {/snippet}
            {#snippet trailing()}
                <!-- 状态文字本身就是「标熟」按钮：点两下确认 -->
                <MemoryMasteryButton
                    {item}
                    {today}
                    onMaster={() => session.masterQuestion(question.id)}
                />
                <span class="text-muted-foreground font-mono text-xs">
                    {question.id}
                </span>
            {/snippet}
        </QuestionPreview>
    {/snippet}
</OverviewDialog>
