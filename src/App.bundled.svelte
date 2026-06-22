<script lang="ts">
    import "./app.css";

    import QuizView from "./components/quiz/QuizView.svelte";
    import AppShell from "./components/layout/AppShell.svelte";
    import * as Tooltip from "$lib/components/ui/tooltip";

    import { createSource } from "./source";
    import { provideQuizSource } from "./source/context";

    const source = createSource();
    provideQuizSource(source);
    const bank = source.getActiveBank();
</script>

<Tooltip.Provider delayDuration={0}>
    <AppShell>
        {#if bank}
            <QuizView {bank} />
        {/if}
    </AppShell>
</Tooltip.Provider>
