<script lang="ts">
    import type {
        MemoryDueStatus,
        MemoryFilterState,
        MemoryLearningStatus,
    } from "@/features/memory/filters";
    import FilterBar, {
        type FilterGroupDef,
    } from "@/components/shared/FilterBar.svelte";
    import { cn } from "$lib/utils";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Button } from "$lib/components/ui/button";
    import IconDatabaseExport from "@tabler/icons-svelte/icons/database-export";

    /**
     * 记忆模式总览的筛选栏。
     *
     * 外壳（图标 + 展示对象 + 点线 + 搜索框 + 筛选按钮 + 可折叠的 ToggleGroup 面板）
     * 在 `components/shared/FilterBar.svelte` 那一份里；这里只提供记忆模式的口径：
     * 分组是「学习进度 / 复习进度」，展开面板右侧是「导出为新题库 + N 道」。
     */
    interface Props {
        filter: MemoryFilterState;
        onFilterChange: (next: MemoryFilterState) => void;
        searchTerm: string;
        onSearchChange: (value: string) => void;
        canExport: boolean;
        scopeApplied: boolean;
        onExport: () => void;
        resultCount: number;
        /** 打开总览时把焦点放到搜索框（与 ReviewFilterBar 同一套做法） */
        inputRef?: HTMLInputElement | null;
    }

    let {
        filter,
        onFilterChange,
        searchTerm,
        onSearchChange,
        canExport,
        scopeApplied,
        onExport,
        resultCount,
        inputRef = $bindable<HTMLInputElement | null>(null),
    }: Props = $props();

    const groups: FilterGroupDef[] = $derived([
        {
            label: "学习进度",
            values: [...filter.learning],
            onChange: (values) =>
                onFilterChange({
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
                onFilterChange({
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

    // 有筛选 / 有搜索词、且结果非空时才放出导出（与刷题模式同一条件）
    const showExport = $derived(canExport && scopeApplied && resultCount !== 0);
</script>

<FilterBar
    subject="展示卡片"
    {searchTerm}
    {onSearchChange}
    searchPlaceholder="搜索 编号、题干、答案"
    searchLabel="搜索卡片"
    {groups}
    {scopeApplied}
    bind:inputRef
>
    {#snippet actions()}
        <!-- 右侧一列：导出按钮贴着组标签那行（与刷题模式同位置），
             结果数留在右下角（记忆模式特有的信息，位置不动） -->
        <div class="flex flex-col items-end justify-between gap-1">
            <Tooltip.Root>
                <Tooltip.Trigger>
                    {#snippet child({ props })}
                        <Button
                            {...props}
                            variant="outline"
                            size="xs"
                            onclick={onExport}
                            class={cn(
                                "tracking-normal rounded-full",
                                !showExport &&
                                    "opacity-0 pointer-events-none",
                            )}
                        >
                            <IconDatabaseExport size={16} stroke={1.75} />
                            导出为新题库
                        </Button>
                    {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content side="top">
                    <span>筛选结果另存为新题库</span>
                </Tooltip.Content>
            </Tooltip.Root>
            <span class="text-muted-foreground text-xs tabular-nums">
                {resultCount} 道
            </span>
        </div>
    {/snippet}
</FilterBar>
