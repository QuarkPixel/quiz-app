<script lang="ts">
    import type { ActivePoolItem, Question, QuestionType } from "../types";
    import { cn } from "$lib/utils";
    import { QUESTION_TYPES } from "../quiz/types/registry";
    import StreakIndicator from "./StreakIndicator.svelte";

    interface ReviewIndicator {
        item: ActivePoolItem;
        requiredStreak: number;
        maxLevel: number;
    }

    interface GroupedItem {
        question: Question;
        indicator: ReviewIndicator | null;
    }

    interface QuestionGroup {
        type: QuestionType;
        items: GroupedItem[];
    }

    interface Props {
        grouped: QuestionGroup[];
        selectedQuestionId: string | null;
        jumpTarget: string | null;
        onJumpHandled: () => void;
    }

    let {
        grouped,
        selectedQuestionId,
        jumpTarget = null,
        onJumpHandled,
    }: Props = $props();

    // --- 类型定义 ---
    interface FlatHeader {
        type: "header";
        id: string;
        questionType: QuestionType;
        count: number;
    }

    interface FlatQuestion {
        type: "question";
        id: string;
        question: Question;
        indicator: ReviewIndicator | null;
    }

    interface Section {
        header: FlatHeader;
        questionItems: FlatQuestion[];
    }

    interface SectionLayout extends Section {
        y: number;
        headerHeight: number;
        questionsTotalHeight: number;
        questionOffsets: number[];
    }

    // --- 虚拟滚动状态 ---
    let listEl: HTMLDivElement | null = $state(null);
    let scrollTop = $state(0);
    let viewportHeight = $state(400);
    let measuredHeights: Record<string, number> = $state({});

    const ESTIMATED_HEADER_HEIGHT = 41;
    const ESTIMATED_QUESTION_HEIGHT = 84.75;
    const BUFFER_PX = 400;
    const OVERSCROLL_PX = 480;

    // --- 扁平化数据 ---
    let flatItems = $derived<FlatItem[]>(
        grouped.flatMap((group) => {
            const header: FlatHeader = {
                type: "header",
                id: `header-${group.type}`,
                questionType: group.type,
                count: group.items.length,
            };
            const questions: FlatQuestion[] = group.items.map((item) => ({
                type: "question",
                id: item.question.id,
                question: item.question,
                indicator: item.indicator,
            }));
            return [header, ...questions];
        }),
    );

    type FlatItem = FlatHeader | FlatQuestion;

    // --- 按 section 分组 ---
    let sections = $derived.by<Section[]>(() => {
        const result: Section[] = [];
        let current: Section | null = null;
        for (const item of flatItems) {
            if (item.type === "header") {
                current = { header: item, questionItems: [] };
                result.push(current);
            } else {
                current?.questionItems.push(item);
            }
        }
        return result;
    });

    // --- 计算某个 section 内可见的题目范围 ---
    function getVisibleRange(
        section: SectionLayout,
    ): { start: number; end: number } | null {
        const qStart = section.y + section.headerHeight;
        const qEnd = qStart + section.questionsTotalHeight;

        if (
            qEnd <= scrollTop - BUFFER_PX ||
            qStart >= scrollTop + viewportHeight + BUFFER_PX
        ) {
            return null;
        }

        if (section.questionItems.length === 0) return null;

        const viewStart = scrollTop - BUFFER_PX;
        const viewEnd = scrollTop + viewportHeight + BUFFER_PX;

        let startIdx = section.questionItems.length;
        let endIdx = -1;

        for (let i = 0; i < section.questionItems.length; i++) {
            const itemTop = qStart + section.questionOffsets[i];
            const itemH =
                measuredHeights[section.questionItems[i].id] ??
                ESTIMATED_QUESTION_HEIGHT;
            const itemBottom = itemTop + itemH;

            if (itemBottom > viewStart && itemTop < viewEnd) {
                if (i < startIdx) startIdx = i;
                if (i > endIdx) endIdx = i;
            }
        }

        if (startIdx > endIdx) return null;
        return { start: startIdx, end: endIdx };
    }

    // --- Svelte Action: 测量真实高度 ---
    function measureHeight(node: HTMLElement, id: string) {
        const update = () => {
            const h = node.offsetHeight;
            if (measuredHeights[id] !== h) {
                measuredHeights[id] = h;
            }
        };

        update();
        const ro = new ResizeObserver(update);
        ro.observe(node);

        return {
            destroy() {
                ro.disconnect();
            },
        };
    }

    // --- 实际高度缓存：持久化已渲染过的真实高度，切换筛选/搜索后仍可复用 ---
    let actualHeights = $state<Record<string, number>>({});

    function getHeight(id: string): number {
        return (
            actualHeights[id] ??
            measuredHeights[id] ??
            ESTIMATED_QUESTION_HEIGHT
        );
    }

    // 每当 measureHeight 更新了某 item，就写入 actualHeights 以备布局使用
    $effect(() => {
        for (const [id, h] of Object.entries(measuredHeights)) {
            actualHeights[id] = h;
        }
    });

    // --- 精确布局：基于真实高度（或估算值）计算 section 位置 ---
    let preciseLayouts = $derived.by<SectionLayout[]>(() => {
        let y = 0;
        return sections.map((section) => {
            const headerHeight =
                measuredHeights[section.header.id] ?? ESTIMATED_HEADER_HEIGHT;
            const questionHeights = section.questionItems.map((q) =>
                getHeight(q.id),
            );
            const questionsTotalHeight = questionHeights.reduce(
                (a, b) => a + b,
                0,
            );

            const questionOffsets: number[] = [];
            let offset = 0;
            for (const h of questionHeights) {
                questionOffsets.push(offset);
                offset += h;
            }

            const layout: SectionLayout = {
                ...section,
                y,
                headerHeight,
                questionsTotalHeight,
                questionOffsets,
            };
            y += headerHeight + questionsTotalHeight;
            return layout;
        });
    });

    function findQuestionTop(id: string): number | null {
        for (const section of preciseLayouts) {
            const qIdx = section.questionItems.findIndex((q) => q.id === id);
            if (qIdx === -1) continue;

            const height = getHeight(id);
            const questionY =
                section.y +
                section.headerHeight +
                section.questionOffsets[qIdx];
            return questionY - viewportHeight / 2 + height / 2;
        }
        return null;
    }

    function smoothScrollTo(id: string) {
        const targetTop = findQuestionTop(id);
        if (targetTop != null && listEl) {
            listEl.scrollTo({
                top: Math.max(0, targetTop),
                behavior: "smooth",
            });
        }
    }

    $effect(() => {
        if (jumpTarget) {
            requestAnimationFrame(() => {
                const targetTop = findQuestionTop(jumpTarget);
                if (targetTop == null) {
                    onJumpHandled();
                    return;
                }

                const currentScroll = listEl?.scrollTop ?? 0;
                const distance = Math.abs(targetTop - currentScroll);

                // 已有真实高度（曾被渲染过）或距离在一屏内 → 直接平滑跳转
                const hasRealHeight = actualHeights[jumpTarget] != null;
                const isClose = distance < viewportHeight;
                if (hasRealHeight || isClose) {
                    smoothScrollTo(jumpTarget);
                    onJumpHandled();
                    return;
                }

                // 远距离 + 无真实高度 → 冲过头两段跳转
                const goingDown = targetTop > currentScroll;
                const overshootTop = goingDown
                    ? Math.max(0, targetTop - OVERSCROLL_PX)
                    : targetTop + OVERSCROLL_PX;

                // Phase 1: 冲过头，触发虚拟滚动渲染目标区域
                listEl?.scrollTo({
                    top: overshootTop,
                    behavior: "instant",
                });

                // 等 DOM 渲染 + ResizeObserver + Svelte 更新 preciseLayouts
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        // Phase 2: 从冲过头位置平滑滚回精准目标
                        smoothScrollTo(jumpTarget);
                        onJumpHandled();
                    });
                });
            });
        }
    });
</script>

{#if grouped.length === 0}
    <div
        class="min-h-48 flex-1 overflow-y-auto rounded-md border bg-muted/10 px-3 py-2"
    >
        <div
            class="text-muted-foreground flex min-h-32 items-center justify-center text-sm"
        >
            当前筛选条件下没有题目
        </div>
    </div>
{:else}
    <div
        bind:this={listEl}
        bind:clientHeight={viewportHeight}
        onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
        class="min-h-96 flex-1 overflow-y-auto rounded-md border bg-muted/10 px-3"
    >
        {#each preciseLayouts as section (section.header.id)}
            {@const Icon = QUESTION_TYPES[section.header.questionType].icon}
            {@const range = getVisibleRange(section)}

            <div
                class="sticky top-0 z-10 bg-card border-b flex items-center gap-2 py-1.5 pl-3 -mx-3 mt-3"
                use:measureHeight={section.header.id}
            >
                <Icon size={14} stroke={1.75} class="text-muted-foreground" />
                <span class="text-xs font-medium tracking-wide">
                    {QUESTION_TYPES[section.header.questionType].name}
                </span>
                <span class="text-muted-foreground text-xs tabular-nums">
                    {section.header.count}
                </span>
            </div>

            <!-- 题目区域：相对定位容器，高度撑开，内部 absolute 定位 -->
            <div
                class="px-3"
                style="position: relative; height: {section.questionsTotalHeight}px; width: 100%;"
            >
                {#if range && section.questionItems.length > 0}
                    {#each section.questionItems.slice(range.start, range.end + 1) as qItem, i (qItem.id)}
                        {@const idx = range.start + i}
                        {@const question = qItem.question}
                        {@const indicator = qItem.indicator}
                        {@const ReviewComponent =
                            QUESTION_TYPES[question.type].Review}

                        <div
                            style="position: absolute; left: 0; right: 0; top: {section
                                .questionOffsets[idx]}px;"
                            use:measureHeight={qItem.id}
                        >
                            <div class="pt-2">
                                <div
                                    data-review-question-id={question.id}
                                    class={cn(
                                        "border-border/60 bg-muted/40 flex flex-col gap-2 rounded-lg border px-4 py-3 transition-[background-color,border-color,box-shadow] duration-300",
                                        selectedQuestionId === question.id &&
                                            "border-foreground/40 bg-muted shadow-sm ring-2 ring-foreground/15",
                                    )}
                                >
                                    <div class="flex gap-2">
                                        <span
                                            class="text-foreground flex-1 text-sm leading-relaxed font-medium whitespace-pre-wrap"
                                        >
                                            {question.question}
                                        </span>
                                        <div
                                            class="flex shrink-0 items-center gap-2 pt-0.5"
                                        >
                                            {#if indicator}
                                                <StreakIndicator
                                                    item={indicator.item}
                                                    requiredStreak={indicator.requiredStreak}
                                                    maxLevel={indicator.maxLevel}
                                                    size="compact"
                                                    readonly
                                                />
                                            {/if}
                                            <span
                                                class="text-muted-foreground text-xs font-mono"
                                            >
                                                {question.id}
                                            </span>
                                        </div>
                                    </div>

                                    <ReviewComponent {question} />
                                </div>
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
        {/each}
    </div>
{/if}
