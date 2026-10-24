<script lang="ts">
    import * as Drawer from "$lib/components/ui/drawer";
    import PoolPanel from "./PoolPanel.svelte";

    /**
     * 窄版面的活动池：底部抽屉。
     *
     * 为什么不再「折进滚动区」：以前窄屏是把池子塞在作答区下面、用 `max-height`
     * 展开收起。那条路要量内容高度才能做动画（`ResizeObserver` → `max-height`），
     * 而池子本来就是个「临时看一眼」的东西——它应该浮在内容之上，不该把题干挤走，
     * 也不该为了它多维护一份高度测量。抽屉天生就是这个语义：从底下推上来，
     * 下滑 / 点遮罩就收回去，下面的答题状态一点不动。
     *
     * **开合状态只有一份**：`ui.showPool`。宽版面读它决定那一列的宽度，窄版面读它
     * 决定抽屉开不开——同一个变量，两种摆法，由 `QuizView` 按断点二选一
     * （见那边的 `compact`）。
     */
    interface Props {
        open?: boolean;
        /** 抽屉自己关掉了（下滑 / 点遮罩 / Esc）——必须写回同一个变量 */
        onOpenChange?: (open: boolean) => void;
    }

    let { open = false, onOpenChange }: Props = $props();
</script>

<Drawer.Root {open} {onOpenChange}>
    <!--
        `z-(--z-drawer)`：要盖住底部工具栏与内容，但低于 Toast。
        `max-h-[85vh]` 比默认的 80vh 稍高一点——池子常常有十几条，能多露一行是一行。
    -->
    <Drawer.Content
        class="z-(--z-drawer) max-h-[85vh] pb-[env(safe-area-inset-bottom)]"
    >
        <Drawer.Header class="border-b px-5 py-3.5 text-start">
            <Drawer.Title class="text-base font-semibold">
                活动题目池
            </Drawer.Title>
        </Drawer.Header>

        <!-- 抽屉自己的滚动区：`min-h-0` 不能省，否则 flex 子项会把高度顶回去 -->
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3">
            <PoolPanel />
        </div>
    </Drawer.Content>
</Drawer.Root>
