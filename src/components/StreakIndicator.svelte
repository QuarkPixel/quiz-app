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

    // 仅在 interactive 模式下创建 confirm action。注意 hook 不可条件化调用，
    // 所以总是创建，但只在 onMaster 存在时使用。
    const masterAction = createConfirmAction(() => onMaster?.());
    const interactive = $derived(onMaster !== undefined);

    function handleClick(): void {
        if (!interactive) return;
        masterAction.trigger();
    }
</script>

{#if interactive}
    <button
        type="button"
        class={cn(
            // 基础容器：圆角 pill，min-w 防止 1-dot 时挤成方块
            "inline-flex items-center justify-center gap-1.5 rounded-full transition-colors",
            size === "default"
                ? "min-w-8 p-1 bg-foreground/10"
                : "min-w-6 p-[3px] bg-foreground/8 gap-1",
            // confirming：变绿带 ✓
            masterAction.confirming &&
                "bg-success ring-success/40 ring-2 ring-offset-1 ring-offset-background",
            !masterAction.confirming && "hover:bg-foreground/15 cursor-pointer",
        )}
        aria-label={masterAction.confirming ? "再次点击确认掌握" : "标记为已掌握"}
        title={masterAction.confirming ? "再次点击确认掌握" : "标记为已掌握"}
        onclick={handleClick}
    >
        {#if masterAction.confirming}
            <IconCheck
                size={size === "default" ? 14 : 10}
                stroke={2.5}
                class="text-success-foreground"
            />
        {:else}
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
        {/if}
    </button>
{:else}
    <div
        class={cn(
            "flex items-center rounded-full",
            size === "default"
                ? "min-w-8 p-1 bg-foreground/10 gap-1.5"
                : "min-w-6 p-[3px] bg-foreground/8 gap-1",
        )}
    >
        {#each Array(requiredStreak) as _, i}
            <span
                class={cn(
                    "block rounded-full",
                    size === "default" ? "size-1.5" : "size-1",
                    i < item.consecutiveCorrect
                        ? item.hasEverMistaken
                            ? "bg-warning"
                            : "bg-success"
                        : "bg-background",
                )}
            ></span>
        {/each}
    </div>
{/if}
