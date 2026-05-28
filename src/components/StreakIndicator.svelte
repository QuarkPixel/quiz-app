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
         * 双击此 indicator 就把对应题掌握。
         * 第一次点击：背景变绿、白色 ✓，3 秒后自动复位；第二次点击：触发回调。
         */
        onMaster: () => void;
    }

    let { item, requiredStreak, size = "default", onMaster }: Props = $props();

    const masterAction = createConfirmAction(() => onMaster());
</script>

<button
    type="button"
    class={cn(
        // 默认宽度由 dots 自然决定 —— 不设 min-width，避免 1 个点时变胶囊。
        // 仅 confirming 时强制 min-width 撑开给 ✓ icon，带平滑动画。
        "relative inline-flex items-center justify-center rounded-full cursor-pointer",
        "transition-[min-width,background-color] duration-200",
        size === "default" ? "p-1" : "p-[3px]",
        !masterAction.confirming &&
            "bg-foreground/10 hover:bg-foreground/15",
        masterAction.confirming && "bg-success",
        masterAction.confirming &&
            (size === "default" ? "min-w-10" : "min-w-8"),
    )}
    aria-label={masterAction.confirming ? "再次点击确认掌握" : "标记为已掌握"}
    title={masterAction.confirming ? "再次点击确认掌握" : "标记为已掌握"}
    onclick={() => masterAction.trigger()}
>
    <!-- dots 始终占位，confirming 时 invisible 保留尺寸 -->
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
                    i < item.consecutiveCorrect
                        ? item.hasEverMistaken
                            ? "bg-warning"
                            : "bg-success"
                        : "bg-background",
                )}
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
