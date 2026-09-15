<script lang="ts">
    import type { Correctness, LearningStatus } from "@/features/quiz";
    import { type ReviewFilterState } from "@/features/quiz/reviewFilters";
    import type { QuestionType } from "@/types";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import type { QuestionTypeDef } from "@/quiz/types/types";
    import FilterBar, {
        type FilterGroupDef,
    } from "@/components/shared/FilterBar.svelte";
    import { cn } from "$lib/utils";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Button } from "$lib/components/ui/button";
    import IconDatabaseExport from "@tabler/icons-svelte/icons/database-export";

    /**
     * 刷题模式总览的筛选栏。
     *
     * 外壳在 `components/shared/FilterBar.svelte`；这里只提供刷题模式的口径：
     * 分组是「学习进度 / 答题正误 / 题目类型（多种题型时才出现）」，
     * 展开面板右侧是「导出为新题库」。
     */
    interface Props {
        filter: ReviewFilterState;
        onFilterChange: (next: ReviewFilterState) => void;
        searchTerm: string;
        onSearchChange: (value: string) => void;
        canExport: boolean;
        scopeApplied: boolean;
        onExport: () => void;
        inputRef?: HTMLInputElement | null;
        availableTypes: QuestionType[];
        resultCount: number;
    }

    let {
        filter,
        onFilterChange,
        searchTerm,
        onSearchChange,
        canExport,
        scopeApplied,
        onExport,
        inputRef = $bindable<HTMLInputElement | null>(null),
        availableTypes,
        resultCount,
    }: Props = $props();

    // 有筛选 / 有搜索词、且结果非空时才放出导出
    const showExport = $derived(canExport && scopeApplied && resultCount !== 0);

    const groups: FilterGroupDef[] = $derived([
        {
            label: "学习进度",
            values: [...filter.learning],
            onChange: (values) =>
                onFilterChange({
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
                onFilterChange({
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
                          onFilterChange({
                              ...filter,
                              types: new Set(values as QuestionType[]),
                          }),
                      items: availableTypes.map((type) => {
                          const def = QUESTION_TYPES[type] as QuestionTypeDef;
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
</script>

<FilterBar
    subject="展示题目"
    {searchTerm}
    {onSearchChange}
    searchPlaceholder="搜索 编号、题干、正确答案"
    searchLabel="搜索题目"
    {groups}
    {scopeApplied}
    bind:inputRef
>
    {#snippet actions()}
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
                            !showExport && "opacity-0 pointer-events-none",
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
    {/snippet}
</FilterBar>
