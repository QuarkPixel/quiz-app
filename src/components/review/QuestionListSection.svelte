<script lang="ts">
    import type { Snippet } from "svelte";
    import { IconFishBoneFilled } from "@tabler/icons-svelte";
    import { cn } from "$lib/utils";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import { useQuizSession } from "@/quiz/session/context";
    import { getVisibleRange } from "./virtualList/layout";
    import { VirtualScroll } from "./virtualList/useVirtualScroll.svelte";
    import { QuestionCopyStatusStore } from "../quiz/useQuestionCopyStatus.svelte";
    import QuestionCard from "./QuestionCard.svelte";
    import type {
        QuestionGroup,
        QuestionRowContext,
    } from "./virtualList/types";

    interface Props {
        grouped: QuestionGroup[];
        /** 刷题模式里被点中的题（记忆模式没有这个状态） */
        selectedQuestionId?: string | null;
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
        /**
         * 自定义行渲染。不传时渲染刷题模式的 `QuestionCard`。
         *
         * 用了它就意味着「这一行归调用方画」：调用方要按需在自己的根节点上
         * 打 `data-review-question-id={question.id}`（虚拟滚动的跳转收敛靠它
         * 找已挂载的行），列表不再套 `QuestionCard`。
         */
        row?: Snippet<[QuestionRowContext]>;
        /** 空列表文案（记忆模式说的是「卡片」） */
        emptyText?: string;
    }

    let {
        grouped,
        selectedQuestionId = null,
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

    // 走自定义行渲染时用不到复制按钮状态（复制按钮由调用方画），此时不去取刷题
    // 会话：记忆模式没有 provideQuizSession，硬取会直接抛错。有没有 `row` 同样
    // 由调用方在构造时定死。
    // svelte-ignore state_referenced_locally
    const copy = row ? null : new QuestionCopyStatusStore(useQuizSession());

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
    <div class="min-h-48 flex-1 px-3 py-10 flex items-center flex-col">
        <IconFishBoneFilled size={64} class="text-muted-foreground" />
        <span class="ml-2 text-muted-foreground">{emptyText}</span>
    </div>
{:else}
    <div
        bind:this={vs.listEl}
        bind:clientHeight={vs.viewportHeight}
        onscroll={(e) => (vs.scrollTop = e.currentTarget.scrollTop)}
        class="min-h-96 flex-1 overflow-y-auto overflow-x-hidden px-3 relative"
    >
        <!-- 顶部遮罩：有分组头时是一条实心色带，用来盖住从 sticky 标题条上方
             露出来的卡片；无分组头时没有要盖的东西，实心色带只会压掉第一张卡
             的顶边，所以换成渐变——边缘一样是柔的，但不吃内容。 -->
        <div
            class={cn(
                "sticky top-0 left-0 w-[calc(100%+1.5rem)] -translate-x-3 -translate-y-1 h-6 -mb-6 z-10",
                withHeaders
                    ? "bg-card"
                    : "bg-linear-to-b from-card to-transparent",
            )}
        ></div>

        {#each vs.layouts as section, sectionIndex (section.header?.id ?? `section-${sectionIndex}`)}
            {#if section.header}
                {@const Icon = QUESTION_TYPES[section.header.questionType].icon}
                <div
                    class="sticky top-1 rounded-full z-10 bg-card border border-foreground/10 flex items-center gap-2 py-1.5 pl-3 -mx-2 mt-3 nth-of-type-2:mt-0"
                    use:vs.measureHeight={section.header.id}
                >
                    <Icon size={14} stroke={1.75} class="text-muted-foreground" />
                    <span class="text-xs font-medium tracking-wide">
                        {QUESTION_TYPES[section.header.questionType].name}
                    </span>
                    <span class="text-muted-foreground text-xs tabular-nums">
                        {section.header.count}
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
                                {#if row}
                                    {@render row({
                                        question: qItem.question,
                                        highlight: highlightId === qItem.id,
                                    })}
                                {:else if copy}
                                    <QuestionCard
                                        question={qItem.question}
                                        indicator={qItem.indicator}
                                        selected={selectedQuestionId ===
                                            qItem.question.id}
                                        copyStatus={copy.get(qItem.question.id)}
                                        onCopy={(e, q) => copy.copy(e, q)}
                                    />
                                {/if}
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
