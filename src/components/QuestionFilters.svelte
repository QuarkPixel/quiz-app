<script lang="ts">
    import type { QuestionType } from "../types";
    import type { FilterOption } from "../features/quiz/filters";

    interface Props {
        options: FilterOption[];
        activeType: QuestionType | "all";
        onSelect: (type: QuestionType | "all") => void;
    }

    let { options, activeType, onSelect }: Props = $props();
</script>

<div class="filters">
    {#each options as option}
        <button
            class:active={activeType === option.key}
            onclick={() => onSelect(option.key)}
        >
            {option.label}
        </button>
    {/each}
</div>
