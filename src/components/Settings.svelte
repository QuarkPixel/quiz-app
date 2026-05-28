<script lang="ts">
    import { SHORTCUTS } from "../config";
    import { modKeyLabel } from "$lib/platform";
    import { createConfirmAction } from "$lib/hooks/createConfirmAction.svelte";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button } from "$lib/components/ui/button";
    import { Switch } from "$lib/components/ui/switch";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Separator } from "$lib/components/ui/separator";
    import * as ToggleGroup from "$lib/components/ui/toggle-group";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import { cn } from "$lib/utils";
    import QuestionFilters from "./QuestionFilters.svelte";
    import IconShuffle from "@tabler/icons-svelte/icons/arrows-shuffle";
    import IconArrowsRight from "@tabler/icons-svelte/icons/arrow-narrow-right";
    import IconCopy from "@tabler/icons-svelte/icons/copy";
    import IconClipboard from "@tabler/icons-svelte/icons/clipboard";
    import IconRefresh from "@tabler/icons-svelte/icons/refresh";
    import { useQuizSession } from "../quiz/session/context";

    interface Props {
        open?: boolean;
    }

    let { open = $bindable(false) }: Props = $props();

    const session = useQuizSession();
    const resetAction = createConfirmAction(() => session.reset());

    $effect(() => {
        if (!open && resetAction.confirming) {
            resetAction.reset();
        }
    });
</script>

<Dialog.Root bind:open>
    <Dialog.Content
        class="bg-card flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
    >
        <Dialog.Header class="border-b px-5 py-3.5">
            <Dialog.Title class="text-base font-semibold"
                >当前题库设置</Dialog.Title
            >
        </Dialog.Header>

        <div class="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <section class="flex flex-col gap-2.5">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    题型筛选
                </h3>
                <QuestionFilters
                    options={session.filterOptions}
                    activeType={session.appState.filterType}
                    onSelect={(t) => session.setFilter(t)}
                />
            </section>

            <Separator />

            <section class="flex flex-col gap-2.5">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    刷题方式
                </h3>
                <ToggleGroup.Root
                    type="single"
                    value={session.appState.settings.selectionMode}
                    onValueChange={(v) => {
                        if (v === "random" || v === "sequential") {
                            session.appState.settings.selectionMode = v;
                            session.handleAlgorithmChange();
                        }
                    }}
                    variant="outline"
                    size="sm"
                    class="w-full gap-1.5"
                >
                    <ToggleGroup.Item
                        value="random"
                        aria-label="随机刷题"
                        class="flex-1 gap-1.5"
                    >
                        <IconShuffle size={14} stroke={1.75} />
                        <span class="text-xs">随机</span>
                    </ToggleGroup.Item>
                    <ToggleGroup.Item
                        value="sequential"
                        aria-label="顺序刷题"
                        class="flex-1 gap-1.5"
                    >
                        <IconArrowsRight size={14} stroke={1.75} />
                        <span class="text-xs">顺序</span>
                    </ToggleGroup.Item>
                </ToggleGroup.Root>
            </section>

            <Separator />

            <section class="flex flex-col gap-2.5">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    答题行为
                </h3>
                <div class="flex items-center justify-between gap-3">
                    <Label
                        for="auto-next"
                        class="flex items-center gap-2 text-sm font-normal"
                    >
                        答对自动下一题
                        <KbdGroup class="text-[10px]">
                            <Kbd>{modKeyLabel}</Kbd>
                            <Kbd>{SHORTCUTS.toggleAutoNext.toUpperCase()}</Kbd>
                        </KbdGroup>
                    </Label>
                    <Switch
                        id="auto-next"
                        bind:checked={
                            session.appState.settings.autoNextOnCorrect
                        }
                        onCheckedChange={() => session.handlePreferenceChange()}
                        size="sm"
                    />
                </div>
            </section>

            <Separator />

            <section class="flex flex-col gap-2.5">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    学习算法
                </h3>
                <div class="flex items-center justify-between gap-3">
                    <Label for="pool-size" class="text-sm font-normal">
                        活动题目池大小
                        <div class="w-8 h-1 flex rounded-full overflow-hidden">
                            <div class="bg-[#829A4C] h-full w-1/3"></div>
                            <div class="bg-[#B9AC49] h-full w-1/3"></div>
                            <div class="bg-[#F1BB58] h-full w-1/3"></div>
                        </div>
                    </Label>
                    <Input
                        id="pool-size"
                        type="number"
                        min={5}
                        max={100}
                        bind:value={session.appState.settings.activePoolSize}
                        onchange={() => session.handleAlgorithmChange()}
                        class="h-7 w-20 text-center"
                    />
                </div>
                <div class="flex items-center justify-between gap-3">
                    <Label for="streak-master" class="text-sm font-normal">
                        首次掌握需正确次数
                        <div class="w-2 h-2 bg-success rounded-full"></div>
                    </Label>
                    <Input
                        id="streak-master"
                        type="number"
                        min={1}
                        max={10}
                        bind:value={
                            session.appState.settings.correctStreakToMaster
                        }
                        onchange={() => session.handleAlgorithmChange()}
                        class="h-7 w-20 text-center"
                    />
                </div>
                <div class="flex items-center justify-between gap-3">
                    <Label for="streak-mistake" class="text-sm font-normal">
                        答错后需正确次数 <div
                            class="w-2 h-2 bg-warning rounded-full"
                        ></div>
                    </Label>
                    <Input
                        id="streak-mistake"
                        type="number"
                        min={1}
                        max={20}
                        bind:value={
                            session.appState.settings.correctStreakAfterMistake
                        }
                        onchange={() => session.handleAlgorithmChange()}
                        class="h-7 w-20 text-center"
                    />
                </div>
            </section>

            <Separator />

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
                        onclick={() => session.exportProgress()}
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
                        onclick={() => session.startImport()}
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

            <Button
                variant="destructive"
                size="sm"
                class={cn(
                    "w-full",
                    resetAction.confirming && "ring-destructive/40 ring-2",
                )}
                onclick={resetAction.trigger}
            >
                <IconRefresh size={14} stroke={1.75} />
                {resetAction.confirming ? "再次点击以确认" : "重置所有进度"}
            </Button>
        </div>
    </Dialog.Content>
</Dialog.Root>
