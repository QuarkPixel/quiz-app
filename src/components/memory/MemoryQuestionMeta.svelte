<script lang="ts">
    import CopyQuestionButton from "../quiz/CopyQuestionButton.svelte";
    import StreakIndicator from "../quiz/StreakIndicator.svelte";
    import { useMemorySession } from "@/features/memory/context";
    import { QUESTION_TYPES } from "@/quiz/types/registry";

    /**
     * 记忆模式答题区顶部那一行：题型图标 · 题号 · 复制 · 连对进度。
     *
     * 与刷题模式共用同一个槽（`ViewShell` 的 `header`），所以换模式时这一行的位置
     * 不会跳。连对进度只有一颗圆点时**整颗 indicator 都不出现**：
     * 一颗点只说明「答对一次就算过」，那是默认状态，摆在右上角纯属噪声。
     * 复习轮尤其明显——绝大多数卡的目标都是 1，答错之后才会变成多颗。
     */
    const session = useMemorySession();

    const typeIcon = $derived(
        session.currentQuestion
            ? (QUESTION_TYPES[session.currentQuestion.type]?.icon ?? null)
            : null,
    );

    /** 只有「需要连对多次」才值得显示进度点 */
    const showStreak = $derived(
        session.currentPoolItem !== undefined && session.requiredStreak > 1,
    );
</script>

{#if session.currentQuestion}
    <div class="flex min-h-8 items-center gap-3">
        {#if typeIcon}
            {#key session.currentQuestion.type}
                {@const TypeIcon = typeIcon}
                <TypeIcon
                    size={16}
                    stroke={1.75}
                    class="text-muted-foreground shrink-0"
                />
            {/key}
        {/if}

        <div class="flex min-w-0 items-center gap-1 text-muted-foreground">
            <span class="truncate text-xs font-mono">
                {session.currentQuestion.id}
            </span>
            <CopyQuestionButton
                status={session.copyQuestionStatus}
                onclick={() => void session.copyCurrentQuestion()}
            />
        </div>

        {#if showStreak}
            <div class="ml-auto flex items-center">
                <!-- 只展示连对进度：刷题模式那个「双击标记为已掌握」在记忆模式里
                     没有对应语义（掌握只能靠连对够次数毕业），所以传 readonly，
                     不给出会误导的掌握按钮 -->
                <StreakIndicator
                    item={session.currentPoolItem}
                    requiredStreak={session.requiredStreak}
                    maxLevel={session.requiredStreak}
                    readonly
                />
            </div>
        {/if}
    </div>
{/if}
