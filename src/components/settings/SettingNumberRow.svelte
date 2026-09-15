<script lang="ts">
    import type { Snippet } from "svelte";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";

    /**
     * 设置面板里的「标签 + 数字输入框」行。
     *
     * 两个面板一共 5 行，差别只在标签文字；其中 3 行的标签里另挂了一个颜色标记
     * （活动池的梯度条、两个连对次数的圆点），所以装饰走 `children` 原样塞进
     * `Label`，组件本身不为哪一行开特例。标签里是 Switch / Slider / Tooltip
     * 那种结构完全不同的行不进这里——硬塞进来会让每个调用点都是分支。
     */
    interface Props {
        /** 同时给 `Label` 的 for 与 `Input` 的 id：点标签能聚焦输入框 */
        id: string;
        label: string;
        min: number;
        max: number;
        value: number;
        onChange: () => void;
        /** 跟在标签文字后面的装饰（颜色圆点 / 梯度条），没有就不传 */
        children?: Snippet;
    }

    let {
        id,
        label,
        min,
        max,
        value = $bindable(),
        onChange,
        children,
    }: Props = $props();
</script>

<div class="flex items-center justify-between gap-3">
    <Label for={id} class="text-sm font-normal">
        <!-- 装饰前那个空格是照抄原标记的：Label 是 flex，空格本就不进排版，
             但去掉会让「这次只是搬了个家」的 diff 说不清楚 -->
        {label}{#if children}{" "}{@render children?.()}{/if}
    </Label>
    <Input
        {id}
        type="number"
        {min}
        {max}
        bind:value
        onchange={onChange}
        class="h-7 w-20 text-center"
    />
</div>
