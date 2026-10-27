<script lang="ts">
    import type { Snippet } from "svelte";
    import { OVERVIEW_RAIL_HEIGHT } from "@/config/overview";
    import { RailScroll } from "./rail.svelte";
    import { provideOverviewRail } from "./railContext";

    /**
     * 总览顶部那条横向滚动带。
     *
     * 内容是一整排卡片（统计卡 + 热力图，见 `*OverviewCards.svelte`）。高度由
     * `OVERVIEW_RAIL_HEIGHT` 固定，子项都 `h-full`——这就是「省出垂直空间」的全部来源。
     *
     * 可滚动的提示只剩一层：**边缘渐变遮罩**，长度 28px（`w-7`）。以前还有一对
     * 小圆箭头，删掉的理由：
     *   - 它和滚轮 / 触控板抢同一件事，多一套「点一下跳一段」的手感要维护
     *   - 一次跳大半屏，在触控板上很突兀；用户要的是「自己滑到哪就是哪」
     *
     * 遮罩只在真的还能滚时出现，而且刻意做得很短——它盖住的是卡片边缘，不是内容。
     *
     * 触摸屏走原生横向滚动（`overflow-x: auto` + `touch-pan-x`），这里不接管；
     * 鼠标滚轮的映射见 `rail.svelte.ts` 的 `wheel`。
     */
    interface Props {
        /** 无障碍名，如「题库统计与热力图」 */
        label: string;
        children: Snippet;
    }

    let { label, children }: Props = $props();

    const rail = new RailScroll();
    provideOverviewRail(rail);
</script>

<div class="relative shrink-0" style="height: {OVERVIEW_RAIL_HEIGHT}px">
    <div
        bind:this={rail.el}
        bind:clientWidth={rail.viewportWidth}
        onscroll={() => rail.sync()}
        use:rail.wheel
        role="group"
        aria-label={label}
        class="h-full touch-pan-x overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
        <!-- 左右留白与弹窗标题栏、下半部分的筛选栏对齐（都是 px-5）。
             `justify-between`：内容没占满视口时把卡片铺开（首页那排只有两张卡，
             窄屏之外都会留白）；一旦内容超宽，`w-max` 让容器等于内容宽，
             justify-between 就没有可分配的余量，行为与普通 flex 一致。 -->
        <div
            bind:this={rail.contentEl}
            use:rail.observeContent
            class="flex h-full w-max min-w-full items-stretch justify-between gap-3 px-5"
        >
            {@render children()}
        </div>
    </div>

    {#if rail.canScrollLeft}
        <div
            class="from-card pointer-events-none absolute inset-y-0 left-0 w-7 bg-linear-to-r to-transparent"
        ></div>
    {/if}

    {#if rail.canScrollRight}
        <div
            class="from-card pointer-events-none absolute inset-y-0 right-0 w-7 bg-linear-to-l to-transparent"
        ></div>
    {/if}
</div>
