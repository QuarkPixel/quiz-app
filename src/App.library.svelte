<script lang="ts">
    import { onMount } from "svelte";
    import "./app.css";

    import QuizView from "./components/QuizView.svelte";
    import Sidebar from "./components/Sidebar.svelte";
    import HeaderSidebarTrigger from "./components/HeaderSidebarTrigger.svelte";
    import * as SidebarUI from "$lib/components/ui/sidebar";

    import { createSource } from "./source";
    import type { Bank } from "./source/types";

    // @ts-ignore
    import favicon from "../assets/icons/icon.svg";
    // @ts-ignore
    import logoRaw from "../assets/icons/logo.svg?raw";

    const source = createSource();

    let activeBank = $state<Bank | null>(source.getActiveBank());

    onMount(() =>
        source.subscribe(() => {
            activeBank = source.getActiveBank();
        }),
    );
</script>

<svelte:head>
    <link rel="icon" type="image/svg+xml" href={favicon} />
</svelte:head>

{#snippet contentBody()}
    <header class="flex items-center gap-3 px-5 py-5 sm:px-8 sm:py-6">
        <HeaderSidebarTrigger />
        <div
            class="text-muted-foreground mx-auto [&_svg]:h-4 [&_svg]:w-auto"
            aria-label="Quiz! aPP."
        >
            {@html logoRaw}
        </div>
        <span class="size-8" aria-hidden="true"></span>
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
                    点击左侧栏「题库」分组右上角的导入按钮，从一个 JSON
                    文件开始。
                </p>
            </div>
        </main>
    {/if}
{/snippet}

<SidebarUI.Provider open={false}>
    <Sidebar {source} />
    <SidebarUI.Inset>
        {@render contentBody()}
    </SidebarUI.Inset>
</SidebarUI.Provider>
