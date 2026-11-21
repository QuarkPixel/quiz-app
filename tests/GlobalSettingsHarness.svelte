<script lang="ts">
    import * as Tooltip from "$lib/components/ui/tooltip";
    import GlobalSettings from "../src/components/settings/GlobalSettings.svelte";

    // 面板里的 Label 用到 Tooltip，bits-ui 要求上层有 Provider。
    // 应用里由 AppShell / Sidebar 提供，单测里补一个最小外壳。
    let { open = true }: { open?: boolean } = $props();
</script>

<Tooltip.Provider>
    <GlobalSettings {open} />
</Tooltip.Provider>
