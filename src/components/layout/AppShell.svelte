<script lang="ts">
    import type { Snippet } from "svelte";

    // @ts-ignore
    import logoRaw from "/assets/icons/logo.svg?raw";

    interface Props {
        headerStart?: Snippet;
        children?: Snippet;
    }

    let { headerStart, children }: Props = $props();

    function forwardWheelToMainScroll(event: WheelEvent): void {
        const viewport = document.querySelector<HTMLElement>(
            '[data-main-scroll-viewport="true"]',
        );
        if (!viewport) return;
        if (event.deltaX === 0 && event.deltaY === 0) return;

        viewport.scrollBy({
            left: event.deltaX,
            top: event.deltaY,
            behavior: "auto",
        });
        event.preventDefault();
    }
</script>

<div
    class="app-shell relative h-full min-h-0 [--app-shell-content-top:calc(env(safe-area-inset-top)+6rem)] sm:[--app-shell-content-top:calc(env(safe-area-inset-top)+5.25rem)]"
>
    <header
        class="pointer-events-none absolute inset-x-0 top-0 z-20 px-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] sm:px-8 sm:pt-[calc(env(safe-area-inset-top)+1.5rem)]"
    >
        <div
            aria-hidden="true"
            class="app-shell-backdrop pointer-events-none absolute inset-x-0 top-0 h-26 bg-linear-to-b from-background via-background/96 to-background/0"
        ></div>

        <div
            class="pointer-events-auto relative grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-3 pb-5 sm:pb-6"
            onwheel={forwardWheelToMainScroll}
        >
            <div class="flex size-8 items-center justify-start">
                {@render headerStart?.()}
            </div>

            <div
                class="text-muted-foreground mx-auto [&_svg]:h-4 [&_svg]:w-auto"
                aria-label="Quiz! aPP."
            >
                {@html logoRaw}
            </div>

            <span class="size-8" aria-hidden="true"></span>
        </div>
    </header>

    <div class="flex h-full min-h-0 flex-col">
        {@render children?.()}
    </div>
</div>

<style>
    .app-shell-backdrop {
        opacity: 0;
        transition: opacity 200ms ease;
    }

    :global(
        .app-shell:has([data-shell-scrollable="true"]) .app-shell-backdrop
    ) {
        opacity: 1;
    }
</style>
