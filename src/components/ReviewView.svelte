<script lang="ts">
    import type { Question, QuestionType } from "../types";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Switch } from "$lib/components/ui/switch";
    import { Label } from "$lib/components/ui/label";
    import {
        QUESTION_TYPES,
        QUESTION_TYPE_ORDER,
    } from "../quiz/types/registry";
    import { useQuizSession } from "../quiz/session/context";

    interface Props {
        open: boolean;
        onOpenChange: (open: boolean) => void;
    }

    let { open, onOpenChange }: Props = $props();

    const session = useQuizSession();

    let showUnmasteredOnly = $state(false);

    const masteredSet = $derived(new Set(session.appState.masteredIds));

    let filteredQuestions = $derived.by(() => {
        const filterType = session.appState.filterType;
        const byType =
            filterType === "all"
                ? session.questions
                : session.questions.filter((q) => q.type === filterType);
        return showUnmasteredOnly
            ? byType.filter((q) => !masteredSet.has(q.id))
            : byType;
    });

    let grouped = $derived.by(() => {
        const filterType = session.appState.filterType;
        if (filterType !== "all") {
            return [{ type: filterType as QuestionType, items: filteredQuestions }];
        }
        return QUESTION_TYPE_ORDER.map((type) => ({
            type,
            items: filteredQuestions.filter((q: Question) => q.type === type),
        })).filter((g) => g.items.length > 0);
    });
</script>

<Dialog.Root bind:open {onOpenChange}>
    <Dialog.Content
        class="bg-card flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
    >
        <Dialog.Header
            class="flex flex-row items-center justify-between gap-3 border-b px-5 py-3"
        >
            <div class="flex items-center gap-2">
                <Dialog.Title class="text-base font-semibold"
                    >答案预览</Dialog.Title
                >
                <span
                    class="text-muted-foreground bg-muted rounded-full px-2 py-0.5 text-xs tabular-nums"
                >
                    {filteredQuestions.length}
                </span>
            </div>
            <div class="mr-7 flex items-center gap-2">
                <Switch
                    id="unmastered-only"
                    bind:checked={showUnmasteredOnly}
                    size="sm"
                />
                <Label
                    for="unmastered-only"
                    class="text-muted-foreground text-xs"
                >
                    仅看未掌握
                </Label>
            </div>
        </Dialog.Header>

        <div class="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
            {#each grouped as group (group.type)}
                {@const Icon = QUESTION_TYPES[group.type].icon}
                <div class="flex flex-col gap-2">
                    <div
                        class="bg-card sticky -top-4 z-10 flex items-center gap-2 py-1.5"
                    >
                        <Icon
                            size={14}
                            stroke={1.75}
                            class="text-muted-foreground"
                        />
                        <span class="text-xs font-medium tracking-wide">
                            {QUESTION_TYPES[group.type].name}
                        </span>
                        <span
                            class="text-muted-foreground text-xs tabular-nums"
                        >
                            {group.items.length}
                        </span>
                    </div>

                    {#each group.items as question}
                        {@const ReviewComponent =
                            QUESTION_TYPES[question.type].Review}
                        <div
                            class="border-border/60 bg-muted/40 flex flex-col gap-2 rounded-lg border px-4 py-3"
                        >
                            <div class="flex gap-2">
                                <span
                                    class="text-foreground flex-1 text-sm leading-relaxed font-medium whitespace-pre-wrap"
                                >
                                    {question.question}
                                </span>
                                <span
                                    class="text-muted-foreground pt-0.5 text-xs font-mono"
                                >
                                    {question.id}
                                </span>
                            </div>

                            <ReviewComponent {question} />
                        </div>
                    {/each}
                </div>
            {/each}

            {#if filteredQuestions.length === 0}
                <div
                    class="text-muted-foreground flex flex-1 items-center justify-center text-sm"
                >
                    当前筛选条件下没有题目
                </div>
            {/if}
        </div>
    </Dialog.Content>
</Dialog.Root>
