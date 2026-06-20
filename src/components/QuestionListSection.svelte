<script lang="ts">
    import type { ActivePoolItem, Question, QuestionType } from "../types";
    import { cn } from "$lib/utils";
    import { QUESTION_TYPES } from "../quiz/types/registry";
    import StreakIndicator from "./StreakIndicator.svelte";
    import CopyQuestionButton from "./CopyQuestionButton.svelte";
    import { IconFishBoneFilled } from "@tabler/icons-svelte";
    import { useQuizSession } from "../quiz/session/context";
    import type { CopyQuestionStatus } from "../quiz/session/QuizSession.svelte";

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

    const session = useQuizSession();

    // --- 每道题的复制按钮状态 ---
    let copyStatuses: Record<string, CopyQuestionStatus> = $state({});
    let copyTimers: Record<string, ReturnType<typeof setTimeout>> = {};

    function getCopyStatus(id: string): CopyQuestionStatus {
        return copyStatuses[id] ?? "idle";
    }

    function setCopyStatus(id: string, status: CopyQuestionStatus): void {
        if (copyTimers[id]) {
            clearTimeout(copyTimers[id]);
            delete copyTimers[id];
        }
        copyStatuses[id] = status;
        if (status !== "idle") {
            copyTimers[id] = setTimeout(() => {
                copyStatuses[id] = "idle";
                delete copyTimers[id];
            }, 1800);
        }
    }

    async function copyQuestion(
        event: MouseEvent,
        question: Question,
    ): Promise<void> {
        event.stopPropagation();
        const result = await session.copyQuestionText(question);
        setCopyStatus(question.id, result === "copied" ? "copied" : "error");
    }

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
    const BUFFER_PX = 400;

    // 按题型估算题目高度（未测量时用）。单选/多选按选项数 62 + n*31.25，默认 4 项 = 187px
    function estimateQuestionHeight(question: Question): number {
        switch (question.type) {
            case "single":
            case "multiple": {
                const n = question.options?.length ?? 4;
                return 62 + n * 31.25;
            }
            case "judgment":
            case "blank":
                return 86;
        }
    }

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
            const qItem = section.questionItems[i];
            const itemTop = qStart + section.questionOffsets[i];
            const itemH =
                measuredHeights[qItem.id] ??
                estimateQuestionHeight(qItem.question);
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

    function getHeight(id: string, question: Question): number {
        return (
            actualHeights[id] ??
            measuredHeights[id] ??
            estimateQuestionHeight(question)
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
                getHeight(q.id, q.question),
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

            const height = getHeight(id, section.questionItems[qIdx].question);
            const questionY =
                section.y +
                section.headerHeight +
                section.questionOffsets[qIdx];
            return questionY - viewportHeight / 2 + height / 2;
        }
        return null;
    }

    // 题目全局序号：跳转收敛时用「真实挂载顺序」判断方向，绕开累积估算误差
    let idToRank = $derived.by<Map<string, number>>(() => {
        const map = new Map<string, number>();
        flatItems.forEach((item, i) => map.set(item.id, i));
        return map;
    });

    function findMountedNode(id: string): HTMLElement | null {
        const nodes =
            listEl?.querySelectorAll<HTMLElement>(
                "[data-review-question-id]",
            ) ?? [];
        for (const node of nodes) {
            if (node.dataset.reviewQuestionId === id) return node;
        }
        return null;
    }

    function clampScroll(top: number): number {
        if (!listEl) return 0;
        const max = listEl.scrollHeight - listEl.clientHeight;
        return Math.max(0, Math.min(top, max));
    }

    function nextFrame(): Promise<void> {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    // 当前挂载题目中最接近视口中心的那一个：返回其绝对 Y、序号、以及挂载题目的平均高度
    function centerAnchor(): {
        absY: number;
        rank: number;
        avgH: number;
    } | null {
        if (!listEl) return null;
        const nodes = listEl.querySelectorAll<HTMLElement>(
            "[data-review-question-id]",
        );
        if (nodes.length === 0) return null;
        const containerTop = listEl.getBoundingClientRect().top;
        const currentScroll = listEl.scrollTop;
        const center = currentScroll + viewportHeight / 2;

        let bestAbsY = 0;
        let bestRank = -1;
        let bestDist = Infinity;
        let totalH = 0;
        for (const node of nodes) {
            const rect = node.getBoundingClientRect();
            const absY = rect.top - containerTop + currentScroll;
            totalH += rect.height;
            const dist = Math.abs(absY + rect.height / 2 - center);
            if (dist < bestDist) {
                bestDist = dist;
                bestAbsY = absY;
                bestRank =
                    idToRank.get(node.dataset.reviewQuestionId ?? "") ?? -1;
            }
        }
        return { absY: bestAbsY, rank: bestRank, avgH: totalH / nodes.length };
    }

    const MAX_CONVERGE = 8;

    // 等目标被 ResizeObserver 测量、且 findQuestionTop 连续两帧不变（布局稳定）后返回精准位置
    async function waitForStableTop(
        id: string,
        isCurrent: () => boolean,
    ): Promise<number | null> {
        let lastTop: number | null = null;
        let stable = 0;
        for (let i = 0; i < 40; i++) {
            await nextFrame();
            if (!isCurrent()) return null;
            if (!findMountedNode(id) || actualHeights[id] == null) continue;
            const top = findQuestionTop(id);
            if (top == null) continue;
            if (top === lastTop) {
                if (++stable >= 2) return top;
            } else {
                stable = 0;
                lastTop = top;
            }
        }
        return findQuestionTop(id);
    }

    async function performJump(
        id: string,
        isCurrent: () => boolean,
    ): Promise<void> {
        if (!listEl) return;
        const startScroll = listEl.scrollTop;

        // 已有真实高度（曾被渲染测量过）→ 位置足够精准，整段平滑滚动，保留完整动画
        if (actualHeights[id] != null) {
            const top = findQuestionTop(id);
            if (top != null && isCurrent()) {
                listEl?.scrollTo({ top: clampScroll(top), behavior: "smooth" });
            }
            return;
        }

        // Phase 1：目标未挂载 → 迭代即时滚动直到它进入渲染窗口
        if (!findMountedNode(id)) {
            let estimate = findQuestionTop(id);
            if (estimate == null) return;
            for (let i = 0; i < MAX_CONVERGE; i++) {
                if (!isCurrent()) return;
                listEl?.scrollTo({
                    top: clampScroll(estimate),
                    behavior: "instant",
                });
                await nextFrame();
                if (!isCurrent()) return;
                if (findMountedNode(id)) break;

                // 用真实挂载顺序修正估算：以视口中心题为锚，按序号差 × 真实平均高度平移
                const anchor = centerAnchor();
                const targetRank = idToRank.get(id);
                if (!anchor || anchor.rank < 0 || targetRank == null) break;
                const dRank = targetRank - anchor.rank;
                if (dRank === 0) break;
                estimate =
                    anchor.absY + dRank * anchor.avgH - viewportHeight / 2;
            }
        }

        // Phase 2：等测量与布局稳定，拿到精准目标位置
        const targetTop = await waitForStableTop(id, isCurrent);
        if (targetTop == null || !isCurrent()) return;

        // 本来就近 → 直接平滑滚动（自然短动画）
        const glide = Math.max(240, Math.min(viewportHeight * 0.7, 560));
        if (Math.abs(targetTop - startScroll) < glide) {
            listEl?.scrollTo({
                top: clampScroll(targetTop),
                behavior: "smooth",
            });
            return;
        }

        // Phase 3：远距离首次访问 → 从行进方向外 glide 处即时定位，再平滑滑入，模拟减速到位
        const goingDown = targetTop > startScroll;
        const launchTop = goingDown ? targetTop - glide : targetTop + glide;
        if (Math.abs((listEl?.scrollTop ?? 0) - targetTop) < glide) {
            listEl?.scrollTo({
                top: clampScroll(launchTop),
                behavior: "instant",
            });
            await nextFrame();
        }
        listEl?.scrollTo({ top: clampScroll(targetTop), behavior: "smooth" });
    }

    // 防快速连点竞态：新跳转取代旧的时，旧的不清 jumpTarget
    let jumpSeq = 0;
    $effect(() => {
        const id = jumpTarget;
        if (!id) return;
        const seq = ++jumpSeq;
        requestAnimationFrame(() => {
            if (seq !== jumpSeq) return;
            performJump(id, () => seq === jumpSeq).then(() => {
                if (seq === jumpSeq) onJumpHandled();
            });
        });
    });
</script>

{#if grouped.length === 0}
    <div class="min-h-48 flex-1 px-3 py-10 flex items-center flex-col">
        <IconFishBoneFilled size={64} class="text-muted-foreground" />
        <span class="ml-2 text-muted-foreground">当前筛选条件下没有题目</span>
    </div>
{:else}
    <div
        bind:this={listEl}
        bind:clientHeight={viewportHeight}
        onscroll={(e) => (scrollTop = e.currentTarget.scrollTop)}
        class="min-h-96 flex-1 overflow-y-auto overflow-x-hidden px-3 relative"
    >
        <div
            class="sticky top-0 left-0 w-[calc(100%+1.5rem)] -translate-x-3 -translate-y-1 bg-card h-6 -mb-6 z-10"
        ></div>

        {#each preciseLayouts as section (section.header.id)}
            {@const Icon = QUESTION_TYPES[section.header.questionType].icon}
            {@const range = getVisibleRange(section)}
            <div
                class="sticky top-1 rounded-full z-10 bg-card border border-foreground/10 flex items-center gap-2 py-1.5 pl-3 -mx-2 mt-3 nth-of-type-2:mt-0"
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
                                            "border-foreground/20 bg-background ring-4 ring-foreground/5",
                                    )}
                                >
                                    <div class="flex gap-2">
                                        <div class="flex-1 flex items-center">
                                            <span
                                                class="text-foreground text-sm leading-relaxed font-medium whitespace-pre-wrap"
                                            >
                                                {question.question}
                                            </span>
                                            <CopyQuestionButton
                                                status={getCopyStatus(
                                                    question.id,
                                                )}
                                                onclick={(e: MouseEvent) =>
                                                    copyQuestion(
                                                        e,
                                                        question,
                                                    )}
                                            />
                                        </div>
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
        <div
            class="sticky bottom-0 left-0 w-[calc(100%+1.5rem)] -translate-x-3 translate-y-1 bg-linear-to-t from-card to-transparent h-16 z-10"
        ></div>
    </div>
{/if}
