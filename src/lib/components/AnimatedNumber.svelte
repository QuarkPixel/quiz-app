<script lang="ts">
    import {
        preloadNumberFlow,
        formatNumberFallback,
    } from "$lib/numberFlow";

    /**
     * 一个会滚的数字。
     *
     * `@number-flow/svelte` 是动态拉的（见 `$lib/numberFlow.ts`），所以这里用
     * `{#await}` 把它兜住：包还没到时先写纯文本——同一个 `Intl` 格式化结果，
     * 长得一模一样，只是不滚动；到了之后换成 `NumberFlow`，此后的变化照常动画。
     * 所有调用方共用同一个 Promise，只会拉一次。
     *
     * 进度条上那三个数字与掌握阈值那行文案都用它——`ProgressBar` 以前把这段
     * 内联写死在自己身上，别处要用（设置面板里的「N 次 / 约 M 天」）就只能再抄
     * 一份，于是数字滚动只在进度条里有。
     */
    interface Props {
        value: number;
        /** `Intl.NumberFormatOptions`，与兜底文本共用 */
        format?: Intl.NumberFormatOptions;
        class?: string;
    }

    let { value, format, class: className }: Props = $props();
</script>

{#await preloadNumberFlow()}
    <span class={className}>{formatNumberFallback(value, format)}</span>
{:then engine}
    <engine.Component
        plugins={[engine.continuous]}
        {value}
        {format}
        class={className}
    />
{/await}
