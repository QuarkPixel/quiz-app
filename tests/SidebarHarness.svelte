<script lang="ts">
    // 侧边栏测试外壳：补上它依赖的 Sidebar.Provider 上下文
    // （那个 Provider 内部已经带了 Tooltip.Provider）。
    import * as Sidebar from "$lib/components/ui/sidebar";
    import SidebarUI from "@/components/layout/Sidebar.svelte";
    import { createSource } from "@/source";

    const source = createSource();
</script>

<Sidebar.Provider open={false}>
    <SidebarUI {source} />
</Sidebar.Provider>
