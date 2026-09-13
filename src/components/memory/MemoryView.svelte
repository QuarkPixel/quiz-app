<script lang="ts">
    import type { MemoryBank } from "@/source/types";
    import { MemorySession } from "@/features/memory/MemorySession.svelte";
    import { provideMemorySession } from "@/features/memory/context";
    import AlertToast from "../layout/AlertToast.svelte";
    import FlashContainer from "../quiz/FlashContainer.svelte";
    import MemoryHome from "./MemoryHome.svelte";
    import MemoryQuestionArea from "./MemoryQuestionArea.svelte";
    import MemorySettings from "../settings/MemorySettings.svelte";
    import MemoryOverview from "./MemoryOverview.svelte";
    import MemoryProgressBar from "./MemoryProgressBar.svelte";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Button } from "$lib/components/ui/button";
    import IconSettings from "@tabler/icons-svelte/icons/settings";
    import IconBook2 from "@tabler/icons-svelte/icons/book-2";
    import IconArrowLeft from "@tabler/icons-svelte/icons/arrow-left";
    import { createSoundPlayer } from "@/sound";
    import { SHORTCUTS } from "@/config";
    import { QUESTION_TYPES_LOGIC } from "@/quiz/types/registry-logic";
    import {
        hasSelectedTextToCopy,
        isMemoryShortcutIgnored,
        shouldDeferMemoryAction,
    } from "@/features/memory/keyboard";

    // 版面与 QuizView.svelte 完全一致：同一个滚动容器、同一个居中列宽、
    // 同一个底部工具栏（左：设置；右：总览），只是内容区在「首页」和
    // 「答题区」之间切换，并额外多一个「结束本轮」按钮。
    let { bank }: { bank: MemoryBank } = $props();

    let toast: AlertToast;
    let flashContainer: FlashContainer;
    const soundPlayer = createSoundPlayer();

    // bank 在外层用 {#key bank.hash} 控制重建，这里把它当作不变量处理。
    // svelte-ignore state_referenced_locally
    // session 在挂载前构造 —— 此时 flash/toast 还未 bind，回调里走 ?. 兜底
    // （与 QuizView 一致：答题后的整屏绿 / 红闪烁直接复用刷题模式的组件）
    const session = new MemorySession(bank, {
        flash: (correct) => flashContainer?.flash(correct),
        toast: (title, description, variant) =>
            toast?.show(title, description, variant),
        sound: soundPlayer,
    });
    provideMemorySession(session);

    let showSettings = $state(false);
    let showOverview = $state(false);
    let isCompactLayout = $state(false);
    /** 与 QuizView 一致：内容可滚动时给 AppShell 的底部渐变 backdrop 开灯 */
    let scrollViewport: HTMLDivElement | null = null;
    let layoutContent: HTMLDivElement | null = null;
    let isScrollable = $state(false);

    /**
     * 窗口级快捷键。题目内的快捷键（知道 / 忘记 / 下一题）由题型的
     * `getKeyboardAction` 负责，这里只处理应用级动作。
     *
     * 「该不该拦这次按键」交给 `src/features/memory/keyboard.ts` 的判定，
     * 与刷题模式保持一致（输入框 / 对话框 / 交互目标不抢键），否则按钮上的
     * Space / Enter 会双触发。
     */
    function handleKeydown(event: KeyboardEvent): void {
        if (isMemoryShortcutIgnored(event)) return;

        const mod = event.metaKey || event.ctrlKey;
        if (mod) {
            switch (event.key.toLowerCase()) {
                case SHORTCUTS.copyQuestion:
                    if (hasSelectedTextToCopy()) return;
                    if (session.currentQuestion) {
                        event.preventDefault();
                        void session.copyCurrentQuestion({ announce: true });
                    }
                    break;
                case SHORTCUTS.exportProgress:
                    event.preventDefault();
                    void session.exportProgress();
                    break;
                case SHORTCUTS.importProgress:
                    event.preventDefault();
                    void session.startImport();
                    break;
                case SHORTCUTS.toggleSettings:
                    event.preventDefault();
                    showSettings = !showSettings;
                    break;
                case SHORTCUTS.toggleReview:
                    event.preventDefault();
                    showOverview = !showOverview;
                    break;
                default:
                    break;
            }
            return;
        }

        if (event.altKey) return;

        if (event.key === "Escape" && session.run !== "idle") {
            session.exitSession();
            return;
        }

        // 题目级快捷键（知道 / 忘记 / 下一题 / 记错了）统一走题型注册表，
        // 保证和刷题模式同一套分发逻辑。
        const question = session.currentQuestion;
        if (session.run === "idle" || !question) return;

        const action = QUESTION_TYPES_LOGIC[question.type]?.getKeyboardAction(
            {
                question,
                showResult: session.showResult,
                autoSubmitOnSelection:
                    session.globalSettings.autoSubmitOnSelection,
                shuffledOptions: [],
                selectedAnswers: session.selectedAnswers,
                blankAnswerInputs: [],
            },
            {
                key: event.key.toLowerCase(),
                code: event.code,
                scope: "global",
            },
        );
        if (!action) return;
        if (shouldDeferMemoryAction(event, action)) return;

        event.preventDefault();

        if (action.kind === "next") {
            session.advanceQuestionFlow();
            return;
        }
        if (action.kind === "mark-wrong") {
            session.markAsWrong();
            return;
        }
        if (action.kind === "set-selected-answers") {
            session.selectedAnswers = action.value;
            session.submit();
            return;
        }
        if (action.kind === "submit") {
            session.submit();
        }
    }

    $effect(() => {
        if (!scrollViewport || !layoutContent) return;
        const viewport = scrollViewport;
        const content = layoutContent;

        const updateViewportState = (): void => {
            isScrollable = viewport.scrollHeight > viewport.clientHeight + 1;
        };
        updateViewportState();

        const resizeObserver = new ResizeObserver(updateViewportState);
        resizeObserver.observe(viewport);
        resizeObserver.observe(content);
        return () => resizeObserver.disconnect();
    });

    $effect(() => {
        const mediaQuery = window.matchMedia("(max-width: 63.99rem)");
        const updateLayoutMode = (): void => {
            isCompactLayout = mediaQuery.matches;
        };
        updateLayoutMode();
        mediaQuery.addEventListener("change", updateLayoutMode);
        return () => mediaQuery.removeEventListener("change", updateLayoutMode);
    });
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
                        aria-label="记忆模式设置"
                        onclick={() => (showSettings = true)}
                    >
                        <IconSettings size={22} stroke={1.5} />
                    </button>
                {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">
                <span>设置</span>
            </Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
            <Tooltip.Trigger>
                {#snippet child({ props })}
                    <button
                        {...props}
                        type="button"
                        class="text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:rotate-[10deg] aria-expanded:text-foreground"
                        aria-expanded={showOverview}
                        aria-label="总览"
                        onclick={() => (showOverview = true)}
                    >
                        <IconBook2 size={22} stroke={1.5} />
                    </button>
                {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="top">
                <span>总览</span>
            </Tooltip.Content>
        </Tooltip.Root>
    </div>
{/snippet}

{#snippet footerBar()}
    <div
        class="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center"
    >
        <div class="justify-self-start">
            {@render leftControls()}
        </div>
        <div class="justify-self-center"></div>
    </div>
{/snippet}

<div
    class="relative flex min-h-0 flex-1 flex-col"
    data-shell-scrollable={isScrollable ? "true" : "false"}
>
    <!-- 本轮操作的入口：放在全局「展开侧边栏」正下方，体现层级 -->
    {#if session.run !== "idle"}
        <div
            class="absolute left-5 top-[calc(env(safe-area-inset-top)+3.25rem)] z-30 sm:left-8 sm:top-[calc(env(safe-area-inset-top)+3.5rem)]"
        >
            <Tooltip.Root>
                <Tooltip.Trigger>
                    {#snippet child({ props })}
                        <Button
                            {...props}
                            variant="ghost"
                            size="icon-sm"
                            class="-ml-1"
                            aria-label="结束本轮"
                            onclick={() => session.exitSession()}
                        >
                            <IconArrowLeft size={16} stroke={1.75} />
                        </Button>
                    {/snippet}
                </Tooltip.Trigger>
                <Tooltip.Content side="bottom">
                    <span>结束本轮</span>
                </Tooltip.Content>
            </Tooltip.Root>
        </div>
    {/if}

    <div
        bind:this={scrollViewport}
        class="min-h-0 flex-1 overflow-y-auto px-4 scrollbar-none sm:px-6 scroll-pt-[calc(env(safe-area-inset-top)+6rem)] pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-(--app-shell-content-top)"
    >
        <div
            bind:this={layoutContent}
            class="mx-auto flex min-h-full w-full max-w-5xl items-center justify-center py-2 sm:py-4"
        >
            {#if session.run === "idle"}
                <div class="my-auto w-full max-w-2xl">
                    <MemoryHome name={bank.name} />
                </div>
            {:else}
                <div
                    class={isCompactLayout
                        ? "my-auto flex w-full flex-col gap-5"
                        : "my-auto flex w-full max-w-2xl flex-col gap-5"}
                >
                    <MemoryQuestionArea />

                    {#if session.run === "learning"}
                        <!-- 本轮学习进度：左边已掌握数，中间「3-5」，右边目标数 -->
                        <MemoryProgressBar
                            done={session.roundCompletedCount}
                            total={session.targetPerRound}
                            label="{session.roundCompletedCount}/{session.targetPerRound}"
                            ariaLabel="本轮学习进度"
                        />
                    {:else if session.run === "reviewing"}
                        <!-- 复习进度：每复习完一题变绿 -->
                        <MemoryProgressBar
                            done={session.reviewDoneCount}
                            total={Math.max(
                                session.reviewTotal,
                                session.reviewDoneCount,
                            )}
                            ariaLabel="本轮复习进度"
                        />
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <div class="pointer-events-none absolute inset-x-0 bottom-0 z-20">
        <footer
            class="pointer-events-auto relative px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-8 sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pt-5"
        >
            {@render footerBar()}
        </footer>
    </div>
</div>

<MemorySettings
    bind:open={showSettings}
    hash={bank.hash}
    bankName={bank.name}
/>

<MemoryOverview
    open={showOverview}
    onOpenChange={(open) => (showOverview = open)}
/>
