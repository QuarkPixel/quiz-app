<script lang="ts">
    import type { MemoryBank } from "@/source/types";
    import { MediaQuery } from "svelte/reactivity";
    import { toastStore } from "@/features/toast.svelte";
    import { MemorySession } from "@/features/memory/MemorySession.svelte";
    import { provideMemorySession } from "@/features/memory/context";
    import FlashContainer from "../quiz/FlashContainer.svelte";
    import MemoryHome from "./MemoryHome.svelte";
    import MemoryQuestionArea from "./MemoryQuestionArea.svelte";
    import MemorySettings from "../settings/MemorySettings.svelte";
    import MemoryOverview from "./MemoryOverview.svelte";
    import MemoryProgressBar from "./MemoryProgressBar.svelte";
    import ViewShell from "../layout/ViewShell.svelte";
    import ToolbarIconButton from "../layout/ToolbarIconButton.svelte";
    import ImportProgressDialog from "../settings/ImportProgressDialog.svelte";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Button } from "$lib/components/ui/button";
    import { COMPACT_LAYOUT_QUERY } from "@/config";
    import IconSettings from "@tabler/icons-svelte/icons/settings";
    import IconBook2 from "@tabler/icons-svelte/icons/book-2";
    import IconArrowLeft from "@tabler/icons-svelte/icons/arrow-left";
    import { createSoundPlayer } from "@/sound";
    import { createAppKeyboardHandler } from "@/features/appShortcuts";

    /**
     * 版面与 `QuizView` 完全一致：同一个 `ViewShell`（滚动容器 + 底部渐变遮罩 +
     * 底部工具栏），只是内容区在「首页」和「答题区」之间切换、工具栏少了活动池。
     *
     * 版面上的共性一律走共享组件（`ViewShell` / `ToolbarIconButton` /
     * `ImportProgressDialog` / `ShortcutHelp`），不在这个文件里重写一遍——
     * 记忆模式当初就是因为「照着刷题模式抄一份」而漏掉遮罩等一堆细节。
     */
    let { bank }: { bank: MemoryBank } = $props();

    let flashContainer: FlashContainer;
    const soundPlayer = createSoundPlayer();

    // bank 在外层用 {#key bank.hash} 控制重建，这里把它当作不变量处理。
    // svelte-ignore state_referenced_locally
    // session 在挂载前构造 —— 此时 flash/toast 还未 bind，回调里走 ?. 兜底
    const session = new MemorySession(bank, {
        flash: (correct) => flashContainer?.flash(correct),
        toast: (title, description, variant) =>
            toastStore.show(title, description, variant),
        sound: soundPlayer,
    });
    provideMemorySession(session);

    let showSettings = $state(false);
    let showOverview = $state(false);
    /** 窄版面：答题列占满宽度（口径见 `@/config/layout`） */
    const compactLayout = new MediaQuery(COMPACT_LAYOUT_QUERY);

    /**
     * 窗口级快捷键：**与刷题模式共用同一份分发**（`@/features/appShortcuts`）。
     *
     * 这里只传两个模式都没有的「视图动作」（两个 dialog 的开关）；题目级按键
     * （知道 / 模糊 / 忘记 / 下一题）走题型注册表，应用级按键（⌘C / ⌘I / ⌘O /
     * ⌘W / ⌘E / ⌘S / ⌘N / ⌘⇧I）走快捷键注册表——所以记忆模式不会再漏键。
     * Esc = 结束本轮由 session 的 `isSessionActive` + `exitSession` 表达。
     */
    const handleKeydown = createAppKeyboardHandler(session, {
        toggleReview: () => (showOverview = !showOverview),
        toggleSettings: () => (showSettings = !showSettings),
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
            onclick={() => (showSettings = !showSettings)}
        />

        <ToolbarIconButton
            icon={IconBook2}
            label="总览"
            shortcut="toggleReview"
            rotateClass="hover:rotate-[10deg]"
            expanded={showOverview}
            onclick={() => (showOverview = !showOverview)}
        />
    </div>
{/snippet}

<ViewShell left={leftControls}>
    {#if session.run === "idle"}
        <div class="my-auto w-full max-w-2xl">
            <MemoryHome name={bank.name} />
        </div>
    {:else}
        <div
            class={compactLayout.current
                ? "my-auto flex w-full flex-col gap-5"
                : "my-auto flex w-full max-w-2xl flex-col gap-5"}
        >
            <!-- 「结束本轮」跟着内容流走（不悬浮在顶部），换行时不会盖住题干 -->
            <div>
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

            <MemoryQuestionArea />

            {#if session.run === "learning"}
                <!-- 本轮学习进度：左边已掌握数，中间「3/5」，右边目标数 -->
                <MemoryProgressBar
                    done={session.roundCompletedCount}
                    total={session.targetPerRound}
                    label="{session.roundCompletedCount}/{session
                        .targetPerRound}"
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
</ViewShell>

<MemorySettings
    bind:open={showSettings}
    hash={bank.hash}
    bankName={bank.name}
/>

<MemoryOverview
    open={showOverview}
    onOpenChange={(open) => (showOverview = open)}
/>

<ImportProgressDialog
    text={session.importConfirmText}
    onCancel={() => session.cancelImport()}
    onConfirm={() => session.commitImport()}
/>
