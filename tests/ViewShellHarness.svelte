<script lang="ts">
    /**
     * `ViewShell` 的测试外壳：只放一个最简的左右工具栏与一行内容，
     * 让断言盯在「外壳自己的行为」上，不被业务内容干扰。
     */
    import ViewShell from "@/components/layout/ViewShell.svelte";

    interface Props {
        scrollTopButton?: boolean;
    }

    let { scrollTopButton = false }: Props = $props();
</script>

<ViewShell {scrollTopButton}>
    {#snippet left()}
        <span data-testid="left">左侧按钮</span>
    {/snippet}
    {#snippet right()}
        <span data-testid="right">右侧按钮</span>
    {/snippet}
    <p>内容</p>
</ViewShell>
