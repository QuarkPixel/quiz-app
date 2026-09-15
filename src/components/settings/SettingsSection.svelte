<script lang="ts">
    import type { Snippet } from "svelte";
    import { cn } from "$lib/utils";

    /**
     * 设置面板里的一个 section：小标题 + 内容。
     *
     * 标题那串 class 只在这里写一次——它原本在四个文件里抄了 12 遍，
     * 改字号 / 字色要满目录找。间距仍然交给调用方：多数 section 是 `gap-2.5`，
     * 但快捷键表本来就是 `gap-2`、掌握阈值是 `gap-3`，统一只会顺手改了视觉。
     */
    interface Props {
        title: string;
        /** 额外的容器 class；传 `gap-*` 会覆盖默认的 `gap-2.5` */
        class?: string;
        children: Snippet;
    }

    let { title, class: className, children }: Props = $props();
</script>

<section class={cn("flex flex-col gap-2.5", className)}>
    <h3
        class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
    >
        {title}
    </h3>
    {@render children()}
</section>
