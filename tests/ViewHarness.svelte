<script lang="ts">
    /**
     * 组件测试外壳：把 `QuizView` / `MemoryView` 挂起来，并补上它们需要的东西。
     *
     * 存在的理由很直接：`ViewShell` / `ToolbarIconButton` / `SettingsDialog` 这些
     * 共享外壳是**重构成**的，而「点齿轮能打开设置」这类最基本的动作以前没有任何
     * 测试守着——外壳一改，坏了也没人知道（真出过一次：刷题模式设置打不开）。
     */
    import * as Tooltip from "$lib/components/ui/tooltip";
    import QuizView from "@/components/quiz/QuizView.svelte";
    import MemoryView from "@/components/memory/MemoryView.svelte";
    import { provideQuizSource } from "@/source/context";
    import { provideRouter } from "@/features/routing/context";
    import { Router } from "@/features/routing/router.svelte";
    import type { Bank, QuizSource } from "@/source/types";

    interface Props {
        bank: Bank;
        source: QuizSource;
    }

    let { bank, source }: Props = $props();

    // Settings ⇄ BankNameSetting 里要用（改题库名）
    // svelte-ignore state_referenced_locally
    provideQuizSource(source);

    /**
     * 路由：真实应用里由 `App.svelte` 提供（它还会把 URL 一起接上）。
     *
     * 这里用一套空转的 `history` / `location`：组件挂载时那个 `start()` 会写一次
     * URL（把本地记着的题库补进地址栏），而组件测试不该去动整个测试进程的地址。
     */
    const router = new Router();
    const env = {
        history: { pushState: () => {}, replaceState: () => {} },
        location: { pathname: "/", hash: "", search: "" },
        window: { addEventListener: () => {}, removeEventListener: () => {} },
    };
    // svelte-ignore state_referenced_locally
    router.start(source, { env, mountPath: "/" });
    provideRouter(router);
</script>

<!-- bits-ui 的 Tooltip.Root 没有 Provider 会直接抛错，与 App.svelte 的层级一致 -->
<Tooltip.Provider delayDuration={0}>
    {#if bank.mode === "quiz"}
        <QuizView {bank} />
    {:else}
        <MemoryView {bank} />
    {/if}
</Tooltip.Provider>
