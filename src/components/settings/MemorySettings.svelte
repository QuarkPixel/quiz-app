<script lang="ts">
    import { useMemorySession } from "@/features/memory/context";
    import {
        cumulativeIntervalDays,
        MEMORY_GRADUATE_LEVEL_BOUNDS as BOUNDS,
    } from "@/features/memory/algorithm";
    import { BANK_SETTINGS_BOUNDS } from "@/bankSettings";
    import { MEMORY_SETTINGS_BOUNDS } from "@/features/memory/settings";
    import QuestionOrder from "../settings/QuestionOrder.svelte";
    import BankNameSetting from "./BankNameSetting.svelte";
    import ShortcutHelp from "./ShortcutHelp.svelte";
    import { Button } from "$lib/components/ui/button";
    import { Label } from "$lib/components/ui/label";
    import * as Slider from "$lib/components/ui/slider";
    import { Separator } from "$lib/components/ui/separator";
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import IconRefresh from "@tabler/icons-svelte/icons/refresh";
    import IconPlus from "@tabler/icons-svelte/icons/plus";
    import { isDebugModeEnabled } from "@/debug";
    import IconCopy from "@tabler/icons-svelte/icons/copy";
    import IconClipboard from "@tabler/icons-svelte/icons/clipboard";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import { modKeyLabel } from "$lib/platform";
    import { SHORTCUTS } from "@/config";
    import SettingsDialog from "./SettingsDialog.svelte";
    import SettingsSection from "./SettingsSection.svelte";
    import SettingNumberRow from "./SettingNumberRow.svelte";
    import AnimatedNumber from "$lib/components/AnimatedNumber.svelte";

    // 面板内容按模式各写各的（记忆模式多了「掌握阈值」），同构的部分——Dialog 外壳、
    // section 标题、数字行、快捷键表——都走共用组件，不再像以前那样两边各抄一遍。
    interface Props {
        open?: boolean;
        /** 当前题库 hash（用于修改名称） */
        hash: string;
        /** 当前题库名称 */
        bankName: string;
    }

    let { open = $bindable(false), hash, bankName }: Props = $props();

    const session = useMemorySession();
    let resetButton: ConfirmActionButton;

    const threshold = $derived(session.memorySettings.graduateLevel);
    const totalDays = $derived(cumulativeIntervalDays(threshold));

    $effect(() => {
        if (!open) resetButton?.reset();
    });
</script>

<SettingsDialog bind:open>
    <BankNameSetting {hash} name={bankName} />

    <SettingsSection title="学习模式">
        <SettingNumberRow
            id="memory-round"
            label="目标每轮学习数"
            min={MEMORY_SETTINGS_BOUNDS.roundTarget.min}
            max={MEMORY_SETTINGS_BOUNDS.roundTarget.max}
            bind:value={session.memorySettings.roundTarget}
            onChange={() =>
                session.updateMemorySettings({
                    roundTarget: session.memorySettings.roundTarget,
                })}
        />
        <SettingNumberRow
            id="memory-streak"
            label="连续正确次数"
            min={BANK_SETTINGS_BOUNDS.correctStreakToMaster.min}
            max={BANK_SETTINGS_BOUNDS.correctStreakToMaster.max}
            bind:value={session.appState.settings.correctStreakToMaster}
            onChange={() =>
                session.updateBankSettings({
                    correctStreakToMaster:
                        session.appState.settings.correctStreakToMaster,
                })}
        />
    </SettingsSection>

    <Separator />

    <!-- 学习顺序：与刷题模式共用同一个 QuestionOrder 组件 -->
    <SettingsSection title="学习顺序">
        <QuestionOrder
            activeOrder={session.appState.settings.selectionMode}
            onSelect={(v) => session.updateBankSettings({ selectionMode: v })}
        />
    </SettingsSection>

    <Separator />

    <!-- 掌握阈值：唯一的 shadcn Slider。刻度与刻度标签走 ui/slider 的
         `Tick` / `TickLabel`——`step` 用整数 1（值域就是 3..10 这两端的层级），
         刻度按**层级**等距排开；标签反过来显示该层级的累计天数（2^(n-1) 曲线，
         按天排会挤成一坨，见 `cumulativeIntervalDays`）。 -->
    <SettingsSection title="掌握阈值" class="gap-3">
        <!-- 刻度标签挂在轨道下方（`position="bottom"`），底下这点 pb 就是它们的高度 -->
        <div class="pb-5 pt-8">
            <Slider.Root
                id="memory-threshold"
                type="single"
                min={BOUNDS.min}
                max={BOUNDS.max}
                step={1}
                value={threshold}
                onValueChange={(value) =>
                    session.updateMemorySettings({ graduateLevel: value })}
                trackPadding={3}
            >
                {#snippet children({ tickItems })}
                    <span
                        class="bg-muted relative h-1.5 w-full grow cursor-pointer overflow-hidden rounded-full"
                    >
                        <Slider.Range />
                    </span>
                    <Slider.Thumb index={0} aria-label="复习次数" />
                    <Slider.ThumbLabel
                        index={0}
                        class="bg-muted text-foreground mb-2.5 text-nowrap rounded-md px-2 py-1 text-sm"
                    >
                        {threshold}
                    </Slider.ThumbLabel>
                    {#each tickItems as { index, value } (index)}
                        <Slider.Tick {index} />
                        <Slider.TickLabel
                            {index}
                            position="bottom"
                            class="mt-2 text-[10px] leading-none w-max"
                        >
                            {cumulativeIntervalDays(value)}天
                        </Slider.TickLabel>
                    {/each}
                {/snippet}
            </Slider.Root>
        </div>
        <div class="flex items-baseline justify-start gap-3">
            <Label for="memory-threshold" class="text-xs font-normal opacity-60">
                复习连续正确<AnimatedNumber
                    value={threshold}
                />次后为掌握，共需约<AnimatedNumber value={totalDays} />天。
            </Label>
        </div>
    </SettingsSection>

    <Separator />

    <!-- 进度备份：与刷题模式同一套按钮与快捷键 -->
    <SettingsSection title="进度备份">
        <div class="flex gap-2">
            <Button
                variant={session.exportStatus === "copied"
                    ? "default"
                    : session.exportStatus === "error"
                      ? "destructive"
                      : "outline"}
                size="sm"
                class="flex-1 justify-between gap-2"
                onclick={() => void session.exportProgress()}
                disabled={session.exportStatus !== "idle"}
            >
                <span class="flex items-center gap-1.5">
                    <IconCopy size={14} stroke={1.75} />
                    {#if session.exportStatus === "copied"}已复制
                    {:else if session.exportStatus === "error"}导出失败
                    {:else}导出{/if}
                </span>
                <KbdGroup class="text-[10px]">
                    <Kbd>{modKeyLabel}</Kbd>
                    <Kbd>{SHORTCUTS.exportProgress.toUpperCase()}</Kbd>
                </KbdGroup>
            </Button>
            <Button
                variant="outline"
                size="sm"
                class="flex-1 justify-between gap-2"
                onclick={() => void session.startImport()}
            >
                <span class="flex items-center gap-1.5">
                    <IconClipboard size={14} stroke={1.75} />
                    导入
                </span>
                <KbdGroup class="text-[10px]">
                    <Kbd>{modKeyLabel}</Kbd>
                    <Kbd>{SHORTCUTS.importProgress.toUpperCase()}</Kbd>
                </KbdGroup>
            </Button>
        </div>
    </SettingsSection>

    <Separator />

    <!-- ── 调试区：只在 dev 模式显示（删掉 devClock.ts 时连同这一段一起删） ── -->
    {#if isDebugModeEnabled()}
        <SettingsSection title="时间修改">
            <div class="flex items-center justify-between gap-3">
                <Label for="memory-debug-day" class="text-sm font-normal">
                    当前时间 + 天数
                </Label>
                <div class="flex items-center gap-1.5">
                    <span
                        class="font-mono text-sm tabular-nums text-foreground/60"
                    >
                        {session.debugDayOffset}
                    </span>
                    <Button
                        id="memory-debug-day"
                        variant="outline"
                        size="icon-sm"
                        aria-label="加一天"
                        onclick={() => {
                            session.debugAddDay();
                            session.exitSession();
                        }}
                    >
                        <IconPlus size={14} stroke={2} />
                    </Button>
                </div>
            </div>
            <p class="text-muted-foreground text-xs leading-relaxed">
                把「今天」往后推一天，回到首页点「复习」就能看到到期的卡片。
            </p>
        </SettingsSection>

        <Separator />
    {/if}

    <!-- 快捷键说明：与刷题模式共用同一个组件，应用级那部分直接读
         `@/config` 的注册表（不手抄，⌘S / ⌘N 这类新键不会漏） -->
    <ShortcutHelp
        answerRows={[
            { label: "知道 / 下一题", keys: ["Space", "Enter"] },
            { label: "模糊", keys: ["'"] },
            { label: "忘记 / 记错了", keys: [";"] },
        ]}
    />

    <Separator />

    <ConfirmActionButton
        bind:this={resetButton}
        variant="destructive"
        size="sm"
        class="w-full"
        confirmClass="ring-destructive/40 ring-2"
        onConfirm={() => session.reset()}
    >
        {#snippet children({ confirming })}
            <IconRefresh size={14} stroke={1.75} />
            {confirming ? "再次点击以确认" : "重置记忆模式进度"}
        {/snippet}
    </ConfirmActionButton>
</SettingsDialog>
