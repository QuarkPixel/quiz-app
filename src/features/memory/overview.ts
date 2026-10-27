import type { MemorySession } from "@/features/memory/MemorySession.svelte";
import type { MemoryProgress } from "@/types";
import type { HeatmapCell } from "@/features/overview/types";
import { reviewProgress } from "./algorithm";
import { memoryStatusLabel } from "./status";

/**
 * 记忆模式总览的视图模型：热力图格子的颜色。
 *
 * 与刷题模式那份（`features/quiz/overview.ts`）同构——外壳是同一个
 * `OverviewDialog`，差别只在这个函数的算法。
 *
 * 三张统计卡**不在这里**：它们的 DOM 在 `components/memory/MemoryStatsCards.svelte`。
 */


export function memoryHeatmapCells(session: MemorySession): HeatmapCell[] {
    const threshold = Math.max(1, session.memorySettings.graduateLevel);

    /**
     * 复习中的橙色 → 绿色插值。进度直接用算法的 `reviewProgress`
     * （`(level - 1) / threshold`），别在 UI 里再抄一份公式。
     */
    function reviewColor(item: MemoryProgress): string {
        const t = reviewProgress(item, threshold);
        return `color-mix(in oklab, var(--success) ${(t * 100).toFixed(1)}%, var(--warning))`;
    }

    function describe(item: MemoryProgress | undefined): string {
        if (!item || item.state !== "reviewing") return memoryStatusLabel(item);
        return `复习中 ${item.level - 1}/${threshold}`;
    }

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
            color: reviewColor(item),
        };
    });
}
