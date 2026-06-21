<script lang="ts">
    import type { ActivePoolItem } from "@/types";
    import { getLearningLevelColor } from "@/features/quiz/learningProgress";
    import { createConfirmAction } from "$lib/hooks/createConfirmAction.svelte";
    import { cn } from "$lib/utils";
    import IconChecks from "@tabler/icons-svelte/icons/checks";

    interface Props {
        item: ActivePoolItem;
        requiredStreak: number;
        maxLevel: number;
        size?: "default" | "compact";
        readonly?: boolean;
        /**
         * 双击此 indicator 就把对应题掌握。
         * 第一次点击：背景变绿、白色 ✓，3 秒后自动复位；第二次点击：触发回调。
         */
        onMaster?: () => void;
    }

    let {
        item,
        requiredStreak,
        maxLevel,
        size = "default",
        readonly = false,
        onMaster,
    }: Props = $props();

    const masterAction = createConfirmAction(() => onMaster?.());

    function toBoundedInteger(
        value: unknown,
        fallback: number,
        min: number,
    ): number {
        const numberValue = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(numberValue)) return fallback;
        return Math.max(min, Math.round(numberValue));
    }

    // 几何常量：与下面的 Tailwind 类一一对应。
    //   default:  p-1 (4px) / size-1.5 (6px) / gap-1.5 (6px) / target 40px
    //   compact:  p-[3px]   / size-1   (4px) / gap-1   (4px) / target 32px
    // 把 width 算成纯像素，避免 `auto ↔ length` 不可动画 + min-width 卡顿问题。
    const GEOMETRY = {
        default: { dot: 6, gap: 6, pad: 4, target: 30 },
        compact: { dot: 4, gap: 4, pad: 3, target: 24 },
    } as const;

    const geom = $derived(GEOMETRY[size]);
    const safeRequiredStreak = $derived(
        toBoundedInteger(requiredStreak, 1, 1),
    );
    const safeMaxLevel = $derived(toBoundedInteger(maxLevel, 1, 1));
    /** dots + gaps + 双侧 padding 的自然宽度 */
    const naturalWidth = $derived(
        safeRequiredStreak * geom.dot +
            Math.max(0, safeRequiredStreak - 1) * geom.gap +
            2 * geom.pad,
    );
    /** confirming 时撑开到至少 target，否则 natural */
    const buttonWidth = $derived(
        masterAction.confirming
            ? Math.max(naturalWidth, geom.target)
            : naturalWidth,
    );
    const remainingCorrect = $derived(
        Math.min(
            safeMaxLevel,
            Math.max(
                1,
                safeRequiredStreak -
                    toBoundedInteger(item.consecutiveCorrect, 0, 0),
            ),
        ),
    );
    const consecutiveCorrect = $derived(
        Math.min(
            safeRequiredStreak,
            toBoundedInteger(item.consecutiveCorrect, 0, 0),
        ),
    );
    const filledDotColor = $derived(
        getLearningLevelColor(remainingCorrect, safeMaxLevel),
    );

    const rootClass = $derived(
        cn(
            "relative inline-flex items-center justify-center rounded-full",
            "transition-[width,background-color] duration-200",
            size === "default" ? "p-1" : "p-[3px]",
            !masterAction.confirming &&
                !readonly &&
                "bg-foreground/10 hover:bg-foreground/15",
            !masterAction.confirming && readonly && "bg-foreground/10",
            masterAction.confirming && "bg-success",
        ),
    );

    const dotGroupClass = $derived(
        cn(
            "flex items-center",
            size === "default" ? "gap-1.5" : "gap-1",
            masterAction.confirming && "invisible",
        ),
    );
</script>

{#snippet dots()}
    <!-- dots 始终渲染，confirming 时 invisible 让位给 ✓ icon overlay -->
    <span class={dotGroupClass}>
        {#each Array(safeRequiredStreak) as _, i}
            <span
                class={cn(
                    "block rounded-full transition-colors",
                    size === "default" ? "size-1.5" : "size-1",
                    i >= consecutiveCorrect && "bg-background",
                )}
                style:background-color={i < consecutiveCorrect
                    ? filledDotColor
                    : undefined}
            ></span>
        {/each}
    </span>
{/snippet}

{#if readonly}
    <span
        class={rootClass}
        style:width="{naturalWidth}px"
        aria-label="掌握进度"
    >
        {@render dots()}
    </span>
{:else}
    <button
        type="button"
        class={rootClass}
        style:width="{buttonWidth}px"
        aria-label={masterAction.confirming
            ? "再次点击确认掌握"
            : "标记为已掌握"}
        title={masterAction.confirming ? "再次点击确认掌握" : "标记为已掌握"}
        onclick={() => masterAction.trigger()}
    >
        {@render dots()}
        {#if masterAction.confirming}
            <IconChecks
                size={size === "default" ? 14 : 10}
                stroke={2.5}
                class="absolute inset-0 m-auto text-success-foreground"
            />
        {/if}
    </button>
{/if}
