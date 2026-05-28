<script lang="ts" module>
    export type ToastVariant = "default" | "success" | "destructive";
</script>

<script lang="ts">
    import * as AlertUI from "$lib/components/ui/alert";
    import { cn } from "$lib/utils";
    import { TOAST_DURATION_MS, TOAST_FADE_MS } from "../config";
    import IconCheck from "@tabler/icons-svelte/icons/check";
    import IconAlertTriangle from "@tabler/icons-svelte/icons/alert-triangle";
    import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";

    type Toast = {
        title: string;
        description?: string;
        variant: ToastVariant;
    };

    let current = $state<Toast | null>(null);
    let visible = $state(false);
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    export function show(
        title: string,
        description?: string,
        variant: ToastVariant = "default",
    ): void {
        if (showTimer) clearTimeout(showTimer);
        if (clearTimer) clearTimeout(clearTimer);

        current = { title, description, variant };
        visible = true;

        showTimer = setTimeout(() => {
            visible = false;
            clearTimer = setTimeout(() => {
                current = null;
                clearTimer = null;
            }, TOAST_FADE_MS);
            showTimer = null;
        }, TOAST_DURATION_MS);
    }
</script>

<div
    class={cn(
        "pointer-events-none fixed top-4 right-4 z-50 transition-all will-change-transform",
        visible
            ? "opacity-100 translate-y-0 duration-500 ease-spring"
            : "opacity-0 -translate-y-3 scale-[0.97] duration-200 ease-spring-out",
    )}
    role="status"
    aria-live="polite"
>
    {#if current}
        <AlertUI.Root
            variant={current.variant === "destructive"
                ? "destructive"
                : "default"}
            class="pointer-events-auto bg-popover ring-foreground/10 max-w-xs shadow-lg ring-1"
        >
            {#if current.variant === "success"}
                <IconCheck class="text-success" />
            {:else if current.variant === "destructive"}
                <IconAlertTriangle />
            {:else}
                <IconInfoCircle class="text-muted-foreground" />
            {/if}
            <AlertUI.Title>{current.title}</AlertUI.Title>
            {#if current.description}
                <AlertUI.Description>{current.description}</AlertUI.Description>
            {/if}
        </AlertUI.Root>
    {/if}
</div>
