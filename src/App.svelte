<script lang="ts">
    import { onMount } from "svelte";
    import "./app.css";

    import QuizView from "./components/QuizView.svelte";
    import Sidebar from "./components/Sidebar.svelte";
    import * as SidebarUI from "$lib/components/ui/sidebar";

    import { createSource } from "./source";
    import type { Bank } from "./source/types";

    // @ts-ignore
    import faviconRaw from "../icons/icon.svg?raw";
    // @ts-ignore
    import logoRaw from "../icons/logo.svg?raw";
    const faviconUrl = `data:image/svg+xml,${encodeURIComponent(faviconRaw)}`;

    const source = createSource();
    const isLibrary = source.mode === "library";

    let activeBank = $state<Bank | null>(source.getActiveBank());

    onMount(() =>
        source.subscribe(() => {
            activeBank = source.getActiveBank();
        }),
    );
</script>

<svelte:head>
    <link rel="icon" type="image/svg+xml" href={faviconUrl} />
</svelte:head>

{#snippet contentBody()}
    <header class="flex items-center gap-3 px-5 py-5 sm:px-8 sm:py-6">
        {#if isLibrary}
            <SidebarUI.Trigger class="-ml-1" />
        {/if}
        <div
            class="text-muted-foreground mx-auto [&_svg]:h-4 [&_svg]:w-auto"
            aria-label="Quiz! aPP."
        >
            {@html logoRaw}
        </div>
        {#if isLibrary}
            <span class="size-8" aria-hidden="true"></span>
        {/if}
    </header>

    {#if activeBank}
        {#key activeBank.hash}
            <QuizView bank={activeBank} />
        {/key}
    {:else}
        <main class="flex flex-1 flex-col items-center justify-center px-6">
            <div class="flex max-w-md flex-col items-center gap-4 text-center">
                <p class="text-foreground text-lg font-medium">还没有题库</p>
                <p class="text-muted-foreground text-sm leading-relaxed">
                    点击左侧栏「题库」分组右上角的上传按钮，从一个 JSON 文件开始。
                </p>
            </div>
        </main>
    {/if}
{/snippet}

{#if isLibrary}
    <SidebarUI.Provider>
        <Sidebar {source} />
        <SidebarUI.Inset>
            {@render contentBody()}
        </SidebarUI.Inset>
    </SidebarUI.Provider>
{:else}
    <div class="flex min-h-screen flex-col">
        {@render contentBody()}
    </div>
{/if}
