<script lang="ts">
    /**
     * 一张 DiceBear identicon（同一个 seed 永远画出同一张图）。
     *
     * 怎么画见 $lib/identicon.ts——那里是唯一入口，样式定义只校验一次；
     * 这里只管挑主题、把 svg 塞进 DOM。
     *
     * 尺寸就是个死数，不折腾 CSS：svg 自带 width/height，盒子跟着它走。
     * （试过 self-stretch + aspect-square 撑满行高，浏览器里两种图标都不见了，
     * 不值当。）
     */
    import type { LearningColorScheme } from "@/features/quiz/learningProgress";
    import {
        identiconReady,
        preloadIdenticon,
        renderIdenticon,
    } from "$lib/identicon";
    import { cn } from "$lib/utils";

    interface Props {
        /** 决定画出哪一张；同一个 seed 结果稳定。 */
        seed: string;
        /** 边长（px）。跟同一行里的其它图标对齐就行。 */
        size?: number;
        class?: string;
    }

    let { seed, size = 30, class: className }: Props = $props();

    const DARK_QUERY = "(prefers-color-scheme: dark)";

    let scheme = $state<LearningColorScheme>(
        window.matchMedia(DARK_QUERY).matches ? "dark" : "light",
    );

    $effect(() => {
        const query = window.matchMedia(DARK_QUERY);
        const sync = () => (scheme = query.matches ? "dark" : "light");
        sync();
        query.addEventListener("change", sync);
        return () => query.removeEventListener("change", sync);
    });

    /**
     * 引擎是**动态拉进来**的（见 `$lib/identicon.ts`）：没就绪之前返回 null，
     * 组件先画一个同尺寸的占位块，免得加载完布局跳一下。
     *
     * 预热通常早就由「打开云同步」触发了，所以正常路径上这里第一帧就能画出来。
     */
    let ready = $state(identiconReady());

    $effect(() => {
        if (ready) return;
        let cancelled = false;
        void preloadIdenticon().then(() => {
            if (!cancelled) ready = true;
        });
        return () => {
            cancelled = true;
        };
    });

    const svg = $derived(ready ? renderIdenticon({ seed, size, scheme }) : null);
</script>

{#if svg}
    <span class={cn("inline-flex shrink-0", className)} aria-hidden="true"
        >{@html svg}</span>
{:else}
    <span
        class={cn("bg-muted inline-flex shrink-0 animate-pulse rounded", className)}
        style="width: {size}px; height: {size}px;"
        data-slot="identicon-placeholder"
        aria-hidden="true"
    ></span>
{/if}
