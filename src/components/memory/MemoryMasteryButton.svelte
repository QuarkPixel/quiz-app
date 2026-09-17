<script lang="ts">
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import { startOfDay } from "@/features/memory/algorithm";
    import type { MemoryProgress } from "@/types";
    import { cn } from "$lib/utils";

    /**
     * 总览里那张卡片右侧的状态文字——它同时是「标熟」按钮：点两下确认。
     *
     * 交互照刷题模式的 `StreakIndicator`（同一个动作的另一种形态）：第一下只是
     * 变成确认态（绿底、白字「标熟」，见 `ConfirmActionButton`），第二下才真的
     * 写进进度。确认态里原来的状态文字留在原处（`invisible`），「标熟」绝对定位
     * 盖上去——按钮宽度一点不变，连点两下时它不会在指头底下缩一下。
     *
     * 已掌握的卡不给这个入口：那是终态，没有再可做的事，只留一句绿色的「已掌握」。
     *
     * 这个入口**只有总览有**：答题区不提供掌握按钮（记忆模式的掌握要么靠连对
     * 毕业、要么靠复习阶梯走完），所以状态文字的这份渲染也只此一处。
     */
    interface Props {
        item?: MemoryProgress;
        /** 「今天」的学习日锚点（调用方传 `studyDay(session.now)`，带调试时间偏移） */
        today: number;
        onMaster: () => void;
    }

    let { item, today, onMaster }: Props = $props();

    /**
     * 每道卡片只显示一句话的状态：
     *   未学习 / 学习中 / 已掌握；复习中直接写「N 天后复习」，
     *   不再重复「复习中」这个词，也不显示「3/5」这种轮次进度。
     */
    function describeStatus(progress: MemoryProgress | undefined): string {
        if (!progress) return "未学习";
        if (progress.state === "mastered") return "已掌握";
        if (progress.state === "learning") return "学习中";
        const days = Math.round((startOfDay(progress.nextDue) - today) / 86_400_000);
        if (days < 0) return `逾期 ${-days} 天`;
        if (days === 0) return "今天复习";
        if (days === 1) return "明天复习";
        return `${days} 天后复习`;
    }

    /** 状态文字沿用现有调色板：未学习灰、学习中 warning、复习中中性、已掌握 success。 */
    function stateClass(progress: MemoryProgress | undefined): string {
        if (!progress) return "text-foreground/40";
        if (progress.state === "mastered") return "text-success";
        if (progress.state === "learning") return "text-warning";
        return "text-foreground/60";
    }

    const mastered = $derived(item?.state === "mastered");
    const label = $derived(describeStatus(item));
</script>

{#if mastered}
    <!-- 已掌握是终态：没有可点的动作，只是一句话（内边距与下面的按钮对齐） -->
    <span
        class={cn(
            "inline-flex items-center px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
            stateClass(item),
        )}
    >
        {label}
    </span>
{:else}
    <ConfirmActionButton
        unstyled
        class={cn(
            "relative inline-flex items-center justify-center rounded-md px-1.5 py-0.5",
            "text-xs font-medium whitespace-nowrap transition-colors hover:bg-foreground/10",
            stateClass(item),
        )}
        confirmClass="bg-success text-success-foreground hover:bg-success"
        idleTitle="标记为已掌握"
        confirmTitle="再次点击确认掌握"
        idleAriaLabel="标记为已掌握：{label}"
        confirmAriaLabel="再次点击确认掌握"
        onConfirm={() => onMaster()}
    >
        {#snippet children({ confirming })}
            <span class={cn(confirming && "invisible")}>{label}</span>
            {#if confirming}
                <span class="absolute inset-0 flex items-center justify-center">
                    标熟
                </span>
            {/if}
        {/snippet}
    </ConfirmActionButton>
{/if}
