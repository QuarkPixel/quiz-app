<script lang="ts">
    import type { ActivePoolItem } from "../types";
    import { createConfirmAction } from "$lib/hooks/createConfirmAction.svelte";
    import { cn } from "$lib/utils";
    import IconCheck from "@tabler/icons-svelte/icons/check";

    interface Props {
        item: ActivePoolItem;
        requiredStreak: number;
        size?: "default" | "compact";
        /**
         * 提供 onMaster 后，整个组件成为「点两下掌握」按钮：
         *   - 第一次点击：背景变绿、白色 ✓，3 秒后自动复位
         *   - 第二次点击：调用 onMaster
         * 不传则纯展示。
         */
        onMaster?: () => void;
    }

    let {
        item,
        requiredStreak,
        size = "default",
        onMaster,
    }: Props = $props();

    // hook 不可条件化调用，总是创建，仅 onMaster 存在时使用。
    const masterAction = createConfirmAction(() => onMaster?.());
    const interactive = $derived(onMaster !== undefined);
    // 仅当 requiredStreak === 1 时点很窄，需要 min-width 撑开。
    const singleDot = $derived(requiredStreak === 1);
</script>

{#snippet dots()}
    {#each Array(requiredStreak) as _, i}
        <span
            class={cn(
                "block rounded-full transition-colors",
                size === "default" ? "size-1.5" : "size-1",
                i < item.consecutiveCorrect
                    ? item.hasEverMistaken
                        ? "bg-warning"
                        : "bg-success"
                    : "bg-background",
            )}
        ></span>
    {/each}
{/snippet}

{#if interactive}
    <button
        type="button"
        class={cn(
            "relative inline-flex items-center justify-center rounded-full",
            "transition-[min-width,background-color] duration-200",
            size === "default" ? "p-1" : "p-[3px]",
            !masterAction.confirming &&
                "bg-foreground/10 hover:bg-foreground/15 cursor-pointer",
            masterAction.confirming && "bg-success",
            singleDot &&
                !masterAction.confirming &&
                (size === "default" ? "min-w-6" : "min-w-5"),
            singleDot &&
                masterAction.confirming &&
                (size === "default" ? "min-w-10" : "min-w-8"),
        )}
        aria-label={masterAction.confirming ? "再次点击确认掌握" : "标记为已掌握"}
        title={masterAction.confirming ? "再次点击确认掌握" : "标记为已掌握"}
        onclick={() => masterAction.trigger()}
    >
        <!-- dots 始终作为「占位」存在，confirming 时 invisible 保留尺寸 -->
        <span
            class={cn(
                "flex items-center",
                size === "default" ? "gap-1.5" : "gap-1",
                masterAction.confirming && "invisible",
            )}
        >
            {@render dots()}
        </span>
        {#if masterAction.confirming}
            <IconCheck
                size={size === "default" ? 14 : 10}
                stroke={2.5}
                class="absolute inset-0 m-auto text-success-foreground"
            />
        {/if}
    </button>
{:else}
    <div
        class={cn(
            "flex items-center rounded-full",
            size === "default"
                ? "p-1 gap-1.5 bg-foreground/10"
                : "p-[3px] gap-1 bg-foreground/8",
            singleDot && (size === "default" ? "min-w-6" : "min-w-5"),
        )}
    >
        {@render dots()}
    </div>
{/if}
