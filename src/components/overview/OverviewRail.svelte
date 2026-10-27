<script lang="ts">
    import type { Snippet } from "svelte";
    import { cn } from "$lib/utils";
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
        /**
         * 这条 rail 底下压着的是哪一层底色。遮罩是「从这层底色渐变到透明」，
         * 颜色必须与它一致：
         *
         *   - `popover`（默认）：总览弹窗里。`Dialog.Content` 是 `bg-popover`
         *   - `background`：记忆模式首页，页面底色是 `bg-background`
         *
         * 以前一律写 `from-card`。浅色下三个变量都是纯白，看不出来；深色下
         * `--card` / `--popover` 是 `oklch(0.205)`、`--background` 是 `oklch(0.145)`，
         * 于是首页那条遮罩比背景亮一档，看起来就是「一条灰带糊在卡片边上」。
         */
        surface?: "popover" | "background";
        children: Snippet;
    }

    let { label, surface = "popover", children }: Props = $props();

    const rail = new RailScroll();
    provideOverviewRail(rail);

    /**
     * 两个类名都**写死在源码里**，Tailwind 才扫得到（拼接出来的类名不会被生成）。
     * `to-xxx/0` 而不是 `to-transparent`：同色零透明度，渐变中途不会发灰。
     */
    const MASK_FADE = {
        popover: "from-popover to-popover/0",
        background: "from-background to-background/0",
    } as const;
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

    <!--
        两条遮罩**常驻**，只在「能滚 / 不能滚」之间切 opacity。

        以前是 `{#if rail.canScrollLeft}` 直接挂载 / 卸载，边缘那 28px 会在滚动
        开始与结束的一瞬间「啪」地出现和消失，比遮罩本身还显眼。现在与
        `ViewShell` 的上下遮罩同一套写法：`transition-opacity duration-200`。
    -->
    <div
        aria-hidden="true"
        data-slot="overview-rail-mask-left"
        class={cn(
            "pointer-events-none absolute inset-y-0 left-0 w-7 bg-linear-to-r transition-opacity duration-200",
            MASK_FADE[surface],
            rail.canScrollLeft ? "opacity-100" : "opacity-0",
        )}
    ></div>

    <div
        aria-hidden="true"
        data-slot="overview-rail-mask-right"
        class={cn(
            "pointer-events-none absolute inset-y-0 right-0 w-7 bg-linear-to-l transition-opacity duration-200",
            MASK_FADE[surface],
            rail.canScrollRight ? "opacity-100" : "opacity-0",
        )}
    ></div>
</div>
