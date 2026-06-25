<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button } from "$lib/components/ui/button";
    import QuestionPreview from "./QuestionPreview.svelte";
    import { useQuizSession } from "@/quiz/session/context";

    const session = useQuizSession();
</script>

<Dialog.Root
    open={session.currentNewQuestion !== null}
    onOpenChange={(open) => {
        if (!open) session.dismissNewQuestion();
    }}
>
    <Dialog.Content class="">
        {#if session.currentNewQuestion}
            {@const question = session.currentNewQuestion}
            <Dialog.Header>
                <Dialog.Title>新题入池</Dialog.Title>
            </Dialog.Header>
            {#snippet preview()}
                <span class="font-mono text-xs text-foreground/40">
                    {question.id}
                </span>
            {/snippet}
            <QuestionPreview {question} trailing={preview}/>
            <Dialog.Footer>
                <Button onclick={() => session.dismissNewQuestion()}>
                    了解
                </Button>
            </Dialog.Footer>
        {/if}
    </Dialog.Content>
</Dialog.Root>
