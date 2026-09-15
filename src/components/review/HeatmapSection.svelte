<script lang="ts">
    import { useQuizSession } from "@/quiz/session/context";
    import {
        getLearningLevelColor,
        getMaxLearningLevel,
        getRemainingCorrectLevel,
    } from "@/features/quiz/learningProgress";
    import SharedHeatmapSection, {
        type HeatmapCell,
    } from "@/components/shared/HeatmapSection.svelte";

    /**
     * 刷题模式的答题热力图。
     *
     * 只有「状态 → 颜色」这一段是本模式自己的（已掌握 / 曾答错 / 还需几次答对 /
     * 还没刷到）；折叠、网格、悬浮提示、无障碍标签都在
     * `components/shared/HeatmapSection.svelte` 那一份外壳里。
     */
    interface Props {
        onJump: (id: string) => void;
    }

    let { onJump }: Props = $props();

    const session = useQuizSession();

    const masteredSet = $derived(new Set(session.appState.masteredIds));
    const activePoolById = $derived(
        new Map(session.appState.activePool.map((item) => [item.id, item])),
    );
    const masteredMistakes = $derived(session.appState.masteredMistakes ?? {});
    const maxLearningLevel = $derived(getMaxLearningLevel(session.appState));

    /** 传函数而不是数组：外壳收起时不必为每一道题查一遍进度 */
    function cells(expanded: boolean): HeatmapCell[] {
        if (!expanded) return [];

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
                const level = getRemainingCorrectLevel(
                    activeItem,
                    session.appState,
                );
                return {
                    id: question.id,
                    status: `还需 ${level} 次答对`,
                    style: `background-color: ${getLearningLevelColor(
                        level,
                        maxLearningLevel,
                        activeItem?.hasEverMistaken,
                    )}`,
                };
            }

            return {
                id: question.id,
                status: "还没有刷到",
                className: "bg-foreground/15",
            };
        });
    }
</script>

<SharedHeatmapSection title="答题热力图" {cells} {onJump} />
