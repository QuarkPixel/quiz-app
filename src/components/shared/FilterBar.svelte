<script module lang="ts">
    import type { IconComponent } from "@/quiz/types/types";

    /** 筛选面板里的一组多选按钮（如「学习进度」三个选项）。 */
    export interface FilterGroupDef {
        label: string;
        /** 当前选中的值 */
        values: string[];
        /** 无障碍名（不传就用按钮文字） */
        items: {
            value: string;
            label: string;
            name?: string;
            icon?: IconComponent;
        }[];
        onChange: (values: string[]) => void;
    }
</script>

<script lang="ts">
    import type { Snippet } from "svelte";
    import * as ToggleGroup from "$lib/components/ui/toggle-group";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import IconAlignBoxLeftStretch from "@tabler/icons-svelte/icons/align-box-left-stretch";
    import IconSearch from "@tabler/icons-svelte/icons/search";
    import IconFilter from "@tabler/icons-svelte/icons/filter-2";
    import IconFilterSpark from "@tabler/icons-svelte/icons/filter-2-spark";

    /**
     * 总览筛选栏的外壳：`图标 + 展示对象 + 点线 + 搜索框 + 筛选按钮`，
     * 展开后是多组 ToggleGroup。
     *
     * 刷题与记忆两个模式的筛选栏只在三处不同：展示对象的措辞、分组定义、
     * 以及展开面板右侧那块附加内容（刷题是「导出为新题库」，记忆还多一个结果数）。
     * 外壳只此一份——以前两个文件 200 多行几乎逐行重复，改一处必须记得改另一处。
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
        /** 展开面板右侧的附加内容（导出按钮 / 结果数），没有就不占位 */
        actions?: Snippet;
        /** 打开总览时把焦点放到搜索框（两个模式同一套做法） */
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
        actions,
        inputRef = $bindable<HTMLInputElement | null>(null),
    }: Props = $props();

    let showFilters = $state(false);
</script>

<div class="flex flex-col gap-1">
    <div class="flex flex-wrap items-center gap-x-2 gap-y-3">
        <IconAlignBoxLeftStretch
            size={16}
            stroke={1.75}
            class="text-muted-foreground shrink-0"
        />
        <span class="shrink-0 text-sm font-medium">{subject}</span>
        <!-- 点线是装饰：窄屏把它整条收掉，宽度全让给搜索框
             （两端都是 flex-1 的话 375px 下搜索框只剩几十像素） -->
        <span
            class="dotted-leader text-muted-foreground/40 min-w-8 flex-1 max-sm:hidden"
        ></span>
        <!-- 窄屏靠 flex-1 + min-w-0 与筛选按钮挤在同一排；
             宽屏恢复成固定宽度（sm:flex-none 让 w-72 说话） -->
        <div class="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
            <IconSearch
                class="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
            />
            <Input
                bind:ref={inputRef}
                value={searchTerm}
                oninput={(e) => onSearchChange(e.currentTarget.value)}
                class="pl-8"
                placeholder={searchPlaceholder}
                aria-label={searchLabel}
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
                    <!-- key 用下标：分组是静态的、不重排，用 label 做 key 会在
                         「同面板出现两个同名分组」时直接抛 each_key_duplicate -->
                    {#each groups as group, groupIndex (groupIndex)}
                        <div class="flex flex-col items-start gap-1">
                            <span class="text-xs opacity-50">{group.label}</span>
                            <ToggleGroup.Root
                                type="multiple"
                                value={group.values}
                                spacing={1}
                                onValueChange={(v) =>
                                    group.onChange((v ?? []) as string[])}
                                variant="outline"
                                size="sm"
                                class="*:data-[state=on]:bg-primary/80 *:data-[state=on]:text-primary-foreground *:data-[state=on]:border-transparent"
                            >
                                {#each group.items as item (item.value)}
                                    <ToggleGroup.Item
                                        value={item.value}
                                        aria-label={item.name ?? item.label}
                                    >
                                        {#if item.icon}
                                            <item.icon />
                                        {/if}
                                        <span class="text-xs">{item.label}</span>
                                    </ToggleGroup.Item>
                                {/each}
                            </ToggleGroup.Root>
                        </div>
                    {/each}
                </div>

                {@render actions?.()}
            </div>
        </div>
    </div>
</div>
