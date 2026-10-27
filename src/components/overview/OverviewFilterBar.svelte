<script lang="ts">
    import FilterBar, {
        type FilterGroupDef,
    } from "@/components/shared/FilterBar.svelte";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Button } from "$lib/components/ui/button";
    import { cn } from "$lib/utils";
    import IconDatabaseExport from "@tabler/icons-svelte/icons/database-export";

    /**
     * 总览下半部分的那条「标题」——`展示题目` / `展示卡片`。
     *
     * 两个模式以前各有一份 `ReviewFilterBar` / `MemoryFilterBar`，除了文案与分组
     * 定义之外逐行重复（连导出按钮的显隐规则都是抄的）。现在文案与分组都是数据，
     * 外壳只有这一份：标题 + 点线 + 搜索框 + 筛选按钮 + 右侧「导出 / 结果数」。
     */
    interface Props {
        /** 「展示题目」/「展示卡片」 */
        subject: string;
        searchTerm: string;
        onSearchChange: (value: string) => void;
        searchPlaceholder: string;
        searchLabel: string;
        groups: FilterGroupDef[];
        /** 是否已经收窄了范围（按钮变绿、图标换成 spark） */
        scopeApplied: boolean;
        onExport: () => void;
        /** 当前筛选结果数（不是分组数） */
        resultCount: number;
        /** 打开总览时把焦点放到搜索框 */
        inputRef?: HTMLInputElement | null;
    }

    let {
        subject,
        searchTerm,
        onSearchChange,
        searchPlaceholder,
        searchLabel,
        groups,
        scopeApplied,
        onExport,
        resultCount,
        inputRef = $bindable<HTMLInputElement | null>(null),
    }: Props = $props();

    // 有筛选 / 有搜索词、且结果非空时才放出导出
    const showExport = $derived(scopeApplied && resultCount !== 0);
</script>

<FilterBar
    {subject}
    {searchTerm}
    {onSearchChange}
    {searchPlaceholder}
    {searchLabel}
    {groups}
    {scopeApplied}
    bind:inputRef
>
    {#snippet actions()}
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
