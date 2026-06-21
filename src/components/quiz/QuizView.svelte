<script lang="ts">
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
    import { createKeyboardHandler } from "@/quiz/session/keyboardHandler";
    import { createSoundPlayer } from "$sound";

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

    const handleKeydown = createKeyboardHandler(session, {
        toggleReview: () => (showReview = !showReview),
        toggleSettings: () => (showSettings = !showSettings),
    });

    session.initialize();
</script>

<svelte:window onkeydown={handleKeydown} />

<FlashContainer bind:this={flashContainer} />
<AlertToast bind:this={toast} />

<main class="flex flex-1 min-h-0 justify-center px-4 sm:px-6 overflow-y-auto">
    <div
        class={cn(
            "my-auto grid w-full max-w-5xl items-stretch justify-center transition-[grid-template-columns,grid-template-rows,gap] duration-[450ms] ease-emphasized",
            "grid-cols-[minmax(0,42rem)_0px] grid-rows-[auto_0px] gap-0",
            // my-auto 让 grid 在内容不溢出时垂直居中；溢出时 flex 容器的 stretch 使 my-auto 退化到 0，自动靠上滚动
            // max-lg + pool 展开：max-h-full 让 grid 不超过 main，pool 行用
            // minmax(180px, min(45vh,300px))：宽裕时 ≤300px，挤压时降到 180px，
            // 不够再退化让 main 滚动。content 够装时 grid 仍是内容高度，被 items-center 垂直居中
            session.appState.ui.showPool &&
                "max-lg:max-h-full max-lg:grid-rows-[auto_minmax(180px,min(45vh,300px))] max-lg:gap-y-6",
            session.appState.ui.showPool &&
                "lg:grid-cols-[minmax(0,42rem)_280px]",
        )}
    >
        <div class="flex w-full min-w-0 flex-col gap-5">
            <QuestionArea onGoToReview={() => (showReview = true)} />

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
                "row-start-2 col-start-1",
                "lg:row-start-1 lg:col-start-2 lg:flex lg:justify-end",
            )}
            aria-hidden={!session.appState.ui.showPool}
        >
            <div
                class={cn(
                    "flex h-full w-full flex-col",
                    "lg:h-[min(70vh,520px)] lg:w-[280px] lg:shrink-0 lg:pl-8",
                )}
            >
                <PoolPanel />
            </div>
        </aside>
    </div>
</main>

<footer class="flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
    <Tooltip.Root>
        <Tooltip.Trigger>
            {#snippet child({ props })}
                <button
                    {...props}
                    type="button"
                    class="text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:rotate-[30deg] aria-expanded:text-foreground"
                    aria-expanded={showSettings}
                    aria-label="当前题库设置"
                    onclick={() => (showSettings = !showSettings)}
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

    <div class="flex items-center gap-1">
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
                <span
                    >{session.appState.ui.showPool
                        ? "收起"
                        : "展开"}活动池</span
                >
                <KbdGroup>
                    <Kbd>{modKeyLabel}</Kbd>
                    <Kbd>{SHORTCUTS.togglePool.toUpperCase()}</Kbd>
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
                        aria-label="总览"
                        onclick={() => (showReview = !showReview)}
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
</footer>

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
