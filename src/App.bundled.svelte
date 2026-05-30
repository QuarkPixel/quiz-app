<script lang="ts">
    import "./app.css";

    import QuizView from "./components/QuizView.svelte";
    import * as Tooltip from "$lib/components/ui/tooltip";

    import { createSource } from "./source";

    // @ts-ignore
    import faviconRaw from "../icons/icon.svg?raw";
    // @ts-ignore
    import logoRaw from "../icons/logo.svg?raw";

    const faviconUrl = `data:image/svg+xml,${encodeURIComponent(faviconRaw)}`;
    const bank = createSource().getActiveBank();
</script>

<svelte:head>
    <link rel="icon" type="image/svg+xml" href={faviconUrl} />
</svelte:head>

<Tooltip.Provider delayDuration={0}>
    <div class="flex h-full flex-col">
        <header class="flex items-center gap-3 px-5 py-5 sm:px-8 sm:py-6">
            <span class="size-8" aria-hidden="true"></span>
            <div
                class="text-muted-foreground mx-auto [&_svg]:h-4 [&_svg]:w-auto"
                aria-label="Quiz! aPP."
            >
                {@html logoRaw}
            </div>
            <span class="size-8" aria-hidden="true"></span>
        </header>

        {#if bank}
            <QuizView {bank} />
        {/if}
    </div>
</Tooltip.Provider>
