<script lang="ts">
    import { useMemorySession } from "@/features/memory/context";
    import { Button } from "$lib/components/ui/button";
    import IconSchool from "@tabler/icons-svelte/icons/school";
    import IconRepeat from "@tabler/icons-svelte/icons/repeat";
    import IconCircleDashedCheck from "@tabler/icons-svelte/icons/circle-dashed-check";
    import IconCircleDashedX from "@tabler/icons-svelte/icons/circle-dashed-x";
    import IconCards from "@tabler/icons-svelte/icons/cards";
    import IconRosetteDiscountCheck from "@tabler/icons-svelte/icons/rosette-discount-check";
    import MemoryStatsCards from "./MemoryStatsCards.svelte";
    import IconConfetti from "@tabler/icons-svelte/icons/confetti";
    import IconPlus from "@tabler/icons-svelte/icons/plus";

    /**
     * 记忆模式首页。只用现有 Button / Card 组件，不写自定义样式。
     *
     * 两个入口各有三种状态（共 6 种），靠「今天有没有用过 + 库里还剩多少」区分：
     *
     *   学习：待学习 / 今天已学完 / 本来就没有要学的内容
     *   复习：待复习 / 今日已复习完 / 本来就没有在复习的卡片
     */
    interface Props {
        /** 题库标题（侧边栏里的名字），首页顶部大字展示 */
        name: string;
    }

    let { name }: Props = $props();

    const session = useMemorySession();

    const hasAnythingToReview = $derived(session.reviewingCount > 0);
    // 学到一半但一道都没掌握的卡也算「有得学」：这一轮还留着，点进去接着继续
    const hasAnythingToLearn = $derived(session.learnableCount > 0);

    /**
     * 学习入口的四种状态：
     *   due   —— 今天还没学过一轮，还有得学 → 加重色按钮（黑底）
     *   extra —— 今天已经学过一轮，但还有得学 → 普通按钮（白底），**仍可点**，点了就是加学
     *   done  —— 今天学过一轮、而且没有更多新卡了 → 灰掉
     *   empty —— 本来就没有要学的新卡 → 灰掉
     */
    const learnState = $derived(
        hasAnythingToLearn
            ? session.learnedToday
                ? "extra"
                : "due"
            : session.learnedToday
              ? "done"
              : "empty",
    );

    /** 只有「还有得学」的两态可点：学过一轮之后按钮降色但不失效 */
    const learnClickable = $derived(
        learnState === "due" || learnState === "extra",
    );

    /** 复习入口的三种状态：到期的 + 答错后还没补完连对的都算「今天要复习」 */
    const reviewState = $derived(
        session.reviewableCount > 0
            ? "due"
            : hasAnythingToReview
              ? "done"
              : "empty",
    );

    const learnCard = $derived.by(() => {
        if (learnState === "due") {
            // 上一轮学到一半 → 说清楚是接着继续，别让人以为要从头再来
            const resuming = session.hasOngoingRound && session.roundGoal > 0;
            return {
                icon: IconSchool,
                title: "学习新的题目",
                hint: resuming
                    ? `接着上一轮 · 已掌握 ${session.roundCompletedCount} / ${session.targetPerRound}`
                    : `还有 ${session.learnableCount} 道没学完 · 这次 ${session.nextBatchSize} 道`,
                watermark: IconCircleDashedCheck,
            };
        }
        if (learnState === "extra") {
            // 今天已经学过一轮：按钮降成白底，但点进去照样能再学一轮（加学）
            return {
                icon: IconSchool,
                title: "再学一轮",
                hint: `今天已经学过一轮 · 还有 ${session.learnableCount} 道没学完`,
                watermark: IconPlus,
            };
        }
        if (learnState === "done") {
            return {
                icon: IconCircleDashedCheck,
                title: "今天已经学习完",
                hint: "过几天再来复习这些卡片",
                watermark: IconConfetti,
            };
        }
        return {
            icon: IconRosetteDiscountCheck,
            title: "没有需要学习的卡片",
            hint: "所有卡片都已经学过一轮了",
            watermark: IconRosetteDiscountCheck,
        };
    });

    const reviewCard = $derived.by(() => {
        if (reviewState === "due") {
            return {
                icon: IconRepeat,
                title: "复习",
                hint: `今天有 ${session.reviewableCount} 道待复习`,
                watermark: IconRepeat,
            };
        }
        if (reviewState === "done") {
            return {
                icon: IconCircleDashedCheck,
                title: "今日已复习完",
                hint: "到期的卡片都过了一遍",
                watermark: IconConfetti,
            };
        }
        return {
            icon: IconCircleDashedX,
            title: "没有到期的卡片",
            hint: "还没有进入复习的卡片",
            watermark: IconCards,
        };
    });
</script>

<div class="flex w-full flex-col gap-5">
    <!-- 题库标题：首页上方正好空着，用大字展示 -->
    <h1
        class="text-foreground truncate text-3xl font-semibold tracking-tight"
        title={name}
    >
        {name}
    </h1>

    <!-- 两个入口 -->
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <!-- 颜色全部来自主题变量：今天还没学 → 加重色（黑底白字）；
             今天学过一轮但还有得学 → 白底 outline，仍然可点；
             没得学（学完了）→ ghost + disabled，和复习入口一致 -->
        <Button
            variant={learnState === "due"
                ? "default"
                : learnState === "extra"
                  ? "outline"
                  : "ghost"}
            class="h-auto w-full justify-start overflow-hidden px-4 py-3 text-left"
            disabled={!learnClickable}
            onclick={() => session.startLearning()}
        >
            <learnCard.watermark
                size={96}
                class="absolute -top-3 right-0 opacity-20 -z-1"
            />
            <learnCard.icon size={28} stroke={1.5} class="shrink-0" />
            <span class="flex min-w-0 flex-col items-start">
                <span class="text-sm font-semibold">{learnCard.title}</span>
                <span class="text-xs opacity-60">{learnCard.hint}</span>
            </span>
        </Button>

        <Button
            variant={reviewState === "due" ? "default" : "ghost"}
            class="h-auto w-full justify-start overflow-hidden px-4 py-3 text-left"
            disabled={reviewState !== "due"}
            onclick={() => session.startReview()}
        >
            <reviewCard.watermark
                size={96}
                class="absolute -top-3 right-0 opacity-20 -z-1"
            />
            <reviewCard.icon size={28} stroke={1.5} class="shrink-0" />
            <span class="flex min-w-0 flex-col items-start">
                <span class="text-sm font-semibold">{reviewCard.title}</span>
                <span class="text-xs opacity-60">{reviewCard.hint}</span>
            </span>
        </Button>
    </div>

    <MemoryStatsCards />
</div>
