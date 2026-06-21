<script lang="ts">
    import * as ToggleGroup from "$lib/components/ui/toggle-group";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import IconAlignBoxLeftStretch from "@tabler/icons-svelte/icons/align-box-left-stretch";
    import IconSearch from "@tabler/icons-svelte/icons/search";
    import IconFilter from "@tabler/icons-svelte/icons/filter-2";
    import IconFilterSpark from "@tabler/icons-svelte/icons/filter-2-spark";
    import IconDatabaseExport from "@tabler/icons-svelte/icons/database-export";
    import type { Correctness, LearningStatus } from "@/features/quiz";
    import {
        isFilterEmpty,
        type ReviewFilterState,
    } from "@/features/quiz/reviewFilters";
    import { cn } from "tailwind-variants";
    import type { QuestionType } from "@/types";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import type { QuestionTypeDef } from "@/quiz/types/types";

    interface Props {
        filter: ReviewFilterState;
        onFilterChange: (next: ReviewFilterState) => void;
        searchTerm: string;
        onSearchChange: (value: string) => void;
        canExport: boolean;
        onExport: () => void;
        inputRef?: HTMLInputElement | null;
        availableTypes: QuestionType[];
    }

    let {
        filter,
        onFilterChange,
        searchTerm,
        onSearchChange,
        canExport,
        onExport,
        inputRef = $bindable<HTMLInputElement | null>(null),
        availableTypes,
    }: Props = $props();

    // 筛选栏展开状态（点击筛选按钮切换）
    let showFilters = $state(false);

    // 是否有任何筛选被应用（决定 spark 图标与导出按钮可见性）
    let filterApplied = $derived(!isFilterEmpty(filter));
    let showExport = $derived(canExport && filterApplied);

    let learningValues = $derived<string[]>([...filter.learning]);
    let correctnessValues = $derived<string[]>([...filter.correctness]);
    let typeValues = $derived<string[]>([...filter.types]);

    function onLearningChange(values: string[]): void {
        onFilterChange({
            ...filter,
            learning: new Set(values as LearningStatus[]),
        });
    }

    function onCorrectnessChange(values: string[]): void {
        onFilterChange({
            ...filter,
            correctness: new Set(values as Correctness[]),
        });
    }

    function onTypeChange(values: string[]): void {
        onFilterChange({
            ...filter,
            types: new Set(values as QuestionType[]),
        });
    }

    type FilterGroup = {
        label: string;
        values: string[];
        handler: (v: string[]) => void;
        items: { value: string; label: string; name?: string; icon?: any }[];
    };

    let filterGroups = $derived<FilterGroup[]>([
        {
            label: "学习进度",
            values: learningValues,
            handler: onLearningChange,
            items: [
                { value: "mastered", label: "已掌握" },
                { value: "learning", label: "学习中" },
                { value: "unlearned", label: "未学习" },
            ],
        },
        {
            label: "答题正误",
            values: correctnessValues,
            handler: onCorrectnessChange,
            items: [
                { value: "correct", label: "正确" },
                { value: "incorrect", label: "错误" },
            ],
        },
        // 只有当 availableTypes 长度大于 1 时才显示题目类型筛选
        ...(availableTypes.length > 1
            ? [
                  {
                      label: "题目类型",
                      values: typeValues,
                      handler: onTypeChange,
                      items: availableTypes.map((type) => {
                          const qt = QUESTION_TYPES[type] as QuestionTypeDef;
                          return {
                              value: qt.id,
                              label: qt.shortName,
                              name: qt.name,
                              icon: qt.icon,
                          };
                      }),
                  },
              ]
            : []),
    ]);
</script>

<div class="flex flex-col gap-1">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-3">
        <IconAlignBoxLeftStretch
            size={16}
            stroke={1.75}
            class="text-muted-foreground shrink-0"
        />
        <span class="shrink-0 text-sm font-medium">展示题目</span>
        <span class="dotted-leader text-muted-foreground/40 min-w-8 flex-1"
        ></span>
        <div class="relative w-full sm:w-72">
            <IconSearch
                class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
                bind:ref={inputRef}
                value={searchTerm}
                oninput={(e) => onSearchChange(e.currentTarget.value)}
                class="pl-8"
                placeholder="搜索 编号、题干、正确答案"
                aria-label="搜索题目"
            />
        </div>

        <Tooltip.Root>
            <Tooltip.Trigger>
                {#snippet child({ props })}
                    <Button
                        {...props}
                        type="button"
                        variant={showFilters ? "secondary" : "ghost"}
                        class={cn(
                            (filterApplied || showFilters) && "text-success",
                        )}
                        size="icon-sm"
                        aria-pressed={showFilters}
                        aria-label="筛选"
                        onclick={() => (showFilters = !showFilters)}
                    >
                        {#if filterApplied}
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
                    {#each filterGroups as group}
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
                                {#each group.items as item}
                                    <ToggleGroup.Item
                                        value={item.value}
                                        aria-label={item.name ?? item.label}
                                    >
                                        {#if item.icon}
                                            <item.icon />
                                        {/if}
                                        <span class="text-xs">{item.label}</span
                                        >
                                    </ToggleGroup.Item>
                                {/each}
                            </ToggleGroup.Root>
                        </div>
                    {/each}
                </div>
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
                                <IconDatabaseExport size={16} stroke={1.75} /> 导出为新题库
                            </Button>
                        {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content side="top">
                        <span>筛选结果另存为新题库</span>
                    </Tooltip.Content>
                </Tooltip.Root>
            </div>
        </div>
    </div>
</div>

<style>
    .filter-collapsible {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.2s ease;
    }
    .filter-collapsible.expanded {
        grid-template-rows: 1fr;
    }
    .filter-collapsible-inner {
        overflow: hidden;
    }
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
