<script lang="ts">
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import { Button } from "$lib/components/ui/button";
    import PanelLeftIcon from "@lucide/svelte/icons/panel-left";
    import { useSidebar } from "$lib/components/ui/sidebar/context.svelte";
    import { modKeyLabel } from "$lib/platform";
    import { SHORTCUTS } from "../../config";

    const sidebar = useSidebar();
</script>

<Tooltip.Root>
    <Tooltip.Trigger>
        {#snippet child({ props })}
            <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                class="-ml-1"
                aria-label="切换侧边栏"
                onclick={() => sidebar.toggle()}
            >
                <PanelLeftIcon />
            </Button>
        {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom">
        <span>{sidebar.open ? "收起" : "展开"}侧边栏</span>
        <KbdGroup>
            <Kbd>{modKeyLabel}</Kbd>
            <Kbd>{SHORTCUTS.sidebar.toUpperCase()}</Kbd>
        </KbdGroup>
    </Tooltip.Content>
</Tooltip.Root>
