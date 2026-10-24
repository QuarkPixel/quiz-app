<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import { useMemorySession } from "@/features/memory/context";
    import {
        MEMORY_ANSWER_CODE,
        memoryAnswerDowngrades,
        type MemoryAnswerKind,
    } from "@/quiz/types/memory/logic";
    import IconCheck from "@tabler/icons-svelte/icons/check";
    import IconX from "@tabler/icons-svelte/icons/x";
    import IconCircleHalf2 from "@tabler/icons-svelte/icons/circle-half-2";

    /**
     * 记忆模式底部固定区的操作行。
     *
     * 题干页：忘记 / 模糊 / 知道（点任意一个只做两件事：题干回到常规字号、展示答案）
     * 答案页：按刚选的那一档给出「降级」入口（见 `memoryAnswerDowngrades`）——
     *   知道 → 记错了 / 模糊 / 下一题；模糊 → 记错了 / 下一题；忘记 → 只有下一题。
     *
     * 它钉在底部（不跟着题面滚），所以「下一题」永远在拇指够得着的地方。
     */
    const session = useMemorySession();

    const downgrades = $derived(memoryAnswerDowngrades(session.answerKind));

    function pick(kind: MemoryAnswerKind): void {
        if (session.showResult) return;
        session.selectedAnswers = [MEMORY_ANSWER_CODE[kind]];
        session.submit();
    }
</script>

<!-- 最多会同时出现三个按钮（记错了 / 模糊 / 下一题），所以窄屏用更小的
     内边距，并允许换行兜底，免得在 320px 宽的手机上溢出 -->
<div class="flex min-h-11 flex-wrap items-center justify-end gap-2">
    {#if !session.showResult}
        <Button
            variant="outline"
            size="lg"
            class="px-5 sm:px-8"
            onclick={() => pick("forget")}
        >
            <IconX size={16} stroke={2} />
            忘记
        </Button>
        <Button
            variant="outline"
            size="lg"
            class="px-5 sm:px-8"
            onclick={() => pick("fuzzy")}
        >
            <IconCircleHalf2 size={16} stroke={2} />
            模糊
        </Button>
        <Button size="lg" class="px-5 sm:px-8" onclick={() => pick("know")}>
            <IconCheck size={16} stroke={2} />
            知道
        </Button>
    {:else}
        {#if downgrades.wrong}
            <!-- 反悔入口（一步到位、不叠加）：知道 / 模糊 → 记错了 -->
            <Button
                variant="outline"
                size="icon-lg"
                onclick={() => session.markAsWrong()}
                title="记错了"
            >
                <IconX size={16} stroke={2} />
            </Button>
        {/if}
        {#if downgrades.fuzzy}
            <!-- 刚选了「知道」才给这一档：其实只是模糊 -->
            <Button
                variant="outline"
                size="icon-lg"
                onclick={() => session.markAsFuzzy()}
                title="模糊"
            >
                <IconCircleHalf2 size={16} stroke={2} />
            </Button>
        {/if}
        <Button
            size="lg"
            class="px-5 sm:px-8"
            onclick={() => session.advanceQuestionFlow()}
        >
            下一题
        </Button>
    {/if}
</div>
