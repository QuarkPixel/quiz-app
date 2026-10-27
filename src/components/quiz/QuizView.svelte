<script lang="ts">
    import { toastStore } from "@/features/toast.svelte";
    import FlashContainer from "./FlashContainer.svelte";
    import QuizOverview from "@/components/overview/QuizOverview.svelte";
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
    import { untrack, type Component } from "svelte";
    import { MediaQuery } from "svelte/reactivity";
    import { COMPACT_LAYOUT_QUERY } from "@/config";
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

    // ── 活动池的两种摆法（同一个状态，两个壳） ──────────────────────────
    //
    //  宽版面 → `ViewShell` 右边那一列（宽度 0 ↔ 280px）
    //  窄版面 → 底部抽屉 `PoolDrawer`
    //
    // 两边读的都是 `session.appState.ui.showPool`，所以不存在「切了宽度状态对不上」。
    // 断点用同一个 `COMPACT_LAYOUT_QUERY`，与 `ViewShell` 内部那个 `MediaQuery` 同源。
    const compact = new MediaQuery(COMPACT_LAYOUT_QUERY);

    interface PoolDrawerProps {
        open: boolean;
        onOpenChange?: (open: boolean) => void;
    }

    /**
     * 抽屉是**懒加载**的：它拖着 `vaul-svelte`（约 16 kB gzip），而首屏
     * 99% 的情况用不到——`AGENTS.md` 的「首屏体积」一节明确要求别往主包里塞。
     * 只在真的落到窄版面时才把那个 chunk 拉下来（模式与 `SyncGuideDrawer` 一致）。
     */
    let PoolDrawer = $state<Component<PoolDrawerProps> | null>(null);

    $effect(() => {
        if (!compact.current || PoolDrawer !== null) return;
        void import("./PoolDrawer.svelte").then((module) => {
            PoolDrawer = module.default;
        });
    });

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
    {#if compact.current}
        <!--
            窄版面：这是一颗**打开**按钮，不是开关。抽屉有自己的关闭途径
            （下滑 / 点遮罩 / Esc），所以不需要 `pressed` 去表达状态——
            而且它开着的时候本来就被抽屉盖住了，压暗 / 变深都看不见。
        -->
        <ToolbarIconButton
            icon={IconStack2}
            label="查看活动池"
            tooltip="查看活动池"
            shortcut="togglePool"
            rotateClass="hover:-rotate-[8deg]"
            onclick={() => session.setPoolOpen(true)}
        />
    {:else}
        <ToolbarIconButton
            icon={IconStack2}
            label="查看活动池"
            tooltip="{session.appState.ui.showPool ? '收起' : '展开'}活动池"
            shortcut="togglePool"
            rotateClass="hover:-rotate-[8deg]"
            pressed={session.appState.ui.showPool}
            onclick={() => session.togglePool()}
        />
    {/if}
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

<!--
    窄版面的池子：底部抽屉。与 `ViewShell` 里那一列**互斥**（同一个 `compact` 判据），
    所以任何时刻只有一份池子的 DOM。`onOpenChange` 把抽屉自己的关闭动作写回
    `ui.showPool`——否则宽窄切换时会「明明关掉了、再切回来又弹出来」。
-->
{#if compact.current && PoolDrawer}
    <PoolDrawer
        open={session.appState.ui.showPool}
        onOpenChange={(open) => session.setPoolOpen(open)}
    />
{/if}

<Settings bind:open={showSettings} hash={bank.hash} bankName={bank.name} />

<QuizOverview
    open={showReview}
    onOpenChange={(o) => (showReview = o)}
/>

<ImportProgressDialog
    text={session.importConfirmText}
    onCancel={() => session.cancelImport()}
    onConfirm={() => session.commitImport()}
/>
