<script lang="ts">
    import type { QuestionOrder } from "../types";
    import * as ToggleGroup from "$lib/components/ui/toggle-group";
    import IconShuffle from "@tabler/icons-svelte/icons/arrows-shuffle";
    import IconArrowsRight from "@tabler/icons-svelte/icons/arrow-narrow-right";

    interface Props {
        activeOrder: "random" | "sequential";
        onSelect: (type: QuestionOrder) => void;
    }

    let { activeOrder, onSelect }: Props = $props();

    // 单选筛选必须恒有一个选中项。bits-ui 单选模式允许点击已选项取消选择
    // （onValueChange 收到空串）；取消后因外部 activeType 未变不会回灌，视觉上会
    // 变成「全部未选中」。故用本地受控值，收到空串时强制回到 activeType 拒绝取消。
    // 初值仅作种子，后续由下面的 $effect 跟随 activeType 同步。
    // svelte-ignore state_referenced_locally
    let selected = $state<QuestionOrder>(activeOrder);
    $effect(() => {
        selected = activeOrder;
    });

    function handleChange(v: string) {
        if (!v) {
            selected = activeOrder; // 拒绝取消选择
            return;
        }
        onSelect(v as QuestionOrder);
    }
</script>

<ToggleGroup.Root
    type="single"
    bind:value={selected}
    onValueChange={handleChange}
    variant="outline"
    size="sm"
    class="w-full gap-1.5"
>
    <ToggleGroup.Item
        value="random"
        aria-label="随机刷题"
        class="flex-1 gap-1.5"
    >
        <IconShuffle size={14} stroke={1.75} />
        <span class="text-xs">随机</span>
    </ToggleGroup.Item>
    <ToggleGroup.Item
        value="sequential"
        aria-label="顺序刷题"
        class="flex-1 gap-1.5"
    >
        <IconArrowsRight size={14} stroke={1.75} />
        <span class="text-xs">顺序</span>
    </ToggleGroup.Item>
</ToggleGroup.Root>
