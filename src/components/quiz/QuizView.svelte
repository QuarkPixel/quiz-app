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
    import { onMount, type Component } from "svelte";
    import { subscribeStoredStateWrite } from "@/store";
    import { activeWork } from "@/features/sync/activeWork.svelte";
    import { MediaQuery } from "svelte/reactivity";
    import { COMPACT_LAYOUT_QUERY } from "@/config";
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

    // 同步把盘上那份改写之后，会话要重读一次（理由同记忆模式，见
    // `subscribeStoredStateWrite` 与 `QuizSession.reloadFromStorage`）。
    // 顺便把自己登记成"当前正在看的题库"：同步写本地之前会问 `activeWork.isBusy`。
    onMount(() => {
        const leave = activeWork.enter(bank.hash);
        const off = subscribeStoredStateWrite((hash) => {
            if (hash === bank.hash) session.reloadFromStorage();
        });
        return () => {
            off();
            leave();
        };
    });

    // 屏上有没有未提交的作答 = 同步"要不要先问一句"的唯一依据。
    // 刚打开、还没作答时换一道题不会打断任何人，直接落地。
    $effect(() => {
        activeWork.setBusy(bank.hash, session.hasWorkInProgress);
    });

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
