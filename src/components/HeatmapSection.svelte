<script lang="ts">
    import { cn } from "$lib/utils";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { useQuizSession } from "../quiz/session/context";
    import {
        getLearningLevelColor,
        getMaxLearningLevel,
        getRemainingCorrectLevel,
    } from "../features/quiz/learningProgress";
    import IconAccessPoint from "@tabler/icons-svelte/icons/access-point";
    import IconChevronDown from "@tabler/icons-svelte/icons/chevron-down";

    interface Props {
        onJump: (id: string) => void;
    }

    let { onJump }: Props = $props();

    const session = useQuizSession();

    let expanded = $state(false);

    const masteredSet = $derived(new Set(session.appState.masteredIds));
    const activePoolById = $derived(
        new Map(session.appState.activePool.map((item) => [item.id, item])),
    );
    const masteredMistakes = $derived(session.appState.masteredMistakes ?? {});
    const maxLearningLevel = $derived(getMaxLearningLevel(session.appState));

    const cells = $derived.by(() =>
        session.questions.map((question) => {
            const activeItem = activePoolById.get(question.id);

            if (masteredSet.has(question.id)) {
                const mistaken = masteredMistakes[question.id] === true;
                return {
                    id: question.id,
                    status: mistaken ? "已掌握，曾答错" : "已掌握",
                    className: mistaken ? "bg-destructive" : "bg-success",
                    style: "",
                };
            }

            if (activeItem?.hasBeenShown) {
                const level = getRemainingCorrectLevel(
                    activeItem,
                    session.appState,
                );
                return {
                    id: question.id,
                    status: `还需 ${level} 次答对`,
                    className: "",
                    style: `background-color: ${getLearningLevelColor(
                        level,
                        maxLearningLevel,
                    )}`,
                };
            }

            return {
                id: question.id,
                status: "还没有刷到",
                className: "bg-foreground/15",
                style: "",
            };
        }),
    );
</script>

<div class="flex flex-col gap-2">
    <button
        type="button"
        onclick={() => (expanded = !expanded)}
        aria-expanded={expanded}
        class="group -mx-3 flex items-center gap-2 rounded-md px-3 py-1.5 hover:bg-muted"
    >
        <IconAccessPoint
            size={16}
            stroke={1.75}
            class="text-muted-foreground shrink-0"
        />
        <span class="shrink-0 text-sm font-medium">答题热力图</span>
        <span class="dotted-leader text-muted-foreground/40 flex-1"></span>
        <IconChevronDown
            size={16}
            stroke={1.75}
            class={cn(
                "text-muted-foreground shrink-0 transition-transform duration-200",
                expanded && "rotate-180",
            )}
        />
    </button>

    <div class="heatmap-collapsible" class:expanded>
        <div class="heatmap-collapsible-inner">
            <div
                class="max-h-56 overflow-y-auto rounded-md border bg-muted/20 p-3"
            >
                <div class="heatmap-grid grid gap-1">
                    {#each cells as cell (cell.id)}
                        <Tooltip.Root>
                            <Tooltip.Trigger>
                                {#snippet child({ props })}
                                    <button
                                        {...props}
                                        type="button"
                                        class={cn(
                                            "block size-3 rounded-[3px] border-0 bg-transparent p-0 transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
                                            cell.className,
                                        )}
                                        style={cell.style}
                                        aria-label={`${cell.id}：${cell.status}`}
                                        onclick={() => onJump(cell.id)}
                                    ></button>
                                {/snippet}
                            </Tooltip.Trigger>
                            <Tooltip.Content side="top">
                                <span class="font-mono">{cell.id}</span>
                            </Tooltip.Content>
                        </Tooltip.Root>
                    {/each}
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    .heatmap-grid {
        grid-template-columns: repeat(auto-fill, 0.75rem);
    }
    .heatmap-collapsible {
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.2s ease;
    }
    .heatmap-collapsible.expanded {
        grid-template-rows: 1fr;
    }
    .heatmap-collapsible-inner {
        overflow: hidden;
    }
    .dotted-leader {
        height: 4px;
        align-self: center;
        background-image: radial-gradient(
            circle,
            currentColor 1px,
            transparent 1.4px
        );
        background-size: 6px 4px;
        background-position: center;
        background-repeat: repeat-x;
    }
</style>
