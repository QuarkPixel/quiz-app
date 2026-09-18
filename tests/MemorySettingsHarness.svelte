<script lang="ts">
    /**
     * 记忆模式设置面板（`MemorySettings.svelte`）的测试外壳。
     *
     * 与 `MemoryOverviewHarness` 同一个理由：面板要 `MemorySession` 与 `QuizSource`
     * 两个上下文（后者由里面的 `BankNameSetting` 用），还套着 `SettingsDialog`
     * （bits-ui 的 Dialog，内容走 portal）——不套外壳根本挂不起来。
     * 这只多给一个「面板开着还是关着」的出口：真实应用里那个开关在底部工具栏。
     */
    import * as Tooltip from "$lib/components/ui/tooltip";
    import MemorySettings from "@/components/settings/MemorySettings.svelte";
    import { provideMemorySession } from "@/features/memory/context";
    import { provideQuizSource } from "@/source/context";
    import type { MemorySession } from "@/features/memory/MemorySession.svelte";
    import type { QuizSource } from "@/source/types";

    interface Props {
        session: MemorySession;
        source: QuizSource;
        hash: string;
        bankName: string;
    }

    let { session, source, hash, bankName }: Props = $props();

    provideMemorySession(session);
    provideQuizSource(source);

    let open = $state(true);
</script>

<!-- 与 App.svelte 的层级一致：面板底下的 bits-ui 原语可能需要 Provider -->
<Tooltip.Provider delayDuration={0}>
    <MemorySettings bind:open {hash} {bankName} />
</Tooltip.Provider>
