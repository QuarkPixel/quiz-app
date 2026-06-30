<script lang="ts">
    import type { ActivePoolItem } from "@/types";
    import { getLearningLevelColor } from "@/features/quiz/learningProgress";
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import { cn } from "$lib/utils";
    import IconChecks from "@tabler/icons-svelte/icons/checks";

    interface Props {
        item?: ActivePoolItem;
        requiredStreak?: number;
        maxLevel?: number;
        size?: "default" | "compact";
        variant?: "streak" | "preview";
        previewLabel?: string;
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
        variant = "streak",
        previewLabel = "PREVIEW",
        readonly = false,
        onMaster,
    }: Props = $props();

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
    const safeRequiredStreak = $derived(toBoundedInteger(requiredStreak, 1, 1));
    const safeMaxLevel = $derived(toBoundedInteger(maxLevel, 1, 1));
    /** dots + gaps + 双侧 padding 的自然宽度 */
    const naturalWidth = $derived(
        safeRequiredStreak * geom.dot +
            Math.max(0, safeRequiredStreak - 1) * geom.gap +
            2 * geom.pad,
    );
    const naturalWidthStyle = $derived(`width: ${naturalWidth}px;`);
    const confirmWidthStyle = $derived(
        `width: ${Math.max(naturalWidth, geom.target)}px;`,
    );
    const remainingCorrect = $derived(
        Math.min(
            safeMaxLevel,
            Math.max(
                1,
                safeRequiredStreak -
                    toBoundedInteger(item?.consecutiveCorrect, 0, 0),
            ),
        ),
    );
    const consecutiveCorrect = $derived(
        Math.min(
            safeRequiredStreak,
            toBoundedInteger(item?.consecutiveCorrect, 0, 0),
        ),
    );
    const filledDotColor = $derived(
        getLearningLevelColor(remainingCorrect, safeMaxLevel),
    );

    const rootClass = $derived(
        cn(
            "relative inline-flex items-center justify-center rounded-full",
            "transition-[width,background-color] duration-200",
            variant === "streak"
                ? size === "default"
                    ? "p-1"
                    : "p-[3px]"
                : "",
            variant === "preview"
                ? "text-warning hover:bg-foreground/10"
                : "bg-foreground/10 hover:bg-foreground/15",
        ),
    );

    const confirmClass = $derived(cn("bg-success hover:bg-success"));

    function dotGroupClass(confirming: boolean): string {
        return cn(
            "flex items-center",
            size === "default" ? "gap-1.5" : "gap-1",
            confirming && "invisible",
        );
    }

    function dotClass(index: number): string {
        return cn(
            "block rounded-full transition-colors",
            size === "default" ? "size-1.5" : "size-1",
            index >= consecutiveCorrect && "bg-background",
        );
    }
</script>

{#snippet dots(confirming: boolean)}
    <!-- dots 始终渲染，confirming 时 invisible 让位给 ✓ icon overlay -->
    <span class={dotGroupClass(confirming)}>
        {#each Array(safeRequiredStreak) as _, i}
            <span
                class={dotClass(i)}
                style:background-color={i < consecutiveCorrect
                    ? filledDotColor
                    : undefined}
            ></span>
        {/each}
    </span>
{/snippet}

{#snippet previewText(confirming: boolean)}
    <span
        class={cn(
            "font-semibold tracking-[0.18em] transition-opacity leading-0",
            size === "default" ? "px-2 text-[10px]" : "px-1.5 text-[9px]",
            confirming && "invisible",
        )}
    >
        {previewLabel}
    </span>
{/snippet}

{#if readonly}
    <span
        class={cn(rootClass, "hover:bg-foreground/10")}
        style={variant === "preview" ? undefined : naturalWidthStyle}
        aria-label={variant === "preview" ? previewLabel : "掌握进度"}
    >
        {#if variant === "preview"}
            {@render previewText(false)}
        {:else}
            {@render dots(false)}
        {/if}
    </span>
{:else}
    <ConfirmActionButton
        unstyled
        class={rootClass}
        {confirmClass}
        style={variant === "preview" ? undefined : naturalWidthStyle}
        confirmStyle={variant === "preview" ? undefined : confirmWidthStyle}
        idleAriaLabel="标记为已掌握"
        confirmAriaLabel="再次点击确认掌握"
        idleTitle="标记为已掌握"
        confirmTitle="再次点击确认掌握"
        onConfirm={() => onMaster?.()}
    >
        {#snippet children({ confirming })}
            {#if variant === "preview"}
                {@render previewText(confirming)}
            {:else}
                {@render dots(confirming)}
            {/if}
            {#if confirming}
                <IconChecks
                    size={size === "default" ? 14 : 10}
                    stroke={2.5}
                    class="absolute inset-0 m-auto text-success-foreground"
                />
            {/if}
        {/snippet}
    </ConfirmActionButton>
{/if}
