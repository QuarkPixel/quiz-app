<script lang="ts">
    import { toastStore } from "@/features/toast.svelte";
    import { MediaQuery } from "svelte/reactivity";
    import FlashContainer from "./FlashContainer.svelte";
    import ReviewView from "../review/ReviewView.svelte";
    import Settings from "../settings/Settings.svelte";
    import PoolPanel from "./PoolPanel.svelte";
    import ProgressBar from "./ProgressBar.svelte";
    import QuestionArea from "./QuestionArea.svelte";
    import ViewShell from "../layout/ViewShell.svelte";
    import ToolbarIconButton from "../layout/ToolbarIconButton.svelte";
    import ImportProgressDialog from "../settings/ImportProgressDialog.svelte";

    import { cn } from "$lib/utils";
    import { COMPACT_LAYOUT_QUERY } from "@/config";
    import IconBook2 from "@tabler/icons-svelte/icons/book-2";
    import IconStack2 from "@tabler/icons-svelte/icons/stack-2";
    import IconSettings from "@tabler/icons-svelte/icons/settings";

    import type { QuizBank } from "@/source/types";
    import { QuizSession } from "@/quiz/session/QuizSession.svelte";
    import { provideQuizSession } from "@/quiz/session/context";
    import { provideQuizUiActions } from "@/quiz/session/uiContext";
    import { createAppKeyboardHandler } from "@/features/appShortcuts";
    import { createSoundPlayer } from "@/sound";

    let { bank }: { bank: QuizBank } = $props();

    let flashContainer: FlashContainer;
    const soundPlayer = createSoundPlayer();

    // session 在挂载前构造 —— 此时 flash/toast 还未 bind，回调里走 ?. 兜底。
    // bank 在外层用 {#key bank.hash} 控制重建，所以这里把 bank 当作不变量处理。
    // svelte-ignore state_referenced_locally
    const session = new QuizSession(bank, {
        flash: (correct) => flashContainer?.flash(correct),
        toast: (title, description, variant) =>
            toastStore.show(title, description, variant),
        sound: soundPlayer,
    });
    provideQuizSession(session);

    // dialog 开关：纯 UI flag，留在容器局部
    let showReview = $state(false);
    let showSettings = $state(false);
    /** 窄版面：答题区与活动池改成上下堆叠（口径见 `@/config/layout`） */
    const compactLayout = new MediaQuery(COMPACT_LAYOUT_QUERY);

    let compactPoolContent = $state<HTMLDivElement | null>(null);
    let compactPoolHeight = $state(0);

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

    const handleKeydown = createAppKeyboardHandler(session, {
        toggleReview: uiActions.toggleReview,
        toggleSettings: uiActions.toggleSettings,
    });

    session.initialize();

    // 窄版面时活动池是「折叠展开」而不是「并排」：高度得量出来才能做动画
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
</script>

<svelte:window onkeydown={handleKeydown} />

<FlashContainer bind:this={flashContainer} />

{#snippet leftControls()}
    <div class="flex items-center gap-1">
        <ToolbarIconButton
            icon={IconSettings}
            label="当前题库设置"
            shortcut="toggleSettings"
            rotateClass="hover:rotate-[30deg]"
            expanded={showSettings}
            onclick={uiActions.toggleSettings}
        />

        <ToolbarIconButton
            icon={IconBook2}
            label="总览"
            shortcut="toggleReview"
            rotateClass="hover:rotate-[10deg]"
            expanded={showReview}
            onclick={uiActions.toggleReview}
        />
    </div>
{/snippet}

{#snippet rightControls()}
    <ToolbarIconButton
        icon={IconStack2}
        label="查看活动池"
        tooltip="{session.appState.ui.showPool ? '收起' : '展开'}活动池"
        shortcut="togglePool"
        rotateClass="hover:-rotate-[8deg]"
        pressed={session.appState.ui.showPool}
        onclick={() => session.togglePool()}
    />
{/snippet}

{#snippet questionColumn()}
    <QuestionArea />

    <ProgressBar
        stats={session.stats}
        learningSegments={session.learningSegments}
        focused={session.appState.ui.progressFocused}
        onToggleFocus={() => session.toggleProgressFocus()}
    />
{/snippet}

<ViewShell scrollTopButton left={leftControls} right={rightControls}>
    {#if compactLayout.current}
        <div class="my-auto flex w-full flex-col gap-6">
            <div class="flex min-w-0 flex-col gap-5">
                {@render questionColumn()}
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
                <div bind:this={compactPoolContent} class="flex w-full flex-col">
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
                {@render questionColumn()}
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
</ViewShell>

<Settings bind:open={showSettings} hash={bank.hash} bankName={bank.name} />

<ReviewView
    open={showReview}
    onOpenChange={(o) => (showReview = o)}
    onToast={(title, description, variant) =>
        toastStore.show(title, description, variant)}
/>

<ImportProgressDialog
    text={session.importConfirmText}
    onCancel={() => session.cancelImport()}
    onConfirm={() => session.commitImport()}
/>

<style>
    /* 大屏左右布局时给活动池左侧加渐变 mask，柔化裁切边。
       小屏上下布局时无需 mask（PoolPanel 自身顶/底有渐变）。
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
