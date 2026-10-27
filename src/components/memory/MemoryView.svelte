<script lang="ts">
    import type { MemoryBank } from "@/source/types";
    import { untrack } from "svelte";
    import { toastStore } from "@/features/toast.svelte";
    import { MemorySession } from "@/features/memory/MemorySession.svelte";
    import { provideMemorySession } from "@/features/memory/context";
    import FlashContainer from "../quiz/FlashContainer.svelte";
    import MemoryHome from "./MemoryHome.svelte";
    import MemoryQuestionBody from "./MemoryQuestionBody.svelte";
    import MemoryQuestionMeta from "./MemoryQuestionMeta.svelte";
    import MemoryQuestionActions from "./MemoryQuestionActions.svelte";
    import MemoryRoundActions from "./MemoryRoundActions.svelte";
    import MemorySettings from "../settings/MemorySettings.svelte";
    import MemoryOverview from "@/components/overview/MemoryOverview.svelte";
    import MemoryProgressBar from "./MemoryProgressBar.svelte";
    import ViewShell from "../layout/ViewShell.svelte";
    import SwapFade from "../shared/SwapFade.svelte";
    import { swapIn } from "@/lib/transitions/swap";
    import ToolbarIconButton from "../layout/ToolbarIconButton.svelte";
    import ImportProgressDialog from "../settings/ImportProgressDialog.svelte";
    import { SWAP_MS } from "@/config";
    import { prefersReducedMotion } from "$lib/utils";
    import IconSettings from "@tabler/icons-svelte/icons/settings";
    import IconBook2 from "@tabler/icons-svelte/icons/book-2";
    import { createSoundPlayer } from "@/sound";
    import { createAppKeyboardHandler } from "@/features/appShortcuts";
    import { useRouter } from "@/features/routing/context";
    import {
        OVERLAY_KEYS,
        userActivity,
    } from "@/features/userActivity.svelte";

    /**
     * 记忆模式的装配层：版面与 `QuizView` **完全同构**（同一个 `ViewShell`，
     * 同样三块固定 + 一块滚动），差别只在内容：
     *
     *   固定顶栏  → 本轮操作（退出 / 结束本轮）+ 题号那一行
     *   滚动区    → 题干 + 答案卡片（没有进行中的一轮时是首页）
     *   固定底栏  → 忘记 / 模糊 / 知道（或降级入口）+ 本轮进度条
     *   工具栏    → 设置 / 总览（没有活动池）
     *
     * 记忆模式当初就是因为「照着刷题模式抄一份」而漏掉遮罩、漏掉键盘表里的一堆键，
     * 所以这里凡是共性的东西一律走共享组件，这个文件只做装配与路由。
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

    /**
     * 子路径 ←→ 会话，两个方向都在下面两个 `$effect` 里。
     *
     * 这一层是「刷新之后别把我踢回首页」的全部实现：`/learn`、`/review` 落在 URL 上，
     * 刷新回来 `syncModeToSession()` 照着它把会话重新开起来（学到一半的一轮、
     * 今天复习了几道都落盘了，见 `MemorySession` 的两条流）。
     */
    const router = useRouter();

    let showSettings = $state(false);
    let showOverview = $state(false);

    /**
     * 窗口级快捷键：**与刷题模式共用同一份分发**（`@/features/appShortcuts`）。
     *
     * 这里只传两个模式都没有的「视图动作」（两个 dialog 的开关）；题目级按键
     * （知道 / 模糊 / 忘记 / 下一题）走题型注册表，应用级按键（⌘C / ⌘I / ⌘O /
     * ⌘W / ⌘E / ⌘S / ⌘N / ⌘⇧I）走快捷键注册表——所以记忆模式不会再漏键。
     * Esc = 退出本轮由 session 的 `isSessionActive` + `exitSession` 表达。
     */
    const handleKeydown = createAppKeyboardHandler(session, {
        toggleReview: () => (showOverview = !showOverview),
        toggleSettings: () => (showSettings = !showSettings),
    });

    // ── 云同步的刷新让路 ────────────────────────────────────────────────
    //
    // 「正在答题」= 屏上有题（`currentQuestion` 非空），也就是指示点黄着的时候。
    // 同步拉到当前这个题库的新内容时，刷新会被挂起，等这里回到 false 再补上
    // （见 `@/features/userActivity.svelte`）。弹窗同理：开着设置 / 总览时刷新，
    // 用户正在看的东西会连同弹窗一起消失。
    $effect(() => {
        userActivity.setAnswering(session.currentQuestion !== null);
    });

    $effect(() => {
        const open =
            showSettings || showOverview || session.importConfirmText !== null;
        // 只在真的变了时写：直接写会在 effect 读写的**同一块** state 上打转
        // （`effect_update_depth_exceeded`）
        if (open !== untrack(() => userActivity.overlayOpen)) {
            userActivity.setOverlay(OVERLAY_KEYS.settings, open);
        }
    });

    // ── 子路径 ←→ 会话 ─────────────────────────────────────────────────

    /**
     * 会话 → URL。
     *
     * 会话自己开始（首页那颗按钮）会走到这里；会话自己结束（学完一轮 / Esc）由
     * `if (previousRun !== "idle" && mode !== "home")` 那一支收尾。
     *
     * **反过来「URL 写着 /learn 但会话还没开起来」时绝不能在这里纠正**：应用打开的
     * 那一刻会话必然是 `idle`，而下面那个 effect 还要照着 URL 把它开起来。
     * 早期版本无条件写 `run → mode`，于是挂载顺序一换就把 `/learn` 冲成首页，
     * 「刷新后继续学」整个失效（`tests/memoryRouting.test.ts` 钉住了这一条）。
     */
    let previousRun = $state(session.run);
    $effect(() => {
        const mode = router.mode;
        if (session.run === "idle") {
            // 会话已经收尾，URL 还停在子路径上 → 跟回首页
            if (previousRun !== "idle" && mode !== "home") router.setMode("home");
            previousRun = "idle";
            return;
        }
        const wanted = session.run === "learning" ? "learn" : "review";
        previousRun = session.run;
        if (mode !== wanted) router.setMode(wanted);
    });

    /**
     * URL → 会话：刷新 / 从别处打开 `/learn`、`/review` 时把会话重新开起来。
     *
     * 只认**这一轮还在不在**，不认「URL 是刚变的还是刷新前就在」：
     *   - `/learn`：学到一半的一轮（池子里还有卡）→ `startLearning()` 接着学；
     *     没有半轮可续（池子被「结束本轮」清空了）→ 回首页，而不是硬开一轮新的；
     *   - `/review`：`startReview()` 自己会把今天到期 + 还没补完连对的那批重新排上，
     *     今天没有要复习的就什么都不做 → 回首页（它会自己弹一句「今天没有需要复习的题目」）。
     *
     * `session.run` 用 `untrack` 读：这个 effect 只该在**路由变化**时动会话，
     * 否则会话自然收尾（`run` 由 learning 变回 idle）的那一刻会被它当成
     * 「URL 还写着 /learn」又开一轮。
     */
    $effect(() => {
        const mode = router.mode;
        const run = untrack(() => session.run);

        if (mode === "learn" && run === "idle") {
            if (session.hasOngoingRound) session.startLearning();
            if (session.run === "idle") router.setMode("home");
            return;
        }
        if (mode === "review" && run === "idle") {
            session.startReview();
            if (session.run === "idle") router.setMode("home");
            return;
        }
        if (mode === "home" && run !== "idle") session.exitSession();
    });

    const inSession = $derived(session.run !== "idle");

    /** 底部那几行的进场时长（和换屏同一个值，`SwapFade` 内部也是这个口径） */
    const swapMs = $derived(prefersReducedMotion ? 0 : SWAP_MS);
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

{#snippet headerSlot()}
    <!-- 本轮操作是「会话级」的：没有进行中的一轮就没有它（首页那两行按钮自己说话） -->
    {#if inSession}
        <div in:swapIn={{ duration: swapMs }}>
            <MemoryRoundActions />
            <MemoryQuestionMeta />
        </div>
    {/if}
{/snippet}

{#snippet actionsSlot()}
    {#if inSession}
        <div in:swapIn={{ duration: swapMs }}>
            <MemoryQuestionActions />
        </div>
    {/if}
{/snippet}

{#snippet progressSlot()}
    {#if session.run === "learning"}
        <!-- 本轮学习进度：左边已掌握数，中间「3/5」，右边目标数 -->
        <div in:swapIn={{ duration: swapMs }}>
            <MemoryProgressBar
                done={session.roundCompletedCount}
                total={session.targetPerRound}
                label="{session.roundCompletedCount}/{session.targetPerRound}"
                ariaLabel="本轮学习进度"
            />
        </div>
    {:else if session.run === "reviewing"}
        <!-- 复习进度：每复习完一题变绿 -->
        <div in:swapIn={{ duration: swapMs }}>
            <MemoryProgressBar
                done={session.reviewDoneCount}
                total={Math.max(session.reviewTotal, session.reviewDoneCount)}
                ariaLabel="本轮复习进度"
            />
        </div>
    {/if}
{/snippet}

<!--
    **`ViewShell` 不参与换屏过渡，只有滚动区里那层内容参与。**

    以前是把整个 `ViewShell` 塞进 `SwapFade`：首页 ↔ 学习 / 复习切换时，连底部工具栏
    （设置 / 总览）也跟着缩放淡出。可它在动画前后是同一个东西、同一个位置，只是被
    两层各画了一遍（一层 95%、一层 100%），看着就是「图标抖了一下」——纯属自找的
    怪异。所以现在外壳常驻、只有内容层换。

    另外三行（题号行 / 操作条 / 进度条）确实只在会话里有，所以它们各自带一个
    `in:swapIn` 淡入；**只写 `in` 不写 `out`**：退场时如果让它们淡出，这两百毫秒里
    它们还占着高度，等淡完一收，刚居中的首页内容又得跳一下——不如干脆利落地消失。
-->
<ViewShell
    header={headerSlot}
    actions={actionsSlot}
    progress={progressSlot}
    left={leftControls}
>
    <SwapFade
        seq={inSession}
        class="flex min-h-0 flex-1 flex-col"
        itemClass="flex min-h-0 flex-1 flex-col"
    >
        {#if inSession}
            <MemoryQuestionBody />
        {:else}
            <div class="my-auto w-full">
                <MemoryHome name={bank.name} />
            </div>
        {/if}
    </SwapFade>
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
