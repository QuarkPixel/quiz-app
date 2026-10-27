import type { QuizSession } from "@/quiz/session/QuizSession.svelte";
import type { HeatmapCell } from "@/features/overview/types";
import {
    getLearningLevelColor,
    getMaxLearningLevel,
    getRemainingCorrectLevel,
} from "./learningProgress";

/**
 * 刷题模式总览的视图模型：热力图格子的颜色。
 *
 * 从 `ReviewView.svelte` 里搬出来的纯计算——组件只负责排版，算数在这里，
 * 也方便单测。记忆模式有一份同构的 `features/memory/overview.ts`。
 *
 * 三张统计卡**不在这里**：它们的 DOM 由 `QuizOverview.svelte` 自己写
 * （版式太定制，抽成数据再套模板会走形）。
 */

export function quizHeatmapCells(session: QuizSession): HeatmapCell[] {
    const masteredSet = new Set(session.appState.masteredIds);
    const activePoolById = new Map(
        session.appState.activePool.map((item) => [item.id, item]),
    );
    const masteredMistakes = session.appState.masteredMistakes ?? {};
    const maxLearningLevel = getMaxLearningLevel(session.appState);

    return session.questions.map((question) => {
        const activeItem = activePoolById.get(question.id);

        if (masteredSet.has(question.id)) {
            const mistaken = masteredMistakes[question.id] === true;
            return {
                id: question.id,
                status: mistaken ? "已掌握，曾答错" : "已掌握",
                className: mistaken ? "bg-destructive" : "bg-success",
            };
        }

        if (activeItem?.hasBeenShown) {
            const level = getRemainingCorrectLevel(activeItem, session.appState);
            return {
                id: question.id,
                status: `还需 ${level} 次答对`,
                color: getLearningLevelColor(
                    level,
                    maxLearningLevel,
                    activeItem.hasEverMistaken,
                ),
            };
        }

        return {
            id: question.id,
            status: "还没有刷到",
            className: "bg-foreground/15",
        };
    });
}
