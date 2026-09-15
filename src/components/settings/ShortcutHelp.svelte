<script lang="ts">
    import { APP_SHORTCUTS, LISTED_SHORTCUTS } from "@/config";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import { modKeyLabel } from "$lib/platform";
    import SettingsSection from "./SettingsSection.svelte";

    /**
     * 设置面板最底部的「快捷键」表。
     *
     * 分两段，各有各的单一真源：
     *   - **应用级**：`@/config` 的 `SHORTCUTS` + `APP_SHORTCUTS` + `LISTED_SHORTCUTS`
     *     注册表。按键、说明、键盘分发三处同源，所以这张表不可能和实际行为脱节
     *     （以前记忆模式那份是手抄的，⌘S / ⌘N 抄漏了都看不出来）。
     *   - **题目级**：由题型决定（记忆模式是「知道 / 模糊 / 忘记」，刷题模式是
     *     「选项字母 + 提交 / 下一题」），所以由调用方以 `answerRows` 传进来。
     */
    interface AnswerRow {
        label: string;
        /** 每个元素渲染成一个 `<Kbd>`，如 `["Space", "Enter"]` */
        keys: string[];
    }

    /**
     * 注意：`answerRows` 的 key **不能用 `row.label`**。
     *
     * 「同一个动作分两行写」是很自然的事（刷题模式的选择键就分字母 / 数字两行），
     * 一旦两行同名，`{#each … (row.label)}` 会直接抛 `each_key_duplicate` ——
     * 弹窗整个渲染不出来，表现成「设置打不开」。这张表是静态的、不重排，
     * 按下标做 key 既够用又不可能撞。
     */

    interface Props {
        /** 题目级快捷键（每个模式不一样），默认不显示 */
        answerRows?: AnswerRow[];
        /** 题目级那段的标题，默认「答题」 */
        answerGroupLabel?: string;
    }

    let { answerRows = [], answerGroupLabel = "答题" }: Props = $props();

    /** `"⇧I"` → `["⇧", "I"]`：每个键各自一个 `<Kbd>`，和手写的那份排版一致。 */
    function shortcutKeys(kbd: string): string[] {
        return kbd.split("");
    }
</script>

<SettingsSection title="快捷键" class="gap-2">
    <div class="text-muted-foreground flex flex-col gap-1.5 text-xs">
        {#if answerRows.length > 0}
            <span class="text-foreground/40 text-[10px] tracking-wider uppercase">
                {answerGroupLabel}
            </span>
            {#each answerRows as row, index (index)}
                <div class="flex items-center justify-between gap-3">
                    <span>{row.label}</span>
                    <KbdGroup>
                        {#each row.keys as key (key)}
                            <Kbd>{key}</Kbd>
                        {/each}
                    </KbdGroup>
                </div>
            {/each}
        {/if}

        <span class="text-foreground/40 text-[10px] tracking-wider uppercase">
            应用
        </span>
        {#each LISTED_SHORTCUTS as id (id)}
            {@const meta = APP_SHORTCUTS[id]}
            <div class="flex items-center justify-between gap-3">
                <span>{meta.label}</span>
                <KbdGroup>
                    <Kbd>{modKeyLabel}</Kbd>
                    {#each shortcutKeys(meta.kbd) as key, keyIndex (keyIndex)}
                        <Kbd>{key}</Kbd>
                    {/each}
                </KbdGroup>
            </div>
        {/each}
    </div>
</SettingsSection>
