<script lang="ts">
    import type { Snippet } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import { cn } from "$lib/utils";
    import { SCROLL_TOP_THRESHOLD_PX } from "@/config";
    import { IconArrowBigUpLines } from "@tabler/icons-svelte";

    /**
     * 答题视图的公共外壳：**滚动容器 + 底部渐变遮罩 + 底部工具栏**。
     *
     * 刷题与记忆两个模式的版面本来就一模一样（同一个滚动容器、同一个居中列宽、
     * 同一套底部行为），以前是各写一遍——于是记忆模式那边漏了遮罩、漏了
     * 「可滚动时 footer 让位」、漏了工具栏上的滚轮转发。现在这些行为只此一份，
     * 内容区和左右按钮由调用方以 snippet 传入。
     *
     * 「回到顶部」按钮是刷题模式独有的（`scrollTopButton`），但**遮罩与它无关**：
     * 只要内容可滚动就有遮罩，按钮只是额外挂件。
     */
    interface Props {
        /** 工具栏左侧（设置 / 总览） */
        left?: Snippet;
        /** 工具栏右侧（活动池） */
        right?: Snippet;
        /** 是否在工具栏中间放「回到顶部」按钮 */
        scrollTopButton?: boolean;
        /** 内容列额外的类（宽度档位等） */
        contentClass?: string;
        children?: Snippet;
    }

    let {
        left,
        right,
        scrollTopButton = false,
        contentClass,
        children,
    }: Props = $props();

    let scrollViewport: HTMLDivElement | null = null;
    let layoutContent: HTMLDivElement | null = null;
    /** 内容超出容器 → 开底部遮罩、footer 让位、顶部 backdrop 亮起 */
    let isScrollable = $state(false);
    let scrollTop = $state(0);
    let scrolling = $state(false);

    const scrollTopAble = $derived(
        scrollTop > SCROLL_TOP_THRESHOLD_PX && !scrolling,
    );

    $effect(() => {
        if (!scrollViewport || !layoutContent) return;

        const viewport = scrollViewport;
        const content = layoutContent;

        const updateViewportState = (): void => {
            scrollTop = viewport.scrollTop;
            isScrollable = viewport.scrollHeight > viewport.clientHeight + 1;

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

    function scrollToTop(): void {
        scrolling = true;
        scrollViewport?.scrollTo({ top: 0, behavior: "smooth" });
    }

    /**
     * 鼠标停在底部工具栏上时，滚轮事件不会落到滚动容器上（footer 不在它里面）。
     * 这里把它转发过去，否则「鼠标压着工具栏滚不动」。
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
    class="relative flex min-h-0 flex-1 flex-col"
    data-shell-scrollable={isScrollable ? "true" : "false"}
>
    <div
        bind:this={scrollViewport}
        data-main-scroll-viewport="true"
        class={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 sm:px-6",
            "scroll-pt-[calc(env(safe-area-inset-top)+6rem)] scrollbar-none",
            "pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-(--app-shell-content-top)",
        )}
    >
        <div
            bind:this={layoutContent}
            class={cn(
                "mx-auto flex min-h-full w-full max-w-5xl items-center justify-center py-2 sm:py-4",
                contentClass,
            )}
        >
            {@render children?.()}
        </div>
    </div>

    <div
        class="pointer-events-none absolute inset-x-0 bottom-0 z-(--z-content-chrome)"
    >
        <div
            aria-hidden="true"
            data-slot="view-bottom-mask"
            class={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 h-28 transition-opacity duration-200",
                isScrollable
                    ? "opacity-100 bg-gradient-to-t from-background via-background/96 to-background/0"
                    : "opacity-0",
            )}
        ></div>

        <footer
            class={cn(
                "pointer-events-auto relative px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-8 sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
                // 可滚动时 footer 让位给遮罩：否则渐变会压住最后一行内容
                isScrollable ? "pt-6 sm:pt-7" : "pt-4 sm:pt-5",
            )}
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
</div>
