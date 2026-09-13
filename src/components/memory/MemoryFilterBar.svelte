<script lang="ts">
    import * as ToggleGroup from "$lib/components/ui/toggle-group";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import IconAlignBoxLeftStretch from "@tabler/icons-svelte/icons/align-box-left-stretch";
    import IconSearch from "@tabler/icons-svelte/icons/search";
    import IconFilter from "@tabler/icons-svelte/icons/filter-2";
    import IconFilterSpark from "@tabler/icons-svelte/icons/filter-2-spark";
    import type {
        MemoryDueStatus,
        MemoryFilterState,
        MemoryLearningStatus,
    } from "@/features/memory/filters";

    /**
     * 记忆模式总览的筛选栏。结构与刷题模式的 `ReviewFilterBar.svelte` 完全一致：
     * 「图标 + 展示卡片 + 点线 + 搜索框 + 筛选按钮」，展开后是多组 ToggleGroup。
     * 只是分组换成记忆模式的口径（学习进度 / 复习进度），也没有「导出为新题库」。
     */
    interface Props {
        filter: MemoryFilterState;
        onFilterChange: (next: MemoryFilterState) => void;
        searchTerm: string;
        onSearchChange: (value: string) => void;
        resultCount: number;
    }

    let {
        filter,
        onFilterChange,
        searchTerm,
        onSearchChange,
        resultCount,
    }: Props = $props();

    let showFilters = $state(false);

    let scopeApplied = $derived(
        filter.learning.size > 0 || filter.due.size > 0 || searchTerm !== "",
    );

    type FilterGroup = {
        label: string;
        values: string[];
        handler: (values: string[]) => void;
        items: { value: string; label: string }[];
    };

    const filterGroups: FilterGroup[] = $derived([
        {
            label: "学习进度",
            values: [...filter.learning],
            handler: (values) =>
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
            handler: (values) =>
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
</script>

<div class="flex flex-col gap-1">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-3">
        <IconAlignBoxLeftStretch
            size={16}
            stroke={1.75}
            class="text-muted-foreground shrink-0"
        />
        <span class="shrink-0 text-sm font-medium">展示卡片</span>
        <span class="dotted-leader text-muted-foreground/40 min-w-8 flex-1"
        ></span>
        <div class="relative w-full sm:w-72">
            <IconSearch
                class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
                value={searchTerm}
                oninput={(e) => onSearchChange(e.currentTarget.value)}
                class="pl-8"
                placeholder="搜索 编号、题干、答案"
                aria-label="搜索卡片"
            />
        </div>

        <Tooltip.Root>
            <Tooltip.Trigger>
                {#snippet child({ props })}
                    <Button
                        {...props}
                        type="button"
                        variant={showFilters ? "secondary" : "ghost"}
                        class={scopeApplied || showFilters
                            ? "text-success"
                            : undefined}
                        size="icon-sm"
                        aria-pressed={showFilters}
                        aria-label="筛选"
                        onclick={() => (showFilters = !showFilters)}
                    >
                        {#if scopeApplied}
                            <IconFilterSpark size={16} stroke={2} />
                        {:else}
                            <IconFilter size={16} stroke={2} />
                        {/if}
                    </Button>
                {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">
                <span>筛选</span>
            </Tooltip.Content>
        </Tooltip.Root>
    </div>

    <div class="filter-collapsible" class:expanded={showFilters}>
        <div class="filter-collapsible-inner">
            <div
                class="flex justify-between gap-1 bg-foreground/3 p-2 rounded-md"
            >
                <div class="flex flex-wrap items-center gap-6">
                    {#each filterGroups as group (group.label)}
                        <div class="flex flex-col items-start gap-1">
                            <span class="text-xs opacity-50">{group.label}</span
                            >
                            <ToggleGroup.Root
                                type="multiple"
                                value={group.values}
                                spacing={1}
                                onValueChange={(v) =>
                                    group.handler((v ?? []) as string[])}
                                variant="outline"
                                size="sm"
                                class="*:data-[state=on]:bg-primary/80 *:data-[state=on]:text-primary-foreground *:data-[state=on]:border-transparent"
                            >
                                {#each group.items as item (item.value)}
                                    <ToggleGroup.Item
                                        value={item.value}
                                        aria-label={item.label}
                                    >
                                        <span class="text-xs">{item.label}</span
                                        >
                                    </ToggleGroup.Item>
                                {/each}
                            </ToggleGroup.Root>
                        </div>
                    {/each}
                </div>
                <span
                    class="text-muted-foreground self-end text-xs tabular-nums"
                >
                    {resultCount} 张
                </span>
            </div>
        </div>
    </div>
</div>
