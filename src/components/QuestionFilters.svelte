<script lang="ts">
    import type { QuestionType } from "../types";
    import type { FilterOption } from "../features/quiz/filters";
    import * as ToggleGroup from "$lib/components/ui/toggle-group";
    import IconAsterisk from "@tabler/icons-svelte/icons/asterisk";
    import { QUESTION_TYPES } from "../quiz/types/registry";

    interface Props {
        options: FilterOption[];
        activeType: QuestionType | "all";
        onSelect: (type: QuestionType | "all") => void;
    }

    let { options, activeType, onSelect }: Props = $props();

    function iconFor(key: QuestionType | "all") {
        return key === "all" ? IconAsterisk : QUESTION_TYPES[key].icon;
    }

    let allOption = $derived(options.find((o) => o.key === "all"));
    let typeOptions = $derived(options.filter((o) => o.key !== "all"));

    function handleChange(v: string) {
        // 不允许取消选择：v 为空说明用户点了已选项，保持原值
        if (!v) return;
        onSelect(v as QuestionType | "all");
    }
</script>

<div class="flex flex-col gap-2">
    {#if allOption}
        <ToggleGroup.Root
            type="single"
            value={activeType}
            onValueChange={handleChange}
            variant="outline"
            size="sm"
            class="w-full"
        >
            {@const Icon = iconFor(allOption.key)}
            <ToggleGroup.Item
                value={allOption.key}
                aria-label={allOption.label}
                class="w-full gap-1.5"
            >
                <Icon size={14} stroke={1.75} />
                <span class="text-xs">{allOption.label}</span>
            </ToggleGroup.Item>
        </ToggleGroup.Root>
    {/if}

    {#if typeOptions.length > 0}
        <ToggleGroup.Root
            type="single"
            value={activeType}
            onValueChange={handleChange}
            variant="outline"
            size="sm"
            class="grid w-full gap-1"
            style="grid-template-columns: repeat({Math.min(
                typeOptions.length,
                4,
            )}, minmax(0, 1fr))"
        >
            {#each typeOptions as option (option.key)}
                {@const Icon = iconFor(option.key)}
                <ToggleGroup.Item
                    value={option.key}
                    aria-label={option.label}
                    class="w-full gap-1.5"
                >
                    <Icon size={14} stroke={1.75} />
                    <span class="text-xs">{option.label}</span>
                </ToggleGroup.Item>
            {/each}
        </ToggleGroup.Root>
    {/if}
</div>
