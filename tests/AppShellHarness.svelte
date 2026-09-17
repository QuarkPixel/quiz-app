<script lang="ts">
    /**
     * `AppShell` 的测试外壳：把层级对齐 `App.svelte`。
     *
     * 为什么要这一层：`App.svelte` 把整棵树包在 `SidebarUI.Provider` 里，而它内部就是
     * bits-ui 的 `<Tooltip.Provider>`；页头那颗同步指示点用的是 `Tooltip.Root`，
     * 必须在它下面——bits-ui 2.19 起缺了这一层会直接抛
     * `Context "Tooltip.Provider" not found`（见 `SettingsPrimitivesHarness.svelte`
     * 里同样的那一层）。单独 mount `AppShell` 就没有它。
     *
     * `Tooltip.Provider` 不渲染任何 DOM，所以挂载点的结构跟直接 mount `AppShell` 一样。
     */
    import AppShell from "@/components/layout/AppShell.svelte";
    import * as Tooltip from "$lib/components/ui/tooltip";
</script>

<Tooltip.Provider delayDuration={0}>
    <AppShell />
</Tooltip.Provider>
