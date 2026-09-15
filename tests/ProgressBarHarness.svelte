<script lang="ts">
    /**
     * `ProgressBar` 的测试外壳。
     *
     * 需要它是因为「已掌握数增加时庆祝一下」这件事必须**改 prop 再看 DOM**，
     * 而 `mount()` 之后没法直接改 props。Svelte 5 会把实例 script 里 `export`
     * 的函数挂到 `mount()` 的返回值上，正好用来驱动。
     */
    import ProgressBar from "@/components/quiz/ProgressBar.svelte";
    import type { Stats } from "@/types";
    import type { LearningSegment } from "@/features/quiz";

    interface Props {
        stats?: Stats;
        learningSegments?: LearningSegment[];
        focused?: boolean;
        label?: string;
        rightValue?: number;
        interactive?: boolean;
        ariaLabel?: string;
        onToggleFocus?: () => void;
    }

    let {
        stats = { mastered: 0, learning: 0, pending: 3, total: 3 },
        learningSegments = [],
        focused = false,
        label,
        rightValue,
        interactive = true,
        ariaLabel,
        onToggleFocus = () => {},
    }: Props = $props();

    /** 测试用：把已掌握数换掉，触发「庆祝」那条 `$effect` */
    export function setMastered(mastered: number): void {
        stats = { ...stats, mastered, pending: stats.total - mastered };
    }

    export function setTotal(total: number): void {
        stats = { ...stats, total, pending: total - stats.mastered };
    }
</script>

<ProgressBar
    {stats}
    {learningSegments}
    {focused}
    {label}
    {rightValue}
    {interactive}
    {ariaLabel}
    {onToggleFocus}
/>
