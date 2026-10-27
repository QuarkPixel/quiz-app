<script lang="ts">
    import type { Snippet } from "svelte";
    import * as Card from "$lib/components/ui/card";
    import { cn } from "$lib/utils";

    /**
     * 总览顶部 rail 里**所有**卡片的共同外壳（统计卡、热力图卡都用它）。
     *
     * 抽出来的三样东西：
     *   1. 卡片本体：透一档的底色、无描边、`h-full`（与 rail 等高）、宽度由调用方给
     *   2. 标题行：`sticky left-8`——横向滚到卡片右半边时，标题不会跟着跑出视口，
     *      而是贴住视口左边停住（见下面「sticky 的两个前提」）
     *   3. 装饰层：水印图标单独放在一层 `overflow-hidden` 里，卡片自己才能
     *      `overflow-visible`（前提之二）
     *
     * **sticky 的两个前提**，少一个就失效：
     *   - 卡片自己不能 `overflow-hidden`：`overflow: hidden` 的祖先会被当成滚动容器，
     *     它自己又不会滚，sticky 于是「贴」在一个不动的盒子上，等于没写。
     *     `Card.Root` 默认带 `overflow-hidden`，这里用 `overflow-visible` 盖掉。
     *   - 中间不能有别的 `overflow` 祖先：rail 的内层（`overflow-x: auto`）是唯一的
     *     滚动容器，卡片与标题都直接挂在它下面。
     *
     * 于是水印图标的裁切只能自己做一层——`decor` 那个绝对定位的
     * `overflow-hidden` 盒子。它不包标题，所以不影响 sticky。
     */
    interface Props {
        /** 卡片标题。rail 里横向滚动时贴住视口左边 */
        title: string;
        /** 标题右侧的补充信息（数字、图例之类） */
        meta?: Snippet;
        /** 水印图标等绝对定位装饰：会被卡片圆角裁掉，且垫在文字下面 */
        decor?: Snippet;
        /** 宽度等卡片级样式，如 `w-54` / `min-w-44` */
        class?: string;
        /** 内容区的排版（默认 `gap-2`，统计卡会改成 `justify-between gap-1`） */
        contentClass?: string;
        children: Snippet;
    }

    let {
        title,
        meta,
        decor,
        class: className,
        contentClass,
        children,
    }: Props = $props();

    /**
     *   `ring-0`          去掉 Card 默认那圈 1px 描边——底色本身就是边界
     *   `rounded-md`      原版由外层 grid 的 `*:rounded-md` 给的
     *   `h-full`          在 rail 里与热力图等高
     *   `shrink-0`        宽度是写死的，别被 flex 压窄
     *   `bg-foreground/3` 原版 5%，这里透一档
     *   `overflow-visible` 见文件头：sticky 标题的前提
     *   `isolate`         装饰层是 `-z-1`，得有个层叠上下文夹住它：垫在卡片
     *                     底色之上、文字之下（否则负 z-index 会穿到页面背景后面）
     */
    const CARD_CLASS =
        "bg-foreground/3 rounded-md ring-0 relative isolate h-full shrink-0 overflow-visible";
</script>

<Card.Root size="sm" class={cn(CARD_CLASS, className)}>
    {#if decor}
        <!-- 装饰层铺满整张卡（`inset-0` 相对 Card.Root 的 border box），自己
             `overflow-hidden` + 同款圆角——水印图标照旧被卡片边缘裁掉，
             而卡片本体保持 `overflow-visible`，标题的 sticky 才有效。 -->
        <div
            class="pointer-events-none absolute inset-0 -z-1 overflow-hidden rounded-md"
        >
            {@render decor()}
        </div>
    {/if}

    <Card.Content
        class={cn("relative flex flex-1 flex-col gap-2", contentClass)}
    >
        <!-- 外层这一格是「整行宽」，sticky 交给里面的标题：
             - 标题盒子 `w-max`，只有文字那么宽——宽度若被拉满整张卡，
               sticky 挪的是一个大空盒子，文字并不会真的贴到视口左边
             - `left-8`（32px）= rail 的 `px-5`（20）+ 卡片自己的 `px-3`（12）。
               这正是卡片没滚动时标题所在的位置，所以「开始贴边」那一刻不会跳一下，
               所有卡片的标题也都停在同一条竖线上
             多这一层是为了让 sticky 元素是普通块级子元素，而不是 flex item 的
             交叉轴——后者各家实现细节多，这层包装是最稳的写法。 -->
        <div class="flex">
            <div class="sticky left-8 z-1 flex w-max items-center gap-2">
                <span class="text-muted-foreground text-xs whitespace-nowrap">
                    {title}
                </span>
                {@render meta?.()}
            </div>
        </div>

        {@render children()}
    </Card.Content>
</Card.Root>
