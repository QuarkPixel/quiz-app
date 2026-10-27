<script lang="ts">
    import type { Snippet } from "svelte";
    import * as Dialog from "$lib/components/ui/dialog";
    import { isCoarsePointer } from "$lib/utils";
    import type { FilterGroupDef } from "@/components/shared/FilterBar.svelte";
    import OverviewRail from "./OverviewRail.svelte";
    import OverviewFilterBar from "./OverviewFilterBar.svelte";
    import OverviewList from "./OverviewList.svelte";
    import type { QuestionGroup, QuestionRowContext } from "./list/types";

    /**
     * 总览窗口的外壳（刷题 / 记忆共用）。
     *
     * 版面只有上下两块：
     *   上：一条横向 rail —— 整排卡片（统计卡 + 热力图卡），高度一致，省垂直空间
     *   下：标题（展示题目 / 展示卡片）+ 虚拟列表，**只有列表可滚**
     *
     * 窗口本身不滚（`overflow-hidden`），所以不会出现「两个滚动区域打架」——
     * 触摸屏上手指划哪一块都不再有歧义。
     *
     * 这个文件不认识任何模式：顶部那一排卡片整段由调用方给（`cards` snippet，
     * 见 `QuizOverviewCards.svelte` / `MemoryOverviewCards.svelte`），数字、格子、
     * 筛选分组、行渲染也都是调用方给。外壳只负责把它们摆进 rail。
     */
    interface OverviewFilterConfig {
        subject: string;
        searchTerm: string;
        onSearchChange: (value: string) => void;
        searchPlaceholder: string;
        searchLabel: string;
        groups: FilterGroupDef[];
        scopeApplied: boolean;
        onExport: () => void;
        resultCount: number;
    }

    interface OverviewListConfig {
        groups: QuestionGroup[];
        withHeaders: boolean;
        jumpTarget: string | null;
        onJumpHandled: () => void;
        highlightId?: string | null;
        emptyText: string;
    }

    interface Props {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        /** 标题栏右侧那串题库 hash（与以前一致） */
        hash: string;
        /**
         * rail 里的**全部**卡片。由调用方原样画（`{@render cards()}`）——
         * 卡片在哪个文件、有几张、谁带热力图，外壳一概不管。
         */
        cards: Snippet;
        filter: OverviewFilterConfig;
        list: OverviewListConfig;
        row: Snippet<[QuestionRowContext]>;
    }

    let { open, onOpenChange, hash, cards, filter, list, row }: Props =
        $props();

    let searchInputRef = $state<HTMLInputElement | null>(null);
</script>

<Dialog.Root bind:open {onOpenChange}>
    <Dialog.Content
        onOpenAutoFocus={(e) => {
            // 默认会把焦点给第一个可聚焦元素。和以前一致：焦点给搜索框，
            // 触屏设备不抢焦点（免得弹键盘）
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
                <span class="text-foreground/40 font-mono text-xs">
                    {hash}
                </span>
            </div>
        </Dialog.Header>

        <div class="pt-3">
            <OverviewRail label="题库统计与热力图">
                {@render cards()}
            </OverviewRail>
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-3 px-5 pt-4 pb-3">
            <OverviewFilterBar
                subject={filter.subject}
                searchTerm={filter.searchTerm}
                onSearchChange={filter.onSearchChange}
                searchPlaceholder={filter.searchPlaceholder}
                searchLabel={filter.searchLabel}
                groups={filter.groups}
                scopeApplied={filter.scopeApplied}
                onExport={filter.onExport}
                resultCount={filter.resultCount}
                bind:inputRef={searchInputRef}
            />

            <OverviewList
                grouped={list.groups}
                withHeaders={list.withHeaders}
                jumpTarget={list.jumpTarget}
                onJumpHandled={list.onJumpHandled}
                highlightId={list.highlightId}
                emptyText={list.emptyText}
                {row}
            />
        </div>
    </Dialog.Content>
</Dialog.Root>
