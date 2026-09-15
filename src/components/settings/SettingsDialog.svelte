<script lang="ts">
    import type { Snippet } from "svelte";
    import * as Dialog from "$lib/components/ui/dialog";

    /**
     * 刷题 / 记忆两个模式的设置面板共用的 Dialog 外壳：标题栏 + 唯一的滚动内容区。
     *
     * 外壳必须只有一份：以前两边各抄一遍，记忆模式那份的标题就漂成了「设置」，
     * 跟刷题模式的「当前题库设置」对不上。所以 `title` 的默认值就是两个面板
     * 实际用的标题——调用方一律不传，将来要改也只改这一处。
     */
    interface Props {
        open?: boolean;
        /** 面板标题，默认「当前题库设置」（两个模式的设置面板共用） */
        title?: string;
        children: Snippet;
    }

    let {
        open = $bindable(false),
        title = "当前题库设置",
        children,
    }: Props = $props();
</script>

<Dialog.Root bind:open>
    <Dialog.Content
        onOpenAutoFocus={(e) => {
            // 默认行为是把焦点丢给第一个可聚焦元素（也就是「修改名称」输入框）——
            // 打开设置时不该抢焦点、更不该直接进输入态。需要聚焦搜索框的是总览。
            e.preventDefault();
        }}
        class="bg-card flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
    >
        <Dialog.Header class="border-b px-5 py-3.5">
            <Dialog.Title class="text-base font-semibold">{title}</Dialog.Title>
        </Dialog.Header>

        <!-- 滚动只发生在内容区：面板比视口高时（记忆模式带调试区还要更高），
             标题栏得钉在原地，所以外层的 overflow-hidden 与这里的 overflow-y-auto
             是一对，别把滚动挪到 Content 上 -->
        <div class="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            {@render children()}
        </div>
    </Dialog.Content>
</Dialog.Root>
