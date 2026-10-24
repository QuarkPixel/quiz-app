<script lang="ts">
    import type { Snippet } from "svelte";
    import { SWAP_MS } from "@/config";
    import { cn, prefersReducedMotion } from "$lib/utils";
    import { swapIn, swapOut } from "$lib/transitions/swap";

    /**
     * 「同一块位置换内容」的容器：缩放 + 淡入淡出。
     *
     * `seq` 一变，`{#key}` 就换一份内容：旧的一份带着 `out` 过渡留在 DOM 里淡出，
     * 新的一份带 `in` 过渡淡入——两段同时跑，所以是交叉淡化，不是「先清空再填上」。
     * 旧的那层由 `swapOut` 挪出文档流，所以容器高度立刻是新内容的高度，不会抖。
     *
     * 三处用法，同一个组件、同一个时长（`SWAP_MS`）、同一个观感：
     *   - 换题
     *   - 换题库 / 记忆模式进出学习·复习
     */
    interface Props {
        /** 换内容的标识：值变了就播一次过渡 */
        seq: unknown;
        /** 时长（毫秒），默认 `SWAP_MS` */
        duration?: number;
        /** 根元素的附加类（要撑满高度时传 `flex min-h-0 flex-1 flex-col`） */
        class?: string;
        /** 每一层自己的附加类（同上） */
        itemClass?: string;
        children: Snippet;
    }

    let {
        seq,
        duration = SWAP_MS,
        class: className,
        itemClass,
        children,
    }: Props = $props();

    const ms = $derived(prefersReducedMotion ? 0 : duration);
</script>

<div class={cn("relative", className)}>
    {#key seq}
        <div
            class={cn(itemClass)}
            in:swapIn={{ duration: ms }}
            out:swapOut={{ duration: ms }}
        >
            {@render children()}
        </div>
    {/key}
</div>
