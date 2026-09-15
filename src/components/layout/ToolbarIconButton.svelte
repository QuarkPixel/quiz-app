<script lang="ts">
    import type { IconComponent } from "@/quiz/types/types";
    import { APP_SHORTCUTS, type ShortcutId } from "@/config";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { modKeyLabel } from "$lib/platform";
    import { cn } from "$lib/utils";

    /**
     * 内容区底部工具栏上的那颗圆图标按钮（设置 / 总览 / 活动池）。
     *
     * 刷题与记忆两个模式共用这一份：以前两边的按钮各写一遍，于是记忆模式那边
     * tooltip 里少了快捷键提示。现在提示直接读 `@/config` 的快捷键注册表——
     * 传 `shortcut` 就会自动带上 `<Kbd>`，不存在「两边写得不一致」。
     */
    interface Props {
        icon: IconComponent;
        /** 无障碍标签（固定用这个，不随展开态变） */
        label: string;
        /** tooltip 文案；不传就用 `label` */
        tooltip?: string;
        /** 快捷键注册表里的 id：有就在 tooltip 里显示按键提示 */
        shortcut?: ShortcutId;
        /** hover 时的旋转类，如 `hover:rotate-[30deg]` */
        rotateClass?: string;
        /** 展开态（设置 / 总览）：写 `aria-expanded` 并变深色 */
        expanded?: boolean;
        /** 按下态（活动池）：写 `aria-pressed` 并加底色 */
        pressed?: boolean;
        onclick: () => void;
    }

    let {
        icon: Icon,
        label,
        tooltip,
        shortcut,
        rotateClass = "hover:rotate-[10deg]",
        expanded,
        pressed = false,
        onclick,
    }: Props = $props();

    /** `"⇧I"` → `["⇧", "I"]`：每个键一个 `<Kbd>`，与说明表排版一致。 */
    const shortcutKeys = $derived(
        shortcut ? APP_SHORTCUTS[shortcut].kbd.split("") : [],
    );
</script>

<Tooltip.Root>
    <Tooltip.Trigger>
        {#snippet child({ props })}
            <button
                {...props}
                type="button"
                class={cn(
                    "text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200",
                    rotateClass,
                    expanded && "aria-expanded:text-foreground",
                    pressed && "text-foreground bg-foreground/8",
                )}
                aria-label={label}
                aria-expanded={expanded}
                aria-pressed={pressed ? true : undefined}
                {onclick}
            >
                <Icon size={22} stroke={1.5} />
            </button>
        {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="top">
        <span>{tooltip ?? label}</span>
        {#if shortcut}
            <KbdGroup>
                <Kbd>{modKeyLabel}</Kbd>
                {#each shortcutKeys as key, keyIndex (keyIndex)}
                    <Kbd>{key}</Kbd>
                {/each}
            </KbdGroup>
        {/if}
    </Tooltip.Content>
</Tooltip.Root>
