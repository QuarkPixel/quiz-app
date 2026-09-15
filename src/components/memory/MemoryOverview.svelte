<script lang="ts">
    import { tick } from "svelte";
    import { CARD_HIGHLIGHT_MS } from "@/config";
    import { useMemorySession } from "@/features/memory/context";
    import { startOfDay, studyDay } from "@/features/memory/algorithm";
    import QuestionPreview from "../quiz/QuestionPreview.svelte";
    import CopyQuestionButton from "../quiz/CopyQuestionButton.svelte";
    import { QuestionCopyStatusStore } from "../quiz/useQuestionCopyStatus.svelte";
    import QuestionListSection from "../review/QuestionListSection.svelte";
    import type { QuestionGroup } from "../review/virtualList/types";
    import * as Dialog from "$lib/components/ui/dialog";
    import MemoryStatsCards from "./MemoryStatsCards.svelte";
    import MemoryHeatmapSection from "./MemoryHeatmapSection.svelte";
    import MemoryFilterBar from "./MemoryFilterBar.svelte";
    import {
        createMemoryFilterState,
        describeMemoryScope,
        hasMemoryScope,
        matchesMemoryFilter,
        type MemoryFilterState,
    } from "@/features/memory/filters";
    import { useQuizSource } from "@/source/context";
    import { toastStore } from "@/features/toast.svelte";
    import type { MemoryProgress, MemoryQuestion } from "@/types";
    import { cn, isCoarsePointer } from "$lib/utils";

    // 与 ReviewView.svelte 同构：同样的 Dialog 外壳、同样的顶部三道 Card、
    // 同样的筛选 + 列表结构；题目卡片直接用 QuestionPreview（它会自动渲染记忆
    // 题型的 Review 组件），所以没有记忆模式专属的展示样式。
    interface Props {
        open: boolean;
        onOpenChange: (open: boolean) => void;
    }

    let { open, onOpenChange }: Props = $props();

    const session = useMemorySession();
    const source = useQuizSource();

    let filter = $state<MemoryFilterState>(createMemoryFilterState());
    let searchTerm = $state("");
    let searchInputRef: HTMLInputElement | null = $state(null);
    /** 交给虚拟列表去收敛的跳转目标（`null` = 当前没有待处理的跳转） */
    let jumpTargetId = $state<string | null>(null);

    // 关掉总览就丢掉筛选与搜索词（与 ReviewView 同一行为）：
    // 留着上次的条件，下次打开会看到一份「少了半题库」的列表，还找不到原因。
    $effect(() => {
        if (!open) {
            searchTerm = "";
            filter = createMemoryFilterState();
        }
    });

    /** 点热力图的小方块时，把列表里对应那道卡滚动到视野中央并高亮一下 */
    let highlightedId = $state<string | null>(null);
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    /** 复制题目：复用刷题模式的 store（按钮状态 + toast 由它管） */
    const copy = new QuestionCopyStatusStore(session);

    /**
     * 跳转前先清掉筛选与搜索词：虚拟列表只认识「当前结果里的题」，
     * 目标要是被筛掉了就永远滚不到（与 `ReviewView.jumpToQuestion` 同一做法）。
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
     * 虚拟列表的输入。记忆模式只有一种题型，所以最多一组；列表也不画分组头
     * （`withHeaders={false}`，`type` 在无头模式下没人读）。
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

    /**
     * 每道卡片只显示一句话的状态：
     *   未学习 / 学习中 / 已掌握；复习中直接写「N 天后复习」，
     *   不再重复「复习中」这个词，也不显示「3/5」这种轮次进度。
     */
    function describeStatus(
        item: MemoryProgress | undefined,
        now: number,
    ): string {
        if (!item) return "未学习";
        if (item.state === "mastered") return "已掌握";
        if (item.state === "learning") return "学习中";
        const days = Math.round((startOfDay(item.nextDue) - now) / 86_400_000);
        if (days < 0) return `逾期 ${-days} 天`;
        if (days === 0) return "今天复习";
        if (days === 1) return "明天复习";
        return `${days} 天后复习`;
    }

    /** 状态文字沿用现有调色板：未学习灰、学习中 warning、复习中中性、已掌握 success。 */
    function stateClass(item: MemoryProgress | undefined): string {
        if (!item) return "text-foreground/40";
        if (item.state === "mastered") return "text-success";
        if (item.state === "learning") return "text-warning";
        return "text-foreground/60";
    }

    // 与 ReviewView 同一口径：现在只有一种运行形态，任何题库都可以导出为新题库。
    const canExport = true;

    /**
     * 把当前筛选结果另存为一份新的记忆题库。
     *
     * 只写 `mode` 与 `questions`，不带 `state`——与刷题模式的导出一致：另存出来的
     * 是一份纯题目集合，不继承原题库的进度（进度按题目 hash 存，本来也对不上）。
     * 题库名带上筛选描述，方便在侧边栏一眼看出这份副本是哪一批卡。
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

<Dialog.Root bind:open {onOpenChange}>
    <Dialog.Content
        onOpenAutoFocus={(e) => {
            // 默认会把焦点给第一个可聚焦元素（这里是热力图折叠按钮）。
            // 和刷题模式的总览一致：焦点给搜索框，触屏设备不抢焦点（免得弹键盘）
            e.preventDefault();
            if (!isCoarsePointer) searchInputRef?.focus();
        }}
        class="bg-card flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
    >
        <Dialog.Header
            class="flex flex-row items-center justify-between gap-3 border-b px-5 py-3"
        >
            <div class="flex items-baseline gap-2">
                <Dialog.Title class="text-base font-semibold">总览</Dialog.Title>
                <span class="font-mono text-xs text-foreground/40">
                    {session.bank.hash}
                </span>
            </div>
        </Dialog.Header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
            <MemoryStatsCards />

            <MemoryHeatmapSection onJump={jumpToCard} />

            <div class="flex min-h-0 flex-1 flex-col gap-3">
                <MemoryFilterBar
                    {filter}
                    onFilterChange={(next) => (filter = next)}
                    {searchTerm}
                    onSearchChange={(value) => (searchTerm = value)}
                    {canExport}
                    {scopeApplied}
                    onExport={exportAsNewBank}
                    resultCount={filteredRows.length}
                    bind:inputRef={searchInputRef}
                />

                <!-- 与刷题模式同一套虚拟列表：列表自己滚、sticky 渐变上下各一条。
                     记忆模式没有题型分组头，行渲染也换成「状态 + 题号」那张卡。 -->
                <QuestionListSection
                    {grouped}
                    jumpTarget={jumpTargetId}
                    {onJumpHandled}
                    withHeaders={false}
                    highlightId={highlightedId}
                    emptyText="当前筛选条件下没有卡片"
                >
                    {#snippet row({ question, highlight })}
                        {@const item = session.progress[question.id]}
                        <!-- data-review-question-id 是虚拟滚动跳转时认行的标记，
                             自定义行必须自己打上（默认的 QuestionCard 也打在卡片上） -->
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
                                <!-- 这里不放连对圆点指示器，只用一句话说明状态 -->
                                <span
                                    class="text-xs font-medium {stateClass(item)}"
                                >
                                    {describeStatus(item, today)}
                                </span>
                                <span
                                    class="text-muted-foreground font-mono text-xs"
                                >
                                    {question.id}
                                </span>
                            {/snippet}
                        </QuestionPreview>
                    {/snippet}
                </QuestionListSection>
            </div>
        </div>
    </Dialog.Content>
</Dialog.Root>
