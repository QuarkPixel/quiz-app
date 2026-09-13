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
    import IconBooks from "@tabler/icons-svelte/icons/books";

    const source = createSource();
    provideQuizSource(source);

    let activeBank = $state<Bank | null>(source.getActiveBank());

    onMount(() =>
        source.subscribe(() => {
            activeBank = source.getActiveBank();
        }),
    );

    // 按题库模式收窄：quiz 走完整答题流；recite 是预留分支。
    const quizBank = $derived(activeBank?.mode === "quiz" ? activeBank : null);
    const reciteBank = $derived(
        activeBank?.mode === "recite" ? activeBank : null,
    );
</script>

{#snippet headerStart()}
    <HeaderSidebarTrigger />
{/snippet}

{#snippet contentBody()}
    <AppShell {headerStart}>
        {#if quizBank}
            {#key quizBank.hash}
                <QuizView bank={quizBank} />
            {/key}
        {:else if reciteBank}
            <!-- 背诵模式入口预留：实现后替换为 ReciteView -->
            <main class="flex flex-1 flex-col items-center justify-center px-6">
                <div class="flex max-w-md flex-col items-center gap-4 text-center">
                    <IconBooks size={64} class="text-muted-foreground" />
                    <p class="text-foreground text-lg font-medium">
                        「{reciteBank.name}」是背诵模式题库
                    </p>
                    <p class="text-muted-foreground text-sm leading-relaxed">
                        背诵模式尚未实现，敬请期待。
                    </p>
                </div>
            </main>
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
