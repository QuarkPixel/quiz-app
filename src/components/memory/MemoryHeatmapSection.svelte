<script lang="ts">
    import { useMemorySession } from "@/features/memory/context";
    import { reviewProgress } from "@/features/memory/algorithm";
    import type { MemoryProgress } from "@/types";
    import SharedHeatmapSection, {
        type HeatmapCell,
    } from "@/components/shared/HeatmapSection.svelte";

    /**
     * 记忆模式的卡片热力图。
     *
     * 只有「状态 → 颜色」这一段是本模式自己的：
     *   未学习 / 学习中 → 灰色（`bg-foreground/15`）
     *   复习中         → 橙色 → 绿色按复习进度插值（复习到第几级 / 掌握阈值）
     *   已掌握         → 绿色（`bg-success`）
     * 折叠、网格、悬浮提示、无障碍标签都在 `components/shared/HeatmapSection.svelte`。
     */
    interface Props {
        onJump?: (id: string) => void;
    }

    let { onJump }: Props = $props();

    const session = useMemorySession();

    const threshold = $derived(Math.max(1, session.memorySettings.graduateLevel));

    /**
     * 复习中的橙色 → 绿色插值。进度直接用算法的 `reviewProgress`
     * （`(level - 1) / threshold`），别在 UI 里再抄一份公式。
     */
    function reviewColor(item: MemoryProgress): string {
        const t = reviewProgress(item, threshold);
        return `color-mix(in oklab, var(--success) ${(t * 100).toFixed(1)}%, var(--warning))`;
    }

    function describe(item: MemoryProgress | undefined): string {
        if (!item) return "未学习";
        if (item.state === "mastered") return "已掌握";
        if (item.state === "learning") return "学习中";
        return `复习中 ${item.level - 1}/${threshold}`;
    }

    /** 传函数而不是数组：外壳收起时不必为每一道卡查一遍进度 */
    function cells(expanded: boolean): HeatmapCell[] {
        if (!expanded) return [];

        return session.questions.map((question) => {
            const item = session.progress[question.id];

            // 未学习与学习中共用灰色
            if (!item || item.state === "learning") {
                return {
                    id: question.id,
                    status: describe(item),
                    className: "bg-foreground/15",
                };
            }

            if (item.state === "mastered") {
                return {
                    id: question.id,
                    status: describe(item),
                    className: "bg-success",
                };
            }

            return {
                id: question.id,
                status: describe(item),
                style: `background-color: ${reviewColor(item)}`,
            };
        });
    }
</script>

<SharedHeatmapSection title="卡片热力图" {cells} {onJump} />
