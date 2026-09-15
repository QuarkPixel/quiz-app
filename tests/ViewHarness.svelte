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
    import type { Bank, QuizSource } from "@/source/types";

    interface Props {
        bank: Bank;
        source: QuizSource;
    }

    let { bank, source }: Props = $props();

    // Settings ⇄ BankNameSetting 里要用（改题库名）
    provideQuizSource(source);
</script>

<!-- bits-ui 的 Tooltip.Root 没有 Provider 会直接抛错，与 App.svelte 的层级一致 -->
<Tooltip.Provider delayDuration={0}>
    {#if bank.mode === "quiz"}
        <QuizView {bank} />
    {:else}
        <MemoryView {bank} />
    {/if}
</Tooltip.Provider>
