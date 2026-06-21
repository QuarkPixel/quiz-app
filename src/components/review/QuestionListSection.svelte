<script lang="ts">
    import { IconFishBoneFilled } from "@tabler/icons-svelte";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import { useQuizSession } from "@/quiz/session/context";
    import { getVisibleRange } from "./virtualList/layout";
    import { VirtualScroll } from "./virtualList/useVirtualScroll.svelte";
    import { CopyStatus } from "./useCopyStatus.svelte";
    import QuestionCard from "./QuestionCard.svelte";
    import type { QuestionGroup } from "./virtualList/types";

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
    const vs = new VirtualScroll();
    const copy = new CopyStatus(session);

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
        <span class="ml-2 text-muted-foreground">当前筛选条件下没有题目</span>
    </div>
{:else}
    <div
        bind:this={vs.listEl}
        bind:clientHeight={vs.viewportHeight}
        onscroll={(e) => (vs.scrollTop = e.currentTarget.scrollTop)}
        class="min-h-96 flex-1 overflow-y-auto overflow-x-hidden px-3 relative"
    >
        <div
            class="sticky top-0 left-0 w-[calc(100%+1.5rem)] -translate-x-3 -translate-y-1 bg-card h-6 -mb-6 z-10"
        ></div>

        {#each vs.layouts as section (section.header.id)}
            {@const Icon = QUESTION_TYPES[section.header.questionType].icon}
            {@const range = getVisibleRange(
                section,
                vs.scrollTop,
                vs.viewportHeight,
                vs.resolveHeight,
            )}
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
                                <QuestionCard
                                    question={qItem.question}
                                    indicator={qItem.indicator}
                                    selected={selectedQuestionId === qItem.question.id}
                                    copyStatus={copy.get(qItem.question.id)}
                                    onCopy={(e, q) => copy.copy(e, q)}
                                />
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
