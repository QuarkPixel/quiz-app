<script lang="ts">
    import { toastStore } from "@/features/toast.svelte";
    import FlashContainer from "./FlashContainer.svelte";
    import ReviewView from "../review/ReviewView.svelte";
    import Settings from "../settings/Settings.svelte";
    import PoolPanel from "./PoolPanel.svelte";
    import ProgressBar from "./ProgressBar.svelte";
    import QuestionBody from "./QuestionBody.svelte";
    import QuestionMeta from "./QuestionMeta.svelte";
    import QuestionActions from "./QuestionActions.svelte";
    import ViewShell from "../layout/ViewShell.svelte";
    import ToolbarIconButton from "../layout/ToolbarIconButton.svelte";
    import ImportProgressDialog from "../settings/ImportProgressDialog.svelte";

    import IconBook2 from "@tabler/icons-svelte/icons/book-2";
    import IconStack2 from "@tabler/icons-svelte/icons/stack-2";
    import IconSettings from "@tabler/icons-svelte/icons/settings";

    import type { QuizBank } from "@/source/types";
    import { QuizSession } from "@/quiz/session/QuizSession.svelte";
    import { provideQuizSession } from "@/quiz/session/context";
    import { provideQuizUiActions } from "@/quiz/session/uiContext";
    import { createAppKeyboardHandler } from "@/features/appShortcuts";
    import { untrack } from "svelte";
    import {
        OVERLAY_KEYS,
        userActivity,
    } from "@/features/userActivity.svelte";
    import { createSoundPlayer } from "@/sound";

    /**
     * 刷题模式的装配层：只做「把哪几块放进 `ViewShell` 的哪个槽」。
     *
     * 版面（哪块固定、哪块滚、池子在哪）全在 `ViewShell` 里，题型相关的三块
     * （`QuestionMeta` / `QuestionBody` / `QuestionActions`）各自只负责自己那一行。
     * 这个文件以前是「模板 + 版面 + 交互」三合一大杂烩，两个模式各抄一份，
     * 于是记忆模式漏了遮罩、窄屏的池子高度算了两遍。
     */
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

    // ── 云同步的刷新让路 ────────────────────────────────────────────────
    //
    // 「正在答题」= 屏上有题，也就是指示点黄着的时候。同步拉到当前这个题库的新内容
    // 时刷新会被挂起，等这里回到 false 再补（见 `@/features/userActivity.svelte`）。
    $effect(() => {
        userActivity.setAnswering(session.currentQuestion !== null);
    });

    // 弹窗开着时不刷新：设置 / 总览 / 导入确认都是「用户正在看的东西」
    $effect(() => {
        const open = showSettings || showReview || session.importConfirmText !== null;
        // 只在真的变了时写：直接写会在 effect 读写的**同一块** state 上打转
        // （`effect_update_depth_exceeded`）
        if (open !== untrack(() => userActivity.overlayOpen)) {
            userActivity.setOverlay(OVERLAY_KEYS.settings, open);
        }
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

{#snippet header()}
    <QuestionMeta />
{/snippet}

{#snippet actions()}
    <QuestionActions />
{/snippet}

{#snippet progress()}
    <ProgressBar
        stats={session.stats}
        learningSegments={session.learningSegments}
        focused={session.appState.ui.progressFocused}
        onToggleFocus={() => session.toggleProgressFocus()}
    />
{/snippet}

{#snippet pool()}
    <PoolPanel />
{/snippet}

<ViewShell
    {header}
    {actions}
    {progress}
    aside={pool}
    asideOpen={session.appState.ui.showPool}
    left={leftControls}
    right={rightControls}
    scrollTopButton
>
    <QuestionBody />
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
