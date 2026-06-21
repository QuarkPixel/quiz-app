<script lang="ts">
    import type { QuestionType } from "@/types";
    import type { FilterOption } from "@/features/quiz/filters";
    import * as ToggleGroup from "$lib/components/ui/toggle-group";
    import IconAsterisk from "@tabler/icons-svelte/icons/asterisk";
    import { QUESTION_TYPES } from "@/quiz/types/registry";

    interface Props {
        options: FilterOption[];
        activeType: QuestionType | "all";
        onSelect: (type: QuestionType | "all") => boolean | void;
    }

    let { options, activeType, onSelect }: Props = $props();

    // 单选筛选必须恒有一个选中项。bits-ui 单选模式允许点击已选项取消选择
    // （onValueChange 收到空串）；取消后因外部 activeType 未变不会回灌，视觉上会
    // 变成「全部未选中」。故用本地受控值，收到空串时强制回到 activeType 拒绝取消。
    // 初值仅作种子，后续由下面的 $effect 跟随 activeType 同步。
    // svelte-ignore state_referenced_locally
    let selected = $state<QuestionType | "all">(activeType);
    $effect(() => {
        selected = activeType;
    });

    function iconFor(key: QuestionType | "all") {
        return key === "all" ? IconAsterisk : QUESTION_TYPES[key].icon;
    }

    let allOption = $derived(options.find((o) => o.key === "all"));
    let typeOptions = $derived(options.filter((o) => o.key !== "all"));

    function handleChange(v: string) {
        if (!v) {
            selected = activeType; // 拒绝取消选择
            return;
        }
        const accepted = onSelect(v as QuestionType | "all");
        if (accepted === false) {
            selected = activeType;
        }
    }
</script>

<div class="flex flex-col gap-2">
    {#if allOption}
        <ToggleGroup.Root
            type="single"
            bind:value={selected}
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
            bind:value={selected}
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
