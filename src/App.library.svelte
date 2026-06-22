<script lang="ts">
    import { onMount } from "svelte";
    import "./app.css";

    import QuizView from "./components/quiz/QuizView.svelte";
    import AppShell from "./components/layout/AppShell.svelte";
    import Sidebar from "./components/layout/Sidebar.svelte";
    import HeaderSidebarTrigger from "./components/layout/HeaderSidebarTrigger.svelte";
    import * as SidebarUI from "$lib/components/ui/sidebar";

    import { createSource } from "./source";
    import { provideQuizSource } from "./source/context";
    import type { Bank } from "./source/types";
    import { IconFishBoneFilled } from "@tabler/icons-svelte";

    const source = createSource();
    provideQuizSource(source);

    let activeBank = $state<Bank | null>(source.getActiveBank());

    onMount(() =>
        source.subscribe(() => {
            activeBank = source.getActiveBank();
        }),
    );
</script>

{#snippet headerStart()}
    <HeaderSidebarTrigger />
{/snippet}

{#snippet contentBody()}
    <AppShell {headerStart}>
        {#if activeBank}
            {#key activeBank.hash}
                <QuizView bank={activeBank} persistDefaultSettings={true} />
            {/key}
        {:else}
            <main class="flex flex-1 flex-col items-center justify-center px-6">
                <div class="flex max-w-md flex-col items-center gap-4 text-center">
                    <IconFishBoneFilled
                        size={64}
                        class="text-muted-foreground"
                    />
                    <p class="text-foreground text-lg font-medium">还没有题库</p>
                    <p class="text-muted-foreground text-sm leading-relaxed">
                        点击左侧栏「题库」分组右上角的导入按钮，从 JSON 文件开始。
                    </p>
                </div>
            </main>
        {/if}
    </AppShell>
{/snippet}

<SidebarUI.Provider open={false}>
    <Sidebar {source} />
    <SidebarUI.Inset>
        {@render contentBody()}
    </SidebarUI.Inset>
</SidebarUI.Provider>
