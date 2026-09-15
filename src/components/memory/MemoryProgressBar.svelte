<script lang="ts">
    import ProgressBar from "../quiz/ProgressBar.svelte";
    import type { Stats } from "@/types";
    import type { LearningSegment } from "@/features/quiz";

    /**
     * 记忆模式的本轮进度条。
     *
     * **直接复用刷题模式的 `ProgressBar`**（同一套数字滚动动画、同一套数字排版、
     * 同一条 3px 细条、完成时同一个「庆祝」高亮），这里只做两件事：
     *
     *   - 把「本轮已完成 / 本轮总数」映射成 ProgressBar 的 stats：已完成 →
     *     `mastered`（绿色），剩下的整段算 `learning`（灰色轨道）；
     *   - 关掉它的交互（记忆模式不做「聚焦放大」），并显式给出右侧数字——
     *     记忆模式的口径是**总数**，刷题模式的口径是「进度范围末端」。
     *
     * 以前这里是一份自己写的简化实现，于是数字不会滚动、完成时也没有反馈。
     */
    interface Props {
        /** 左侧数字：已完成数量 */
        done: number;
        /** 右侧数字：总数 */
        total: number;
        /** 中间的文案（默认显示百分比） */
        label?: string;
        /** 无障碍标签 */
        ariaLabel?: string;
    }

    let { done, total, label, ariaLabel = "进度" }: Props = $props();

    const safeTotal = $derived(Math.max(0, total));
    const safeDone = $derived(Math.min(Math.max(0, done), safeTotal));

    const stats = $derived<Stats>({
        mastered: safeDone,
        learning: safeTotal - safeDone,
        pending: 0,
        total: safeTotal,
    });

    /**
     * 剩余部分整体一段。
     *
     * 颜色与刷题模式的「待学习」段一致（`bg-foreground/15` 的等价 CSS 值）：
     * 这里要的是内联颜色，不能直接用 Tailwind 类。
     */
    const segments = $derived<LearningSegment[]>([
        {
            level: 1,
            widthPercent: 100,
            color: "color-mix(in oklab, var(--foreground) 15%, transparent)",
        },
    ]);
</script>

<ProgressBar
    {stats}
    learningSegments={segments}
    {label}
    {ariaLabel}
    rightValue={safeTotal}
    interactive={false}
/>
