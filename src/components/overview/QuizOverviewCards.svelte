<script lang="ts">
    import { useQuizSession } from "@/quiz/session/context";
    import { hasEverMistakenQuestion } from "@/features/quiz";
    import { getLearningLevelColor } from "@/features/quiz/learningProgress";
    import { quizHeatmapCells } from "@/features/quiz/overview";
    import IconInnerShadowTopLeft from "@tabler/icons-svelte/icons/inner-shadow-top-left";
    import IconProgressCheck from "@tabler/icons-svelte/icons/progress-check";
    import IconTargetArrow from "@tabler/icons-svelte/icons/target-arrow";
    import OverviewCard from "./OverviewCard.svelte";
    import HeatmapCard from "./HeatmapCard.svelte";

    /**
     * 刷题模式那一排卡片，按出现顺序写在一个文件里：
     *
     *   1. 已掌握 / 活动题池 / 未学习
     *   2. 正确率
     *   3. 答题次数
     *   4. 答题热力图
     *
     * 与 `MemoryOverviewCards.svelte` **同一套规格**：同样的 `OverviewCard` 壳、
     * 同样的三行（标题贴上、数字居中、说明贴下）、宽度按内容各写各的。
     * 两边各有一份而不是共用模板，是因为卡片里的数字与文案完全不同——抽成
     * 数据再套模板只会让版式走形（已经试过一次）。
     */
    interface Props {
        /** 点热力图格子跳到列表里那一行 */
        onJump?: (id: string) => void;
    }

    let { onJump }: Props = $props();

    const session = useQuizSession();

    const masteredSet = $derived(new Set(session.appState.masteredIds));
    const masteredQuestions = $derived(
        session.questions.filter((q) => masteredSet.has(q.id)),
    );
    const total = $derived(session.questions.length);
    const mastered = $derived(masteredQuestions.length);
    const active = $derived(session.appState.activePool.length);
    const unlearned = $derived(Math.max(0, total - mastered - active));
    const mistaken = $derived(
        session.questions.filter((q) =>
            hasEverMistakenQuestion(q, session.appState),
        ).length,
    );
    const correct = $derived(
        masteredQuestions.filter(
            (q) => !hasEverMistakenQuestion(q, session.appState),
        ).length,
    );
    const accuracy = $derived(
        mastered > 0 ? Math.round((correct / mastered) * 100) : null,
    );
</script>

<OverviewCard
    title="已掌握 / 活动题池 / 未学习"
    class="w-54"
    contentClass="justify-between gap-1"
>
    {#snippet decor()}
        <IconProgressCheck
            size={96}
            class="absolute -bottom-5 -right-4 text-muted-foreground opacity-20"
        />
    {/snippet}

    <span
        class="*:font-mono text-2xl font-semibold tabular-nums text-foreground/10"
    >
        <span class="text-success">{mastered}</span>&thinsp;/&thinsp;<span
            class="text-warning">{active}</span
        >&thinsp;/&thinsp;<span class="text-foreground/40">{unlearned}</span>
    </span>
    <span class="text-muted-foreground text-xs tabular-nums">
        共 {total} 题
    </span>
</OverviewCard>

<OverviewCard title="正确率" class="w-40" contentClass="justify-between gap-1">
    {#snippet decor()}
        <IconTargetArrow
            size={96}
            class="absolute -top-3 -right-1 text-muted-foreground opacity-20"
        />
    {/snippet}

    <span
        class="font-mono text-2xl font-semibold tabular-nums"
        style:color={accuracy === null
            ? undefined
            : getLearningLevelColor(100 - accuracy, 100)}
    >
        {accuracy === null ? "--" : `${accuracy}%`}
    </span>
    <span class="text-muted-foreground font-mono text-xs tabular-nums">
        {correct} 正确 / {mistaken} 错误
    </span>
</OverviewCard>

<OverviewCard
    title="答题次数"
    class="w-32"
    contentClass="justify-between gap-1"
>
    {#snippet decor()}
        <IconInnerShadowTopLeft
            size={96}
            class="absolute top-1 -right-8 text-muted-foreground opacity-20"
        />
    {/snippet}

    <span
        class="font-mono text-2xl font-semibold tabular-nums text-foreground/60"
    >
        {session.appState.currentRound}
    </span>
    <span class="text-muted-foreground text-xs tabular-nums">
        总共提交答案次数
    </span>
</OverviewCard>

<HeatmapCard
    title="答题热力图"
    count={total}
    cells={() => quizHeatmapCells(session)}
    {onJump}
/>
