<script lang="ts">
    /**
     * `ViewShell` 的测试外壳：四块固定内容各放一个可定位的标记，
     * 让断言盯在「外壳自己的版面」上，不被业务内容干扰。
     */
    import ViewShell from "@/components/layout/ViewShell.svelte";

    interface Props {
        scrollTopButton?: boolean;
        asideOpen?: boolean;
        /** 关掉右侧活动池那一列（记忆模式没有池子） */
        withAside?: boolean;
    }

    let {
        scrollTopButton = false,
        asideOpen = false,
        withAside = true,
    }: Props = $props();
</script>

{#snippet header()}
    <div data-testid="header">题号行</div>
{/snippet}

{#snippet actions()}
    <div data-testid="actions">操作条</div>
{/snippet}

{#snippet progress()}
    <div data-testid="progress">进度条</div>
{/snippet}

{#snippet aside()}
    <div data-testid="aside">活动池</div>
{/snippet}

{#snippet left()}
    <span data-testid="left">左侧按钮</span>
{/snippet}

{#snippet right()}
    <span data-testid="right">右侧按钮</span>
{/snippet}

<ViewShell
    header={header}
    {actions}
    {progress}
    aside={withAside ? aside : undefined}
    {asideOpen}
    {left}
    {right}
    {scrollTopButton}
>
    <p data-testid="body">内容</p>
</ViewShell>
