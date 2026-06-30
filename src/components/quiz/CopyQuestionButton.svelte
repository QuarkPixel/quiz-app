<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { cn } from "$lib/utils";
    import IconCopy from "@tabler/icons-svelte/icons/copy";
    import IconCopyCheck from "@tabler/icons-svelte/icons/copy-check";
    import IconAlertCircle from "@tabler/icons-svelte/icons/alert-circle";
    import type { CopyQuestionStatus } from "@/quiz/session/QuizSession.svelte";

    interface Props {
        status: CopyQuestionStatus;
        onclick: (e: MouseEvent) => void;
        onpointerdown?: (e: PointerEvent) => void;
        onpointermove?: (e: PointerEvent) => void;
        onpointerup?: (e: PointerEvent) => void;
        onpointercancel?: (e: PointerEvent) => void;
    }

    let {
        status,
        onclick,
        onpointerdown,
        onpointermove,
        onpointerup,
        onpointercancel,
    }: Props = $props();

    const label = $derived(
        status === "copied"
            ? "已复制"
            : status === "error"
              ? "复制失败"
              : "复制题目",
    );
</script>

<Tooltip.Root delayDuration={0}>
    <Tooltip.Trigger>
        {#snippet child({ props })}
            <Button
                {...props}
                variant={status === "idle" ? "ghost" : "secondary"}
                size="icon-xs"
                class={cn(
                    status === "copied" && "text-success hover:text-success",
                    status === "error" && "text-destructive hover:text-destructive",
                )}
                aria-label={label}
                {onclick}
                {onpointerdown}
                {onpointermove}
                {onpointerup}
                {onpointercancel}
            >
                {#if status === "copied"}
                    <IconCopyCheck stroke={1.75} />
                {:else if status === "error"}
                    <IconAlertCircle stroke={1.75} />
                {:else}
                    <IconCopy stroke={1.75} />
                {/if}
            </Button>
        {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="bottom" align="end">
        <span>{label}</span>
    </Tooltip.Content>
</Tooltip.Root>
