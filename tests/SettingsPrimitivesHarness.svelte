<script lang="ts">
    /**
     * 三个共享设置基元（`SettingsDialog` / `SettingsSection` / `SettingNumberRow`）的测试外壳。
     *
     * 为什么非要一个外壳：`SettingNumberRow.value` 和 `SettingsDialog.open` 都是 `$bindable`，
     * 「子组件把值写回父组件」这件事只有在**真的有一个持有状态的父组件**时才测得出来——
     * 单独 mount 组件时绑定断没断看不出来。所以外壳自己持有 `value` / `open`、用 `bind:` 接上，
     * 并把父状态渲染到 `[data-probe]` 的属性上：测试断言的是**父状态**，
     * 而不是组件自己的 DOM（后者会把「绑定断了」也测成通过）。
     */
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { untrack } from "svelte";
    import SettingNumberRow from "@/components/settings/SettingNumberRow.svelte";
    import SettingsDialog from "@/components/settings/SettingsDialog.svelte";
    import SettingsSection from "@/components/settings/SettingsSection.svelte";

    interface Props {
        kind: "number-row" | "section" | "dialog";
        /** number-row：透传给组件的 id / 标签 / 边界 / 初值 */
        id?: string;
        label?: string;
        min?: number;
        max?: number;
        initialValue?: number;
        /** number-row：要不要挂那个彩色装饰 */
        decoration?: boolean;
        /** section：额外 class（用来验证 `gap-3` 能盖掉默认的 `gap-2.5`） */
        sectionClass?: string;
        /** dialog：父组件持有的初始 open */
        initialOpen?: boolean;
    }

    let {
        kind,
        id = "row",
        label = "设置项",
        min = 0,
        max = 100,
        initialValue = 3,
        decoration = false,
        sectionClass = undefined,
        initialOpen = false,
    }: Props = $props();

    // ── 父状态：`$bindable` 的另一端 ──────────────────────────────────
    // `untrack` 是故意的：要的就是**挂载时的初值**（用例挂一次就不再动 props），
    // 这里需要的是可变的父状态，不是跟着 props 走的投影。
    let value = $state(untrack(() => initialValue));
    let open = $state(untrack(() => initialOpen));
    // `input` / `change` 各触发了什么，靠这个计数器分开：两个面板都只在
    // change 时落盘（在 input 上落盘 = 每敲一个字符写一次设置）
    let changeCalls = $state(0);
</script>

{#snippet decorationMark()}
    <span data-decoration>装饰</span>
{/snippet}

<!-- 与 App.svelte 的层级一致：这些基元底下是 bits-ui -->
<Tooltip.Provider delayDuration={0}>
    <div
        data-probe
        data-value={value}
        data-open={String(open)}
        data-change-calls={String(changeCalls)}
    >
        {#if kind === "number-row"}
            <!-- 装饰要能**真的不传**（记忆模式那两行就没有）：传一个空 snippet
                 测不出 `{@render children?.()}` 里的 `?.` 丢没丢 -->
            <SettingNumberRow
                {id}
                {label}
                {min}
                {max}
                bind:value
                onChange={() => (changeCalls += 1)}
                children={decoration ? decorationMark : undefined}
            />
        {:else if kind === "section"}
            <SettingsSection title="学习算法" class={sectionClass}>
                <p data-section-child>小节内容</p>
            </SettingsSection>
        {:else}
            <!-- 父组件从外面推 open，用来测「父 → 子」这一半 -->
            <button data-parent-open onclick={() => (open = true)}>父组件置真</button>
            <button data-parent-close onclick={() => (open = false)}>父组件置假</button>

            <!-- 不传 title：默认标题本身就是要守的行为（两个面板曾经一个叫「设置」） -->
            <SettingsDialog bind:open>
                <p data-dialog-child>面板内容</p>
            </SettingsDialog>
        {/if}
    </div>
</Tooltip.Provider>
