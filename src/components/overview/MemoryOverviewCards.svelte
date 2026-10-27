<script lang="ts">
    import { useMemorySession } from "@/features/memory/context";
    import { memoryHeatmapCells } from "@/features/memory/overview";
    import IconProgressCheck from "@tabler/icons-svelte/icons/progress-check";
    import IconTargetArrow from "@tabler/icons-svelte/icons/target-arrow";
    import OverviewCard from "./OverviewCard.svelte";
    import HeatmapCard from "./HeatmapCard.svelte";

    /**
     * 记忆模式那一排卡片，按出现顺序写在一个文件里：
     *
     *   1. 未学习 / 学习中 / 已掌握
     *   2. 今日待复习
     *   3. 卡片热力图
     *
     * 总览弹窗与首页**用的是同一个组件、同一份数据**，没有任何「传不传热力图」的
     * 分支——首页看到的就是总览顶部那一排，一个像素都不差。
     *
     * 共用的部分（底色、无描边、标题行、sticky）都在 `OverviewCard` 里，
     * 这里只写各自的内容——版式仍是一张一张手写的，不走「每张卡一个对象」的
     * 模板（试过，字号与间距会走形）。
     */
    interface Props {
        /** 点热力图格子跳到列表里那一行。首页没有列表，不传就不响应点击 */
        onJump?: (id: string) => void;
    }

    let { onJump }: Props = $props();

    const session = useMemorySession();
    const total = $derived(session.questions.length);
</script>

<!-- 宽度按内容：标题「未学习 / 学习中 / 已掌握」最长 -->
<OverviewCard
    title="未学习 / 学习中 / 已掌握"
    class="w-54"
    contentClass="justify-between gap-1"
>
    {#snippet decor()}
        <IconProgressCheck
            size={96}
            class="absolute -bottom-3 -right-4 text-muted-foreground opacity-20"
        />
    {/snippet}

    <!-- 数字与分隔斜杠都放进同一套 span 规则里（`*:font-mono`），
         斜杠用更淡的 foreground 色，和刷题模式的行内多数字写法一致。
         「学习中」与「复习中」合并成一个数（橙色），三个数加起来是总数 -->
    <span
        class="*:font-mono text-2xl font-semibold tabular-nums text-foreground/10"
    >
        <span class="text-foreground/40">{session.newCount}</span
        >&thinsp;/&thinsp;<span class="text-warning"
            >{session.learningCount + session.reviewingCount}</span
        >&thinsp;/&thinsp;<span class="text-success">{session.masteredCount}</span
        >
    </span>
    <span class="text-muted-foreground text-xs tabular-nums">
        共 {total} 道卡片
    </span>
</OverviewCard>

<!-- 宽度按内容：「今日共需复习 N 道卡片」这条说明最长 -->
<OverviewCard
    title="今日待复习"
    class="w-46"
    contentClass="justify-between gap-1"
>
    {#snippet decor()}
        <IconTargetArrow
            size={96}
            class="absolute -top-3 right-0 text-muted-foreground opacity-20"
        />
    {/snippet}

    <span
        class="font-mono text-2xl font-semibold tabular-nums text-foreground/60"
        style:color={session.reviewableCount > 0 ? "var(--warning)" : undefined}
    >
        {session.reviewableCount}
    </span>
    <span class="text-muted-foreground text-xs tabular-nums">
        {#if session.reviewableCount != 0}
            今日共需复习 {session.reviewableCount} 道卡片
        {:else}
            今日没有待复习卡片
        {/if}
    </span>
</OverviewCard>

<HeatmapCard
    title="卡片热力图"
    count={total}
    cells={() => memoryHeatmapCells(session)}
    {onJump}
/>