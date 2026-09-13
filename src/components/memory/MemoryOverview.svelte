<script lang="ts">
    import { useMemorySession } from "@/features/memory/context";
    import { startOfDay, studyDay } from "@/features/memory/algorithm";
    import QuestionPreview from "../quiz/QuestionPreview.svelte";
    import CopyQuestionButton from "../quiz/CopyQuestionButton.svelte";
    import { QuestionCopyStatusStore } from "../quiz/useQuestionCopyStatus.svelte";
    import * as Dialog from "$lib/components/ui/dialog";
    import MemoryStatsCards from "./MemoryStatsCards.svelte";
    import MemoryHeatmapSection from "./MemoryHeatmapSection.svelte";
    import MemoryFilterBar from "./MemoryFilterBar.svelte";
    import {
        createMemoryFilterState,
        matchesMemoryFilter,
        type MemoryFilterState,
    } from "@/features/memory/filters";
    import type { MemoryProgress, MemoryQuestion } from "@/types";

    // 与 ReviewView.svelte 同构：同样的 Dialog 外壳、同样的顶部三张 Card、
    // 同样的筛选 + 列表结构；题目卡片直接用 QuestionPreview（它会自动渲染记忆
    // 题型的 Review 组件），所以没有记忆模式专属的展示样式。
    interface Props {
        open: boolean;
        onOpenChange: (open: boolean) => void;
    }

    let { open, onOpenChange }: Props = $props();

    const session = useMemorySession();

    const PAGE_SIZE = 80;

    let filter = $state<MemoryFilterState>(createMemoryFilterState());
    let searchTerm = $state("");
    let visibleCount = $state(PAGE_SIZE);
    let sentinel: HTMLDivElement | null = $state(null);

    /** 点热力图的小方块时，把列表里对应那张卡滚动到视野中央并高亮一下 */
    let highlightedId = $state<string | null>(null);
    let highlightTimer: ReturnType<typeof setTimeout> | null = null;
    /** 复制题目：复用刷题模式的 store（按钮状态 + toast 由它管） */
    const copy = new QuestionCopyStatusStore(session);

    function jumpToCard(id: string): void {
        highlightedId = id;
        if (highlightTimer) clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => (highlightedId = null), 1600);

        // 目标可能在分页之外（或不在当前筛选结果里）：先把列表放全，再滚动。
        // id 可能含引号等字符，选择器必须转义，否则 querySelector 会抛异常。
        requestAnimationFrame(() => {
            const selector = `[data-memory-card-id="${CSS.escape(id)}"]`;
            let el = document.querySelector(selector);
            if (!el && visibleCount < filteredRows.length) {
                visibleCount = filteredRows.length;
                el = document.querySelector(selector);
            }
            el?.scrollIntoView({ block: "center", behavior: "smooth" });
        });
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
            return {
                question,
                item,
                daysUntilDue,
                status: describeStatus(item, today),
            };
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

    const shownRows = $derived(filteredRows.slice(0, visibleCount));

    $effect(() => {
        filter;
        searchTerm;
        visibleCount = PAGE_SIZE;
    });

    $effect(() => {
        if (!sentinel) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                visibleCount += PAGE_SIZE;
            }
        });
        observer.observe(sentinel);
        return () => observer.disconnect();
    });

    /**
     * 每张卡片只显示一句话的状态：
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


</script>

<Dialog.Root bind:open {onOpenChange}>
    <Dialog.Content
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

            <div class="flex flex-col gap-3">
                <MemoryFilterBar
                    {filter}
                    onFilterChange={(next) => (filter = next)}
                    {searchTerm}
                    onSearchChange={(value) => (searchTerm = value)}
                    resultCount={filteredRows.length}
                />

                <div class="flex flex-col gap-2">
                    {#each shownRows as row (row.question.id)}
                        <div
                            data-memory-card-id={row.question.id}
                            class="rounded-lg ring-foreground/20 transition-shadow duration-300"
                            class:ring-2={highlightedId === row.question.id}
                        >
                            <QuestionPreview question={row.question as MemoryQuestion}>
                                {#snippet action()}
                                    <CopyQuestionButton
                                        status={copy.get(row.question.id)}
                                        onclick={(e) =>
                                            copy.copy(e, row.question)}
                                    />
                                {/snippet}
                                {#snippet trailing()}
                                    <!-- 这里不放连对圆点指示器，只用一句话说明状态 -->
                                    <span
                                        class="text-xs font-medium {stateClass(
                                            row.item,
                                        )}"
                                    >
                                        {row.status}
                                    </span>
                                    <span
                                        class="text-muted-foreground font-mono text-xs"
                                    >
                                        {row.question.id}
                                    </span>
                                {/snippet}
                            </QuestionPreview>
                        </div>
                    {/each}

                    {#if filteredRows.length === 0}
                        <p class="text-muted-foreground py-10 text-center text-sm">
                            当前筛选条件下没有卡片
                        </p>
                    {/if}

                    {#if visibleCount < filteredRows.length}
                        <div bind:this={sentinel} class="h-4"></div>
                    {/if}
                </div>
            </div>
        </div>
    </Dialog.Content>
</Dialog.Root>
