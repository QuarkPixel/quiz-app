<script lang="ts">
    import { onMount } from "svelte";
    import "./app.css";

    import QuizView from "./components/quiz/QuizView.svelte";
    import MemoryView from "./components/memory/MemoryView.svelte";
    import AppShell from "./components/layout/AppShell.svelte";
    import AlertToast from "./components/layout/AlertToast.svelte";
    import Sidebar from "./components/layout/Sidebar.svelte";
    import HeaderSidebarTrigger from "./components/layout/HeaderSidebarTrigger.svelte";
    import * as SidebarUI from "$lib/components/ui/sidebar";

    import { createSource } from "./source";
    import { provideQuizSource } from "./source/context";
    import type { Bank } from "./source/types";
    import { provideRouter, router } from "./features/routing/context";
    import { watchPageVisibility } from "./features/userActivity.svelte";
    import SwapFade from "./components/shared/SwapFade.svelte";
    import { SWAP_MS } from "./config";
    import IconFishBoneFilled from "@tabler/icons-svelte/icons/fish-bone-filled";

    const source = createSource();
    provideQuizSource(source);
    provideRouter(router);

    let activeBank = $state<Bank | null>(source.getActiveBank());

    // 当前题库有两个来源，方向只有两条（见 `features/routing/router.svelte.ts`）：
    //   - 路由（URL）：打开页面 / 前进后退 → 已经落在 `source` 上，这里只跟着读
    //   - 侧边栏：用户点了一下 → `source` 先变，再把 URL 跟上（反向同步）
    onMount(() =>
        source.subscribe(() => {
            activeBank = source.getActiveBank();
            router.syncFromSource();
        }),
    );

    // 打开页面先把 URL 与本地记录对一次账：没有参数的地址 → 跳到本地记着的题库
    // （`#/<hash>`），记忆模式还会带上 `/learn`、`/review` 那一层。
    router.start(source);

    // 「页面在后台」也算「现在不能打断」：挂起的同步刷新等回到前台再补
    onMount(watchPageVisibility);

    // 按题库模式收窄：quiz 走刷题模式答题流；memory 走记忆模式的卡片流。
    const quizBank = $derived(activeBank?.mode === "quiz" ? activeBank : null);
    const memoryBank = $derived(
        activeBank?.mode === "memory" ? activeBank : null,
    );

    /**
     * 「换一屏」的标识：换题库 / 换模式 / 回到空状态都算。
     *
     * 它同时替掉了原来的 `{#key bank.hash}`——key 变了就整棵子树重建（新 session），
     * 只是现在这次重建是带着缩放 + 淡入淡出的（`SwapFade`），不再硬切。
     */
    const viewKey = $derived(
        activeBank ? `${activeBank.mode}:${activeBank.hash}` : "empty",
    );
</script>

{#snippet headerStart()}
    <HeaderSidebarTrigger />
{/snippet}

{#snippet bankView()}
    {#if quizBank}
        <QuizView bank={quizBank} />
    {:else if memoryBank}
        <MemoryView bank={memoryBank} />
    {:else}
        <main class="flex flex-1 flex-col items-center justify-center px-6">
            <div class="flex max-w-md flex-col items-center gap-4 text-center">
                <IconFishBoneFilled
                    size={64}
                    class="text-muted-foreground"
                />
                <p class="text-foreground text-lg font-medium">还没有题库</p>
                <p class="text-muted-foreground text-sm leading-relaxed">
                    点击左侧栏「题库」分组右上角的导入按钮，从 JSON 文件开始。
                </p>
            </div>
        </main>
    {/if}
{/snippet}

{#snippet contentBody()}
    <AppShell {headerStart}>
        <SwapFade
            seq={viewKey}
            duration={SWAP_MS}
            class="flex min-h-0 flex-1 flex-col"
            itemClass="flex min-h-0 flex-1 flex-col"
        >
            {@render bankView()}
        </SwapFade>
    </AppShell>
{/snippet}

<SidebarUI.Provider open={false}>
    <Sidebar {source} />
    <SidebarUI.Inset>
        {@render contentBody()}
    </SidebarUI.Inset>
</SidebarUI.Provider>

<!-- 全局提示：整个应用只有这一份（挂在弹窗之外，所以不会被 Dialog 夹住） -->
<AlertToast />
