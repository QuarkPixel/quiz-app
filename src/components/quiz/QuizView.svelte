<script lang="ts">
    import { onMount } from "svelte";
    import FlashContainer from "./FlashContainer.svelte";
    import ReviewView from "../review/ReviewView.svelte";
    import Settings from "../settings/Settings.svelte";
    import PoolPanel from "./PoolPanel.svelte";
    import AlertToast from "../layout/AlertToast.svelte";
    import ProgressBar from "./ProgressBar.svelte";
    import QuestionArea from "./QuestionArea.svelte";

    import { Button } from "$lib/components/ui/button";
    import * as Dialog from "$lib/components/ui/dialog";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import { cn } from "$lib/utils";
    import { modKeyLabel } from "$lib/platform";
    import IconBook2 from "@tabler/icons-svelte/icons/book-2";
    import IconStack2 from "@tabler/icons-svelte/icons/stack-2";
    import IconSettings from "@tabler/icons-svelte/icons/settings";

    import { SHORTCUTS } from "@/config";
    import type { Bank } from "@/source/types";
    import { QuizSession } from "@/quiz/session/QuizSession.svelte";
    import { provideQuizSession } from "@/quiz/session/context";
    import { provideQuizUiActions } from "@/quiz/session/uiContext";
    import { createKeyboardHandler } from "@/quiz/session/keyboardHandler";
    import { createSoundPlayer } from "$sound";
    import { IconArrowBigUpLines } from "@tabler/icons-svelte";

    let {
        bank,
        persistDefaultSettings = false,
    }: { bank: Bank; persistDefaultSettings?: boolean } = $props();

    let flashContainer: FlashContainer;
    let toast: AlertToast;
    const soundPlayer = createSoundPlayer();

    // session 在挂载前构造 —— 此时 flash/toast 还未 bind，回调里走 ?. 兜底。
    // bank 在外层用 {#key bank.hash} 控制重建，所以这里把 bank 当作不变量处理。
    // svelte-ignore state_referenced_locally
    const session = new QuizSession(
        bank,
        {
            flash: (correct) => flashContainer?.flash(correct),
            toast: (title, description, variant) =>
                toast?.show(title, description, variant),
            sound: soundPlayer,
        },
        {
            persistDefaultSettings,
        },
    );
    provideQuizSession(session);

    // dialog 开关：纯 UI flag，留在容器局部
    let showReview = $state(false);
    let showSettings = $state(false);
    let scrollViewport: HTMLDivElement | null = null;
    let layoutContent: HTMLDivElement | null = null;
    let compactPoolContent = $state<HTMLDivElement | null>(null);
    let isScrollable = $state(false);
    let isCompactLayout = $state(false);
    let compactPoolHeight = $state(0);
    let scrollTop = $state(0);
    let scrollTopAble = $state(false);
    let scrolling = $state(false);

    const uiActions = {
        openReview: () => {
            showReview = true;
        },
        toggleReview: () => {
            showReview = !showReview;
        },
        toggleSettings: () => {
            showSettings = !showSettings;
        },
    };

    provideQuizUiActions(uiActions);

    const handleKeydown = createKeyboardHandler(session, {
        toggleReview: uiActions.toggleReview,
        toggleSettings: uiActions.toggleSettings,
    });

    session.initialize();

    onMount(() => {
        const mediaQuery = window.matchMedia("(max-width: 63.99rem)");
        const updateLayoutMode = (): void => {
            isCompactLayout = mediaQuery.matches;
        };

        updateLayoutMode();
        mediaQuery.addEventListener("change", updateLayoutMode);

        return () => mediaQuery.removeEventListener("change", updateLayoutMode);
    });

    $effect(() => {
        if (!scrollViewport || !layoutContent) return;

        const viewport = scrollViewport;
        const content = layoutContent;

        const updateViewportState = (): void => {
            scrollTop = viewport.scrollTop;
            isScrollable = viewport.scrollHeight > viewport.clientHeight + 1;
            scrollTopAble = scrollTop > 256 && !scrolling;

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

    $effect(() => {
        if (!compactPoolContent) return;

        const content = compactPoolContent;
        const updateCompactPoolHeight = (): void => {
            compactPoolHeight = content.scrollHeight;
        };

        updateCompactPoolHeight();

        const resizeObserver = new ResizeObserver(updateCompactPoolHeight);
        resizeObserver.observe(content);

        return () => resizeObserver.disconnect();
    });

    function scrollToTop(): void {
        scrolling = true;
        scrollViewport?.scrollTo({
            top: 0,
            behavior: "smooth",
        });
    }

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

<svelte:window onkeydown={handleKeydown} />

<FlashContainer bind:this={flashContainer} />
<AlertToast bind:this={toast} />

{#snippet leftControls()}
    <div class="flex items-center gap-1">
        <Tooltip.Root>
            <Tooltip.Trigger>
                {#snippet child({ props })}
                    <button
                        {...props}
                        type="button"
                        class="text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:rotate-[30deg] aria-expanded:text-foreground"
                        aria-expanded={showSettings}
                        aria-label="当前题库设置"
                        onclick={uiActions.toggleSettings}
                    >
                        <IconSettings size={22} stroke={1.5} />
                    </button>
                {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">
                <span>设置</span>
                <KbdGroup>
                    <Kbd>{modKeyLabel}</Kbd>
                    <Kbd>{SHORTCUTS.toggleSettings.toUpperCase()}</Kbd>
                </KbdGroup>
            </Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
            <Tooltip.Trigger>
                {#snippet child({ props })}
                    <button
                        {...props}
                        type="button"
                        class="text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:rotate-[10deg]"
                        aria-expanded={showReview}
                        aria-label="总览"
                        onclick={uiActions.toggleReview}
                    >
                        <IconBook2 size={22} stroke={1.5} />
                    </button>
                {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">
                <span>总览</span>
                <KbdGroup>
                    <Kbd>{modKeyLabel}</Kbd>
                    <Kbd>{SHORTCUTS.toggleReview.toUpperCase()}</Kbd>
                </KbdGroup>
            </Tooltip.Content>
        </Tooltip.Root>
    </div>
{/snippet}

{#snippet rightControls()}
    <Tooltip.Root>
        <Tooltip.Trigger>
            {#snippet child({ props })}
                <button
                    {...props}
                    type="button"
                    class={cn(
                        "text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:-rotate-[8deg]",
                        session.appState.ui.showPool &&
                            "text-foreground bg-foreground/8",
                    )}
                    aria-pressed={session.appState.ui.showPool}
                    aria-label="查看活动池"
                    onclick={() => session.togglePool()}
                >
                    <IconStack2 size={22} stroke={1.5} />
                </button>
            {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">
            <span>{session.appState.ui.showPool ? "收起" : "展开"}活动池</span>
            <KbdGroup>
                <Kbd>{modKeyLabel}</Kbd>
                <Kbd>{SHORTCUTS.togglePool.toUpperCase()}</Kbd>
            </KbdGroup>
        </Tooltip.Content>
    </Tooltip.Root>
{/snippet}

{#snippet scrollTopControl()}
    <Button
        variant="outline"
        class={cn(
            "transition-all duration-300 min-w-26 rounded-full",
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
{/snippet}

{#snippet footerBar(showScrollTop: boolean)}
    <div
        class="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
    >
        <div class="justify-self-start">
            {@render leftControls()}
        </div>

        <div class="justify-self-center">
            {#if showScrollTop}
                {@render scrollTopControl()}
            {/if}
        </div>

        <div class="justify-self-end">
            {@render rightControls()}
        </div>
    </div>
{/snippet}

<div
    class="relative flex min-h-0 flex-1 flex-col"
    data-shell-scrollable={isScrollable ? "true" : "false"}
>
    <div
        bind:this={scrollViewport}
        class={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 sm:px-6",
            "scroll-pt-[calc(env(safe-area-inset-top)+6rem)] scrollbar-none",
            "pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-(--app-shell-content-top)",
        )}
    >
        <div
            bind:this={layoutContent}
            class="mx-auto flex min-h-full w-full max-w-5xl items-center justify-center py-2 sm:py-4"
        >
            {#if isCompactLayout}
                <div class="my-auto flex w-full flex-col gap-6">
                    <div class="flex min-w-0 flex-col gap-5">
                        <QuestionArea />

                        <ProgressBar
                            stats={session.stats}
                            learningSegments={session.learningSegments}
                            focused={session.appState.ui.progressFocused}
                            onToggleFocus={() => session.toggleProgressFocus()}
                        />
                    </div>

                    <aside
                        class={cn(
                            "overflow-hidden transition-[max-height,opacity,margin,transform] duration-300 ease-emphasized",
                            session.appState.ui.showPool
                                ? "mt-0 opacity-100 translate-y-0"
                                : "-mt-2 opacity-0 -translate-y-2 pointer-events-none",
                        )}
                        style={`max-height: ${
                            session.appState.ui.showPool ? compactPoolHeight : 0
                        }px;`}
                        aria-hidden={!session.appState.ui.showPool}
                    >
                        <div
                            bind:this={compactPoolContent}
                            class="flex w-full flex-col"
                        >
                            <PoolPanel />
                        </div>
                    </aside>
                </div>
            {:else}
                <div
                    class={cn(
                        "my-auto grid w-full items-stretch justify-center transition-[grid-template-columns,grid-template-rows,gap] duration-[450ms] ease-emphasized",
                        "grid-cols-[minmax(0,42rem)_0px] grid-rows-[auto_0px] gap-0",
                        session.appState.ui.showPool &&
                            "grid-cols-[minmax(0,42rem)_280px]",
                    )}
                >
                    <div class="flex w-full min-w-0 flex-col gap-5">
                        <QuestionArea />

                        <ProgressBar
                            stats={session.stats}
                            learningSegments={session.learningSegments}
                            focused={session.appState.ui.progressFocused}
                            onToggleFocus={() => session.toggleProgressFocus()}
                        />
                    </div>

                    <aside
                        class={cn(
                            "pool-edge-mask min-w-0 overflow-hidden",
                            "row-start-1 col-start-2 flex justify-end",
                        )}
                        aria-hidden={!session.appState.ui.showPool}
                    >
                        <div
                            class={cn(
                                "flex h-full w-full flex-col",
                                "h-[min(70vh,520px)] w-[280px] shrink-0 pl-8",
                            )}
                        >
                            <PoolPanel />
                        </div>
                    </aside>
                </div>
            {/if}
        </div>
    </div>

    <div class="pointer-events-none absolute inset-x-0 bottom-0 z-20">
        <div
            aria-hidden="true"
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
                isScrollable ? "pt-6 sm:pt-7" : "pt-4 sm:pt-5",
            )}
            onwheel={forwardWheelToScrollViewport}
        >
            {@render footerBar(isScrollable)}
        </footer>
    </div>
</div>

<Settings bind:open={showSettings} />

<ReviewView
    open={showReview}
    onOpenChange={(o) => (showReview = o)}
    onToast={(title, description, variant) =>
        toast?.show(title, description, variant)}
/>

<!-- 导入确认 dialog -->
<Dialog.Root
    open={session.importConfirmText !== null}
    onOpenChange={(open) => {
        if (!open) session.cancelImport();
    }}
>
    <Dialog.Content class="max-w-sm">
        <Dialog.Header>
            <Dialog.Title>导入进度</Dialog.Title>
            <Dialog.Description>
                导入进度将覆盖当前所有进度，无法撤销，确定继续吗？
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
            <Button variant="outline" onclick={() => session.cancelImport()}>
                取消
            </Button>
            <Button onclick={() => session.commitImport()}>导入</Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<style>
    /* 大屏左右布局时给活动池左侧加渐变 mask，柔化裁切边。
       小屏上下布局时无需 mask（PoolPanel 自身顶/底有渐变）。 */
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
