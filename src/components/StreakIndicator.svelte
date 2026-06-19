<script lang="ts">
    import type { ActivePoolItem } from "../types";
    import { getLearningLevelColor } from "../features/quiz/learningProgress";
    import { createConfirmAction } from "$lib/hooks/createConfirmAction.svelte";
    import { cn } from "$lib/utils";
    import IconCheck from "@tabler/icons-svelte/icons/check";

    interface Props {
        item: ActivePoolItem;
        requiredStreak: number;
        maxLevel: number;
        size?: "default" | "compact";
        /**
         * 双击此 indicator 就把对应题掌握。
         * 第一次点击：背景变绿、白色 ✓，3 秒后自动复位；第二次点击：触发回调。
         */
        onMaster: () => void;
    }

    let {
        item,
        requiredStreak,
        maxLevel,
        size = "default",
        onMaster,
    }: Props = $props();

    const masterAction = createConfirmAction(() => onMaster());

    // 几何常量：与下面的 Tailwind 类一一对应。
    //   default:  p-1 (4px) / size-1.5 (6px) / gap-1.5 (6px) / target 40px
    //   compact:  p-[3px]   / size-1   (4px) / gap-1   (4px) / target 32px
    // 把 width 算成纯像素，避免 `auto ↔ length` 不可动画 + min-width 卡顿问题。
    const GEOMETRY = {
        default: { dot: 6, gap: 6, pad: 4, target: 30 },
        compact: { dot: 4, gap: 4, pad: 3, target: 24 },
    } as const;

    const geom = $derived(GEOMETRY[size]);
    /** dots + gaps + 双侧 padding 的自然宽度 */
    const naturalWidth = $derived(
        requiredStreak * geom.dot +
            Math.max(0, requiredStreak - 1) * geom.gap +
            2 * geom.pad,
    );
    /** confirming 时撑开到至少 target，否则 natural */
    const buttonWidth = $derived(
        masterAction.confirming
            ? Math.max(naturalWidth, geom.target)
            : naturalWidth,
    );
    const remainingCorrect = $derived(
        Math.max(1, requiredStreak - item.consecutiveCorrect),
    );
    const consecutiveCorrect = $derived(
        Math.min(requiredStreak, Math.max(0, item.consecutiveCorrect)),
    );
    const filledDotColor = $derived(
        getLearningLevelColor(remainingCorrect, maxLevel),
    );
</script>

<button
    type="button"
    class={cn(
        "relative inline-flex items-center justify-center rounded-full",
        "transition-[width,background-color] duration-200",
        size === "default" ? "p-1" : "p-[3px]",
        !masterAction.confirming && "bg-foreground/10 hover:bg-foreground/15",
        masterAction.confirming && "bg-success",
    )}
    style:width="{buttonWidth}px"
    aria-label={masterAction.confirming ? "再次点击确认掌握" : "标记为已掌握"}
    title={masterAction.confirming ? "再次点击确认掌握" : "标记为已掌握"}
    onclick={() => masterAction.trigger()}
>
    <!-- dots 始终渲染，confirming 时 invisible 让位给 ✓ icon overlay -->
    <span
        class={cn(
            "flex items-center",
            size === "default" ? "gap-1.5" : "gap-1",
            masterAction.confirming && "invisible",
        )}
    >
        {#each Array(requiredStreak) as _, i}
            <span
                class={cn(
                    "block rounded-full transition-colors",
                    size === "default" ? "size-1.5" : "size-1",
                    i >= consecutiveCorrect && "bg-background",
                )}
                style={i < consecutiveCorrect
                    ? `background-color: ${filledDotColor}`
                    : undefined}
            ></span>
        {/each}
    </span>
    {#if masterAction.confirming}
        <IconCheck
            size={size === "default" ? 14 : 10}
            stroke={2.5}
            class="absolute inset-0 m-auto text-success-foreground"
        />
    {/if}
</button>
