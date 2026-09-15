<script lang="ts">
    /**
     * `ToolbarIconButton` 的测试外壳。
     *
     * 必须补 `<Tooltip.Provider>`：bits-ui 的 `Tooltip.Root` 没有 Provider 会直接抛错
     * （`App.svelte` 里也是这么套的）。
     */
    import * as Tooltip from "$lib/components/ui/tooltip";
    import ToolbarIconButton from "@/components/layout/ToolbarIconButton.svelte";
    import IconSettings from "@tabler/icons-svelte/icons/settings";
    import type { ShortcutId } from "@/config";

    interface Props {
        label: string;
        tooltip?: string;
        shortcut?: ShortcutId;
        expanded?: boolean;
        pressed?: boolean;
        onclick: () => void;
        rotateClass?: string;
    }

    let {
        label,
        tooltip,
        shortcut,
        expanded,
        pressed = false,
        onclick,
        rotateClass,
    }: Props = $props();
</script>

<Tooltip.Provider delayDuration={0}>
    <ToolbarIconButton
        icon={IconSettings}
        {label}
        {tooltip}
        {shortcut}
        {expanded}
        {pressed}
        {onclick}
        {rotateClass}
    />
</Tooltip.Provider>
