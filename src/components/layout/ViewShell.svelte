<script lang="ts">
    import type { Snippet } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import { MediaQuery } from "svelte/reactivity";
    import { cn } from "$lib/utils";
    import { COMPACT_LAYOUT_QUERY, SCROLL_TOP_THRESHOLD_PX } from "@/config";
    import IconArrowBigUpLines from "@tabler/icons-svelte/icons/arrow-big-up-lines";

    /**
     * 答题视图的公共外壳 —— **两个模式共用同一份版面**。
     *
     * 版面分三层，只有中间那层会滚：
     *
     * ```
     * ┌ 顶部固定：header（题型图标 / 题号 / 掌握进度）────────────┐
     * │ ↑ 遮罩                                                   │
     * │ 题目题干 + 答题区            ← 唯一滚动的地方     活动池 │
     * │ ↓ 遮罩                                      （宽屏并排） │
     * ├ 底部固定：actions（提交 / 知道…）─────────────────────────┤
     * ├ 底部固定：progress（进度条）─────────────────────────────┤
     * └ 工具栏：设置 总览 … 活动池 ──────────────────────────────┘
     * ```
     *
     * 为什么要把「题目元信息 / 操作条 / 进度条」从滚动区里拿出来：
     * 以前整块内容一起滚，题干一长，题号、提交按钮、进度条全被滚走——而这三样
     * 恰恰是答题时一直要看的。现在滚动区只剩题干与作答，滚到哪儿都不会丢上下文。
     *
     * 三个设计上的取舍：
     *
     *  1. **遮罩高度是常量**（`MASK_H`）。旧版遮罩要盖住「从工具栏底下滚过去」的
     *     内容，所以得跟着 footer 的高度算；现在滚动区被裁在自己的盒子里，内容
     *     根本到不了 header / footer 底下，遮罩只负责柔化**裁切边**，32px 就够。
     *  2. **活动池是同一份 `aside` 的两种摆法**：宽屏是主列右边的一列（网格列宽
     *     0 → 280px 过渡），窄屏折进滚动区、排在作答下面（max-height 过渡）。
     *     两种摆法各自只挂一个，靠 `compact` 二选一，不会同时存在两份 DOM。
     *  3. **底部工具栏不再是浮层**。以前它绝对定位压在滚动区上、还要一条渐变把
     *     底下滚过去的内容糊掉；现在它是正常的 flex 行，内容在它上面就被裁住，
     *     于是「footer 让位」「滚轮转发」这些补丁全都不需要了。
     */
    interface Props {
        /** 顶部固定行（题型图标 / 题号 / 掌握进度）。不给就不占高度（首页）。 */
        header?: Snippet;
        /** 底部固定区第一行：提交答案 / 下一题 / 知道·模糊·忘记 … */
        actions?: Snippet;
        /** 底部固定区第二行：进度条 */
        progress?: Snippet;
        /** 活动题目池（宽屏并排、窄屏折进滚动区） */
        aside?: Snippet;
        /** 活动池是否展开 */
        asideOpen?: boolean;
        /** 工具栏左侧（设置 / 总览） */
        left?: Snippet;
        /** 工具栏右侧（活动池开关） */
        right?: Snippet;
        /** 是否在工具栏中间放「回到顶部」按钮 */
        scrollTopButton?: boolean;
        /** 内容列宽档位（默认 `max-w-2xl`，与题干列同宽） */
        columnClass?: string;
        children?: Snippet;
    }

    let {
        header,
        actions,
        progress,
        aside,
        asideOpen = false,
        left,
        right,
        scrollTopButton = false,
        columnClass = "max-w-2xl",
        children,
    }: Props = $props();

    /** 窄版面：活动池从「并排一列」变成「折进滚动区」（口径见 `@/config/layout`） */
    const compact = new MediaQuery(COMPACT_LAYOUT_QUERY);
    /** 宽屏且真的有池子时才有那一列 */
    const asideColumn = $derived(!compact.current && aside !== undefined);

    let scrollViewport: HTMLDivElement | null = $state(null);
    let layoutContent: HTMLDivElement | null = $state(null);

    /** 内容超出容器 → 开遮罩、工具栏中间那颗「回到顶部」才有意义 */
    let isScrollable = $state(false);
    let scrollTop = $state(0);
    let scrolling = $state(false);
    /** 贴着顶 / 贴着底：对应的那条遮罩就该收起来（没有东西可遮） */
    let atTop = $state(true);
    let atBottom = $state(true);

    const scrollTopAble = $derived(
        scrollTop > SCROLL_TOP_THRESHOLD_PX && !scrolling,
    );

    $effect(() => {
        if (!scrollViewport || !layoutContent) return;

        const viewport = scrollViewport;
        const content = layoutContent;

        const updateViewportState = (): void => {
            const max = viewport.scrollHeight - viewport.clientHeight;
            scrollTop = viewport.scrollTop;
            isScrollable = max > 1;
            atTop = scrollTop <= 2;
            atBottom = scrollTop >= max - 2;

            if (scrollTop === 0) {
                scrolling = false;
            }
        };

        updateViewportState();

        const resizeObserver = new ResizeObserver(updateViewportState);
        resizeObserver.observe(viewport);
        resizeObserver.observe(content);
        viewport.addEventListener("scroll", updateViewportState, {
            passive: true,
        });

        return () => {
            viewport.removeEventListener("scroll", updateViewportState);
            resizeObserver.disconnect();
        };
    });

    // ── 窄版面：活动池折在滚动区里，高度得量出来才能做展开 / 收起动画 ──
    let inlinePoolContent: HTMLDivElement | null = $state(null);
    let inlinePoolHeight = $state(0);

    $effect(() => {
        if (!inlinePoolContent) return;

        const content = inlinePoolContent;
        const measure = (): void => {
            inlinePoolHeight = content.scrollHeight;
        };

        measure();

        const resizeObserver = new ResizeObserver(measure);
        resizeObserver.observe(content);

        return () => resizeObserver.disconnect();
    });

    /** 主列与池子那一列：同一条网格线上做 0px ↔ 280px 的过渡 */
    const columns = $derived.by(() => {
        if (!asideColumn) return "minmax(0, 42rem)";
        return asideOpen
            ? "minmax(0, 42rem) 280px"
            : "minmax(0, 42rem) 0px";
    });

    function scrollToTop(): void {
        scrolling = true;
        scrollViewport?.scrollTo({ top: 0, behavior: "smooth" });
    }

    /**
     * 鼠标停在固定区（操作条 / 进度条 / 工具栏）上时，滚轮事件不会落到滚动容器上。
     * 这里把它转发过去，否则「鼠标压着底部的按钮滚不动」。
     */
    function forwardWheelToScrollViewport(event: WheelEvent): void {
        if (!scrollViewport) return;
        if (event.deltaX === 0 && event.deltaY === 0) return;

        scrollViewport.scrollBy({
            left: event.deltaX,
            top: event.deltaY,
            behavior: "auto",
        });
        event.preventDefault();
    }
</script>

<div
    class="view-shell relative flex min-h-0 flex-1 flex-col"
    data-shell-scrollable={isScrollable ? "true" : "false"}
>
    <div class="flex min-h-0 flex-1 flex-col pt-(--app-shell-content-top)">
        <div
            class="session-grid grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] justify-center transition-[grid-template-columns] duration-[450ms] ease-emphasized"
            style:grid-template-columns={columns}
        >
            <section class="session-main flex min-h-0 min-w-0 flex-col">
                <!--
                    中间这一组：题号行 + 题面 + 操作条，**整体居中**。

                    放得下的时候它就是居中的一坨（上下留白均分）——这是主场景，
                    一道题只有几行，贴着顶会显得页面中间空了一大块；
                    放不下的时候，这个 flex 行里的中间那段（`min-h-0` + 可收缩）
                    先被压到剩余高度并开始滚动，上下两行自然贴到边上，于是
                    「波浪线外的固定、波浪线里的滚动」这个退化形态是自动成立的，
                    不需要量高度、也不需要 JS 判断「够不够高」。
                -->
                <div class="flex min-h-0 flex-1 flex-col justify-center">
                    {#if header}
                        <div class="shrink-0 px-4 sm:px-6">
                            <div class={cn("mx-auto w-full", columnClass)}>
                                {@render header()}
                            </div>
                        </div>
                    {/if}

                    <div class="relative flex min-h-0 flex-col">
                        <div
                            bind:this={scrollViewport}
                            data-main-scroll-viewport="true"
                            class="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain"
                        >
                            <div
                                bind:this={layoutContent}
                                class={cn(
                                    "mx-auto flex min-h-full w-full flex-col px-4 py-3 sm:px-6",
                                    columnClass,
                                )}
                            >
                                {@render children?.()}

                                {#if compact.current && aside}
                                    <div
                                        class={cn(
                                            "overflow-hidden transition-[max-height,opacity,margin,transform] duration-300 ease-emphasized",
                                            asideOpen
                                                ? "mt-6 opacity-100 translate-y-0"
                                                : "-mt-2 opacity-0 -translate-y-2 pointer-events-none",
                                        )}
                                        style:max-height={asideOpen
                                            ? `${inlinePoolHeight}px`
                                            : "0px"}
                                        aria-hidden={!asideOpen}
                                    >
                                        <div
                                            bind:this={inlinePoolContent}
                                            class="flex w-full flex-col"
                                        >
                                            {@render aside()}
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        </div>

                        <!--
                            上下两条裁切边遮罩。内容够长时才亮（`isScrollable`），
                            而且贴到顶 / 贴到底时各自收起来——那头已经没有「被切掉的内容」了。
                        -->
                        <div
                            aria-hidden="true"
                            data-slot="view-top-mask"
                            class={cn(
                                "pointer-events-none absolute inset-x-0 top-0 h-8 transition-opacity duration-200",
                                "bg-gradient-to-b from-background to-background/0",
                                isScrollable && !atTop
                                    ? "opacity-100"
                                    : "opacity-0",
                            )}
                        ></div>
                        <div
                            aria-hidden="true"
                            data-slot="view-bottom-mask"
                            class={cn(
                                "pointer-events-none absolute inset-x-0 bottom-0 h-8 transition-opacity duration-200",
                                "bg-gradient-to-t from-background to-background/0",
                                isScrollable && !atBottom
                                    ? "opacity-100"
                                    : "opacity-0",
                            )}
                        ></div>
                    </div>

                    {#if actions}
                        <div
                            class="shrink-0 px-4 pt-2 sm:px-6"
                            onwheel={forwardWheelToScrollViewport}
                        >
                            <div class={cn("mx-auto w-full", columnClass)}>
                                {@render actions()}
                            </div>
                        </div>
                    {/if}
                </div>

                {#if progress}
                    <div
                        class="shrink-0 px-4 sm:px-6"
                        onwheel={forwardWheelToScrollViewport}
                    >
                        <div class={cn("mx-auto w-full", columnClass)}>
                            {@render progress()}
                        </div>
                    </div>
                {/if}
            </section>

            {#if asideColumn}
                <!--
                    活动池那一列。

                    宽度由网格轨道做 0 → 280px 的过渡，内容**靠右钉住**（`ml-auto`）：
                    轨道比内容窄的时候，多出来的部分被 `overflow-hidden` 从**左边**裁掉，
                    所以面板看起来是从窗口右缘「推」进来的；反过来若让它靠左，
                    裁掉的会是右边，面板就成了「凭空长出来的一块」。

                    内层宽度就是 280px（含 `pl-8`，box-sizing 是 border-box），
                    与轨道等宽，不会溢出到列外面去。
                -->
                <aside
                    class="pool-edge-mask flex min-h-0 min-w-0 flex-col overflow-hidden"
                    aria-hidden={!asideOpen}
                >
                    <div
                        class="ml-auto flex min-h-0 w-[280px] shrink-0 flex-col pl-8"
                    >
                        {@render aside?.()}
                    </div>
                </aside>
            {/if}
        </div>
    </div>

    <footer
        class="shrink-0 px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-8"
        onwheel={forwardWheelToScrollViewport}
    >
        <div
            class="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
        >
            <div class="justify-self-start">
                {@render left?.()}
            </div>

            <div class="justify-self-center">
                {#if scrollTopButton}
                    <Button
                        variant="outline"
                        class={cn(
                            "transition-all duration-300 min-w-26 rounded-full backdrop-blur-lg",
                            scrollTopAble
                                ? "translate-y-0 opacity-100"
                                : "translate-y-4 opacity-0 pointer-events-none",
                            scrolling &&
                                "scale-120 ease-[cubic-bezier(0.13,-0.54,0.71,-0.84)] duration-500",
                        )}
                        aria-label="回到顶部"
                        onclick={scrollToTop}
                    >
                        <IconArrowBigUpLines />
                    </Button>
                {/if}
            </div>

            <div class="justify-self-end">
                {@render right?.()}
            </div>
        </div>
    </footer>
</div>

<style>
    /* 宽屏并排时给活动池左侧加渐变 mask，柔化裁切边。
       窄屏折进滚动区时无需 mask（PoolPanel 自身顶 / 底有渐变）。
       64rem 这个断点与 `@/config/layout` 的 DESKTOP_LAYOUT_MIN_WIDTH 是同一个
       （CSS 的 @media 条件里不能引用 CSS 变量，所以只能各写一次）。 */
    @media (min-width: 64rem) {
        .pool-edge-mask {
            -webkit-mask-image: linear-gradient(
                to right,
                transparent 0,
                black 32px,
                black 100%
            );
            mask-image: linear-gradient(
                to right,
                transparent 0,
                black 32px,
                black 100%
            );
        }
    }
</style>
