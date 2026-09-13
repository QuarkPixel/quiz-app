<script lang="ts">
    import { cn } from "$lib/utils";

    /**
     * 记忆模式的进度条。样式与刷题模式的 `ProgressBar` 对齐（同样的 42px 高、
     * 三栏数字、3px 细条、圆角小段），但故意简化：
     *   - 固定小尺寸，不做「聚焦放大」
     *   - 只有两段颜色：绿色 = 已完成，灰色 = 剩余
     *   - 左右数字 + 中间百分比
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

    let { done, total, label, ariaLabel }: Props = $props();

    const safeTotal = $derived(Math.max(0, total));
    const safeDone = $derived(Math.min(Math.max(0, done), safeTotal));
    const percent = $derived(
        safeTotal > 0 ? Math.round((safeDone / safeTotal) * 100) : 0,
    );
    const doneWidth = $derived(safeTotal > 0 ? (safeDone / safeTotal) * 100 : 0);
</script>

<div
    class="block w-full h-[42px] py-1.5 text-left"
    aria-label={ariaLabel}
    role="progressbar"
    aria-valuenow={safeDone}
    aria-valuemin={0}
    aria-valuemax={safeTotal}
>
    <div
        class="text-muted-foreground mb-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end text-xs tabular-nums"
    >
        <span class="justify-self-start font-mono">{safeDone}</span>
        <span class="justify-self-center font-mono text-[smaller] opacity-70">
            {label ?? `${percent}%`}
        </span>
        <span class="justify-self-end font-mono">{safeTotal}</span>
    </div>
    <div class="flex h-[3px] gap-1">
        <div
            class={cn(
                "rounded-sm bg-success transition-[width] duration-300 ease-out",
            )}
            style="width: {doneWidth}%"
        ></div>
        <div
            class="rounded-sm bg-foreground/15 transition-[width] duration-300 ease-out"
            style="width: {100 - doneWidth}%"
        ></div>
    </div>
</div>
