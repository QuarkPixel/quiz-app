<script lang="ts">
    import { useMemorySession } from "@/features/memory/context";
    import {
        cumulativeIntervalDays,
        MEMORY_GRADUATE_LEVEL_BOUNDS,
    } from "@/features/memory/algorithm";
    import { BANK_SETTINGS_BOUNDS } from "@/bankSettings";
    import { MEMORY_SETTINGS_BOUNDS } from "@/features/memory/settings";
    import QuestionOrder from "../settings/QuestionOrder.svelte";
    import BankNameSetting from "./BankNameSetting.svelte";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Slider } from "$lib/components/ui/slider";
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

    // 结构与刷题模式的 Settings.svelte 完全同构：同一个 Dialog 外壳、同一套
    // section 标题样式、同样的 Label + Input / Switch 行、同样的 ConfirmActionButton，
    // 顺序设置直接复用 QuestionOrder 组件。
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

<Dialog.Root bind:open>
    <Dialog.Content
        class="bg-card flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
    >
        <Dialog.Header class="border-b px-5 py-3.5">
            <Dialog.Title class="text-base font-semibold"
                >设置</Dialog.Title
            >
        </Dialog.Header>

        <div class="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <BankNameSetting {hash} name={bankName} />

            <section class="flex flex-col gap-2.5">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    学习模式
                </h3>
                <div class="flex items-center justify-between gap-3">
                    <Label for="memory-round" class="text-sm font-normal">
                        目标每轮学习数
                    </Label>
                    <Input
                        id="memory-round"
                        type="number"
                        min={MEMORY_SETTINGS_BOUNDS.roundTarget.min}
                        max={MEMORY_SETTINGS_BOUNDS.roundTarget.max}
                        bind:value={session.memorySettings.roundTarget}
                        onchange={() =>
                            session.updateMemorySettings({
                                roundTarget:
                                    session.memorySettings.roundTarget,
                            })}
                        class="h-7 w-20 text-center"
                    />
                </div>
                <div class="flex items-center justify-between gap-3">
                    <Label for="memory-streak" class="text-sm font-normal">
                        连续正确次数
                    </Label>
                    <Input
                        id="memory-streak"
                        type="number"
                        min={BANK_SETTINGS_BOUNDS.correctStreakToMaster.min}
                        max={BANK_SETTINGS_BOUNDS.correctStreakToMaster.max}
                        bind:value={
                            session.appState.settings.correctStreakToMaster
                        }
                        onchange={() =>
                            session.updateBankSettings({
                                correctStreakToMaster:
                                    session.appState.settings
                                        .correctStreakToMaster,
                            })}
                        class="h-7 w-20 text-center"
                    />
                </div>
            </section>

            <Separator />

            <!-- 学习顺序：与刷题模式共用同一个 QuestionOrder 组件 -->
            <section class="flex flex-col gap-2.5">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    学习顺序
                </h3>
                <QuestionOrder
                    activeOrder={session.appState.settings.selectionMode}
                    onSelect={(v) =>
                        session.updateBankSettings({ selectionMode: v })}
                />
            </section>

            <Separator />

            <!-- 掌握阈值：唯一的 shadcn Slider -->
            <section class="flex flex-col gap-3">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    掌握阈值 M
                </h3>
                <div class="flex items-baseline justify-between gap-3">
                    <Label for="memory-threshold" class="text-sm font-normal">
                        复习 {threshold} 次后算已掌握
                    </Label>
                    <span class="text-muted-foreground font-mono text-xs">
                        约 {totalDays} 天
                    </span>
                </div>
                <Slider
                    type="single"
                    id="memory-threshold"
                    aria-label="掌握阈值"
                    min={MEMORY_GRADUATE_LEVEL_BOUNDS.min}
                    max={MEMORY_GRADUATE_LEVEL_BOUNDS.max}
                    step={1}
                    value={threshold}
                    onValueChange={(v) =>
                        typeof v === "number" &&
                        session.updateMemorySettings({ graduateLevel: v })}
                />
            </section>

            <Separator />

            <!-- 进度备份：与刷题模式同一套按钮与快捷键 -->
            <section class="flex flex-col gap-2.5">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    进度备份
                </h3>
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
            </section>

            <Separator />

            <!-- ── 调试区：只在 dev 模式显示（删掉 devClock.ts 时连同这一段一起删） ── -->
            {#if isDebugModeEnabled()}
                <section class="flex flex-col gap-2.5">
                    <h3
                        class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                    >
                        时间修改
                    </h3>
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
                </section>

                <Separator />
            {/if}

            <!-- 快捷键说明（放在设置最底部） -->
            <section class="flex flex-col gap-2">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    快捷键
                </h3>
                <div class="text-muted-foreground flex flex-col gap-1.5 text-xs">
                    <div class="flex items-center justify-between gap-3">
                        <span>知道</span>
                        <KbdGroup><Kbd>Space</Kbd><Kbd>Enter</Kbd></KbdGroup>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                        <span>忘记</span>
                        <KbdGroup><Kbd>M</Kbd><Kbd>;</Kbd></KbdGroup>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                        <span>下一题</span>
                        <KbdGroup><Kbd>Space</Kbd><Kbd>Enter</Kbd></KbdGroup>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                        <span>复制当前题目</span>
                        <KbdGroup>
                            <Kbd>{modKeyLabel}</Kbd>
                            <Kbd>{SHORTCUTS.copyQuestion.toUpperCase()}</Kbd>
                        </KbdGroup>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                        <span>导出 / 导入进度</span>
                        <KbdGroup>
                            <Kbd>{modKeyLabel}</Kbd>
                            <Kbd>{SHORTCUTS.exportProgress.toUpperCase()}</Kbd>
                            <Kbd>/</Kbd>
                            <Kbd>{SHORTCUTS.importProgress.toUpperCase()}</Kbd>
                        </KbdGroup>
                    </div>
                </div>
            </section>

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
        </div>
    </Dialog.Content>
</Dialog.Root>
