<script lang="ts">
    import { useMemorySession } from "@/features/memory/context";
    import * as Card from "$lib/components/ui/card";
    import IconProgressCheck from "@tabler/icons-svelte/icons/progress-check";
    import IconTargetArrow from "@tabler/icons-svelte/icons/target-arrow";
    import IconRepeat from "@tabler/icons-svelte/icons/repeat";

    /**
     * 首页与总览共用的三张统计卡。
     *
     * 版式与刷题模式总览顶部那三张完全一致（同一套 Card 结构、同样的
     * 「大字号数字 + 小字说明 + 右上角水印图标」）：
     *
     *   1. 未学习 / 学习中 / 已掌握
     *   2. 今日待复习
     *   3. 目前
     */
    const session = useMemorySession();

    const total = $derived(session.questions.length);
    /** 学过一轮、还没走完掌握阶梯的卡片数量 */
    const inProgress = $derived(session.reviewingCount + session.learningCount);
</script>

<div
    class="grid grid-cols-1 gap-3 sm:grid-cols-3 *:rounded-md *:bg-foreground/5"
>
    <Card.Root size="sm">
        <Card.Content class="flex flex-col gap-1 relative">
            <IconProgressCheck
                size={96}
                class="absolute sm:top-1 sm:-right-3 -top-3 right-0 text-muted-foreground opacity-20 -z-1"
            />
            <span class="text-muted-foreground text-xs">
                未学习 / 学习中 / 复习中 / 已掌握
            </span>
            <!-- 四个数字与分隔斜杠都放进同一套 span 规则里（`*:font-mono`），
                 斜杠用更淡的 foreground 色，和刷题模式的行内多数字写法一致。
                 四类都要显示：少了「学习中」，三个数字就加不出下面的总数 -->
            <span
                class="*:font-mono text-xl font-semibold tabular-nums text-foreground/10 sm:text-2xl"
            >
                <span class="text-foreground/40">{session.newCount}</span
                >&thinsp;/&thinsp;<span class="text-warning"
                    >{session.learningCount}</span
                >&thinsp;/&thinsp;<span class="text-foreground/60"
                    >{session.reviewingCount}</span
                >&thinsp;/&thinsp;<span class="text-success"
                    >{session.masteredCount}</span
                >
            </span>
            <span class="text-muted-foreground text-xs tabular-nums">
                共 {total} 张卡片
            </span>
        </Card.Content>
    </Card.Root>

    <Card.Root size="sm">
        <Card.Content class="flex flex-col gap-1 relative">
            <IconTargetArrow
                size={96}
                class="absolute sm:bottom-1 sm:right-0 -bottom-3 right-0 text-muted-foreground opacity-20 -z-1"
            />
            <span class="text-muted-foreground text-xs">今日待复习</span>
            <span
                class="font-mono text-2xl font-semibold tabular-nums text-foreground/60"
                style:color={session.reviewableCount > 0
                    ? "var(--warning)"
                    : undefined}
            >
                {session.reviewableCount}
            </span>
            <span class="text-muted-foreground text-xs tabular-nums">
                到期的 + 答错后要补连对的
            </span>
        </Card.Content>
    </Card.Root>

    <Card.Root size="sm">
        <Card.Content class="flex flex-col gap-1 relative">
            <IconRepeat
                size={96}
                class="absolute sm:-bottom-12 sm:-right-5 -bottom-3 right-0 text-muted-foreground opacity-20 -z-1"
            />
            <span class="text-muted-foreground text-xs">目前</span>
            <span
                class="font-mono text-2xl font-semibold tabular-nums text-foreground/60"
            >
                {inProgress}
            </span>
            <span class="text-muted-foreground text-xs tabular-nums">
                正在复习 {session.reviewingCount} 张
            </span>
        </Card.Content>
    </Card.Root>
</div>
