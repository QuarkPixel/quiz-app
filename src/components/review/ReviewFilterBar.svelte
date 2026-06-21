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
    import type { LearningStatus } from "@/features/quiz";
    import {
        isFilterEmpty,
        type ReviewFilterState,
    } from "@/features/quiz/reviewFilters";
    import { cn } from "tailwind-variants";

    interface Props {
        filter: ReviewFilterState;
        onFilterChange: (next: ReviewFilterState) => void;
        searchTerm: string;
        onSearchChange: (value: string) => void;
        canExport: boolean;
        onExport: () => void;
        inputRef?: HTMLInputElement | null;
    }

    let {
        filter,
        onFilterChange,
        searchTerm,
        onSearchChange,
        canExport,
        onExport,
        inputRef = $bindable<HTMLInputElement | null>(null),
    }: Props = $props();

    // 筛选栏展开状态（点击筛选按钮切换）
    let showFilters = $state(false);

    // 是否有任何筛选被应用（决定 spark 图标与导出按钮可见性）
    let filterApplied = $derived(!isFilterEmpty(filter));
    let showExport = $derived(canExport && filterApplied);

    // ToggleGroup multiple 的 value 是 string[]；用 Set ↔ 数组互转
    let learningValues = $derived<string[]>([...filter.learning]);
    let correctnessValues = $derived<string[]>([
        ...(filter.correctness.correct ? ["correct"] : []),
        ...(filter.correctness.incorrect ? ["incorrect"] : []),
    ]);

    function onLearningChange(values: string[]): void {
        onFilterChange({
            ...filter,
            learning: new Set(values as LearningStatus[]),
        });
    }

    function onCorrectnessChange(values: string[]): void {
        onFilterChange({
            ...filter,
            correctness: {
                correct: values.includes("correct"),
                incorrect: values.includes("incorrect"),
            },
        });
    }
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
                <div class="flex flex-wrap items-center gap-4">
                    <div class="flex flex-col items-start gap-1">
                        <span class="text-xs opacity-50">学习进度</span>
                        <ToggleGroup.Root
                            type="multiple"
                            value={learningValues}
                            spacing={1}
                            onValueChange={(v) =>
                                onLearningChange((v ?? []) as string[])}
                            variant="outline"
                            size="sm"
                            class="*:data-[state=on]:bg-primary/80 *:data-[state=on]:text-primary-foreground *:data-[state=on]:border-transparent"
                        >
                            <ToggleGroup.Item
                                value="mastered"
                                aria-label="已掌握"
                            >
                                <span class="text-xs">已掌握</span>
                            </ToggleGroup.Item>
                            <ToggleGroup.Item
                                value="learning"
                                aria-label="学习中"
                            >
                                <span class="text-xs">学习中</span>
                            </ToggleGroup.Item>
                            <ToggleGroup.Item
                                value="unlearned"
                                aria-label="未学习"
                            >
                                <span class="text-xs">未学习</span>
                            </ToggleGroup.Item>
                        </ToggleGroup.Root>
                    </div>

                    <div class="flex flex-col items-start gap-1">
                        <span class="text-xs opacity-50">答题正误</span>
                        <ToggleGroup.Root
                            type="multiple"
                            value={correctnessValues}
                            spacing={1}
                            onValueChange={(v) =>
                                onCorrectnessChange((v ?? []) as string[])}
                            variant="outline"
                            size="sm"
                            class="*:data-[state=on]:bg-primary/80 *:data-[state=on]:text-primary-foreground *:data-[state=on]:border-transparent"
                        >
                            <ToggleGroup.Item
                                value="correct"
                                aria-label="正确题目"
                            >
                                <span class="text-xs">正确</span>
                            </ToggleGroup.Item>
                            <ToggleGroup.Item
                                value="incorrect"
                                aria-label="错误题目"
                            >
                                <span class="text-xs">错误</span>
                            </ToggleGroup.Item>
                        </ToggleGroup.Root>
                    </div>
                </div>
                <Button
                    variant="outline"
                    size="xs"
                    onclick={onExport}
                    class={cn(
                        "tracking-normal rounded-full",
                        !showExport && "opacity-0 pointer-events-none",
                    )}
                >
                    <IconDatabaseExport size={16} stroke={1.75} /> 导出为新题库
                </Button>
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
