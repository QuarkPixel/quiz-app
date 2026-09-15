<script lang="ts">
    import * as AlertUI from "$lib/components/ui/alert";
    import { cn } from "$lib/utils";
    import IconCheck from "@tabler/icons-svelte/icons/check";
    import IconAlertTriangle from "@tabler/icons-svelte/icons/alert-triangle";
    import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
    import { toastStore } from "@/features/toast.svelte";

    // 这里只负责「画」：内容和计时都在 `toastStore` 里，全应用只渲染这一份
    // （挂在 `App.svelte` 根上）。见 `src/features/toast.svelte.ts` 的说明。
</script>

<div
    class={cn(
        "pointer-events-none fixed top-4 right-4 z-(--z-toast) transition-all will-change-transform",
        toastStore.visible
            ? "opacity-100 translate-y-0 duration-500 ease-spring"
            : "opacity-0 -translate-y-3 scale-[0.97] duration-200 ease-spring-out",
    )}
    role="status"
    aria-live="polite"
    onmouseenter={() => toastStore.hold()}
    onmouseleave={() => toastStore.release()}
>
    {#if toastStore.current}
        <AlertUI.Root
            variant={toastStore.current.variant === "destructive"
                ? "destructive"
                : "default"}
            class="pointer-events-auto bg-popover ring-foreground/10 max-w-xs shadow-lg ring-1"
        >
            {#if toastStore.current.variant === "success"}
                <IconCheck class="text-success" />
            {:else if toastStore.current.variant === "destructive"}
                <IconAlertTriangle />
            {:else}
                <IconInfoCircle class="text-muted-foreground" />
            {/if}
            <AlertUI.Title>{toastStore.current.title}</AlertUI.Title>
            {#if toastStore.current.description}
                <AlertUI.Description>{toastStore.current
                    .description}</AlertUI.Description>
            {/if}
        </AlertUI.Root>
    {/if}
</div>
