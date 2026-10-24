<script lang="ts">
    import CopyQuestionButton from "./CopyQuestionButton.svelte";
    import StreakIndicator from "./StreakIndicator.svelte";
    import { QUESTION_TYPES } from "@/quiz/types/registry";
    import { useQuizSession } from "@/quiz/session/context";

    /**
     * 答题区顶部那一行：题型图标 · 题号 · 复制 · 掌握进度。
     *
     * 它**不在滚动区里**（见 `ViewShell` 的版面说明）：题干再长，题号与连对进度
     * 都还钉在顶上。新题预览（`isPreviewingNewQuestion`）共用同一行，只是右边那颗
     * 从「掌握进度」换成 `PREVIEW` 徽标——以前那是两份几乎一样的模板，现在只有
     * 右边这一处分支。
     */
    const session = useQuizSession();

    const previewing = $derived(session.isPreviewingNewQuestion);
    const question = $derived(
        previewing ? session.currentNewQuestion : session.currentQuestion,
    );
    const typeIcon = $derived(
        question ? (QUESTION_TYPES[question.type]?.icon ?? null) : null,
    );

    async function copy(event: MouseEvent): Promise<void> {
        event.stopPropagation();
        if (previewing) {
            await session.copyPreviewQuestion();
            return;
        }
        await session.copyCurrentQuestion();
    }
</script>

{#if question}
    <div class="flex min-h-8 items-center gap-3">
        {#if typeIcon}
            {#key question.type}
                {@const TypeIcon = typeIcon}
                <TypeIcon
                    size={16}
                    stroke={1.75}
                    class="text-muted-foreground shrink-0"
                />
            {/key}
        {/if}

        <div class="flex min-w-0 items-center gap-1 text-muted-foreground">
            <span class="truncate text-xs font-mono">{question.id}</span>
            <CopyQuestionButton
                status={session.copyQuestionStatus}
                onclick={copy}
            />
        </div>

        <div class="ml-auto flex items-center">
            {#if previewing}
                <StreakIndicator
                    variant="preview"
                    onMaster={() => session.markPreviewQuestionAsMastered()}
                />
            {:else if session.currentPoolItem}
                <StreakIndicator
                    item={session.currentPoolItem}
                    requiredStreak={session.requiredStreak}
                    maxLevel={Math.max(
                        session.appState.settings.correctStreakToMaster,
                        session.appState.settings.correctStreakAfterMistake,
                    )}
                    onMaster={() => session.markCurrentAsMastered()}
                />
            {/if}
        </div>
    </div>
{/if}
