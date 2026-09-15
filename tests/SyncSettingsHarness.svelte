<script lang="ts">
    // 组件测试用的外壳：照 App.svelte 的样子补上 Tooltip.Provider
    // （bits-ui 的 Tooltip.Root 没有 Provider 会直接抛错）。
    import * as Tooltip from "$lib/components/ui/tooltip";
    import SyncSettings from "@/components/settings/SyncSettings.svelte";
    import AlertToast from "@/components/layout/AlertToast.svelte";
</script>

<Tooltip.Provider delayDuration={0}>
    <SyncSettings />
    <!-- 全局提示和 App.svelte 一样挂在最外层（面板自己不再渲染它） -->
    <AlertToast />
</Tooltip.Provider>
