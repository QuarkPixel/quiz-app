<script lang="ts">
    import type { Snippet } from "svelte";
    import IconFishBoneFilled from "@tabler/icons-svelte/icons/fish-bone-filled";
    import { cn } from "$lib/utils";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import { getVisibleRange } from "./list/layout";
    import { VirtualScroll } from "./list/useVirtualScroll.svelte";
    import type { QuestionGroup, QuestionRowContext } from "./list/types";

    /**
     * 总览下半部分的虚拟列表。
     *
     * 只做布局与虚拟滚动，**不认识任何模式**：行由调用方的 `row` snippet 画
     * （刷题模式是 `QuizOverviewRow`，记忆模式是「状态 + 题号」那张卡）。
     * 以前这里还带一个「不传 row 就画刷题卡片」的兜底，于是组件必须去取
     * `QuizSession`——记忆模式没有 provide 它，硬取会直接抛错。现在两个调用方
     * 都必须给 `row`，依赖方向干净了。
     *
     * 行根节点要自己打 `data-review-question-id={question.id}`：虚拟滚动的跳转
     * 收敛靠它认「已挂载的行」。
     */
    interface Props {
        grouped: QuestionGroup[];
        jumpTarget: string | null;
        onJumpHandled: () => void;
        /**
         * 是否插题型分组头。记忆模式只有一种题型，传 false：
         * 列表里没有那条 sticky 标题条，布局里也没有它的高度。
         * 构造时定死——列表长什么样是版面选择，中途改只会白算一遍布局。
         */
        withHeaders?: boolean;
        /** 跳转高亮的目标题；只透传给 `row`，列表自己不负责计时与上色 */
        highlightId?: string | null;
        row: Snippet<[QuestionRowContext]>;
        /** 空列表文案（记忆模式说的是「卡片」） */
        emptyText?: string;
    }

    let {
        grouped,
        jumpTarget = null,
        onJumpHandled,
        withHeaders = true,
        highlightId = null,
        row,
        emptyText = "当前筛选条件下没有题目",
    }: Props = $props();

    // 版面选择取构造时的值就够（两个调用方都传常量，中途不会变）
    // svelte-ignore state_referenced_locally
    const vs = new VirtualScroll({ withHeaders });

    // 把响应式 prop 喂给控制器，触发其内部 layouts 重算
    $effect(() => {
        vs.grouped = grouped;
    });

    // 防快速连点竞态：新跳转取代旧的时，旧的不清 jumpTarget
    let jumpSeq = 0;
    $effect(() => {
        const id = jumpTarget;
        if (!id) return;
        const seq = ++jumpSeq;
        requestAnimationFrame(() => {
            if (seq !== jumpSeq) return;
            vs.performJump(id, () => seq === jumpSeq).then(() => {
                if (seq === jumpSeq) onJumpHandled();
            });
        });
    });
</script>

{#if grouped.length === 0}
    <div class="flex min-h-48 flex-1 flex-col items-center px-3 py-10">
        <IconFishBoneFilled size={64} class="text-muted-foreground" />
        <span class="text-muted-foreground ml-2">{emptyText}</span>
    </div>
{:else}
    <div
        bind:this={vs.listEl}
        bind:clientHeight={vs.viewportHeight}
        onscroll={(e) => (vs.scrollTop = e.currentTarget.scrollTop)}
        class="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3"
    >
        <!-- 顶部遮罩：有分组头时是一条实心色带，用来盖住从 sticky 标题条上方
             露出来的卡片；无分组头时没有要盖的东西，实心色带只会压掉第一张卡
             的顶边，所以换成渐变——边缘一样是柔的，但不吃内容。 -->
        <div
            class={cn(
                "sticky top-0 left-0 z-10 -mb-6 h-6 w-[calc(100%+1.5rem)] -translate-x-3 -translate-y-1",
                withHeaders
                    ? "bg-card"
                    : "bg-linear-to-b from-card to-transparent",
            )}
        ></div>

        {#each vs.layouts as section, sectionIndex (section.header?.id ?? `section-${sectionIndex}`)}
            {#if section.header}
                {@const Icon = QUESTION_TYPES[section.header.questionType].icon}
                <div
                    class={cn(
                        "bg-card border-foreground/10 sticky top-1 z-10 -mx-2 flex items-center gap-2 rounded-full border py-1.5 pr-3 pl-3",
                        sectionIndex > 0 && "mt-3",
                    )}
                    use:vs.measureHeight={section.header.id}
                >
                    <Icon size={14} stroke={1.75} class="text-muted-foreground" />
                    <span class="text-xs font-medium tracking-wide">
                        {QUESTION_TYPES[section.header.questionType].name}
                    </span>
                    <span class="text-muted-foreground text-xs tabular-nums">
                        {section.header.count} 题
                    </span>
                </div>
            {/if}

            {@const range = getVisibleRange(
                section,
                vs.scrollTop,
                vs.viewportHeight,
                vs.resolveHeight,
            )}

            <!-- 题目区域：相对定位容器，高度撑开，内部 absolute 定位 -->
            <div
                class="px-3"
                style="position: relative; height: {section.questionsTotalHeight}px; width: 100%;"
            >
                {#if range && section.questionItems.length > 0}
                    {#each section.questionItems.slice(range.start, range.end + 1) as qItem, i (qItem.id)}
                        {@const idx = range.start + i}
                        <div
                            style="position: absolute; left: 0; right: 0; top: {section.questionOffsets[idx]}px;"
                            use:vs.measureHeight={qItem.id}
                        >
                            <div class="pt-2">
                                {@render row({
                                    question: qItem.question,
                                    highlight: highlightId === qItem.id,
                                })}
                            </div>
                        </div>
                    {/each}
                {/if}
            </div>
        {/each}
        <div
            class="from-card sticky bottom-0 left-0 z-10 h-16 w-[calc(100%+1.5rem)] -translate-x-3 translate-y-1 bg-linear-to-t to-transparent"
        ></div>
    </div>
{/if}
