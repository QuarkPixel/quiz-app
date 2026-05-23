<script lang="ts">
    import type { QuestionType, RuntimeState, StoredState } from "../types";
    import type { FilterOption } from "../features/quiz/filters";
    import { exportProgress, importProgress } from "../features/importExport";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button } from "$lib/components/ui/button";
    import { Switch } from "$lib/components/ui/switch";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { Separator } from "$lib/components/ui/separator";
    import * as ToggleGroup from "$lib/components/ui/toggle-group";
    import { cn } from "$lib/utils";
    import QuestionFilters from "./QuestionFilters.svelte";
    import IconSettings from "@tabler/icons-svelte/icons/settings";
    import IconShuffle from "@tabler/icons-svelte/icons/arrows-shuffle";
    import IconArrowsRight from "@tabler/icons-svelte/icons/arrow-narrow-right";
    import IconCopy from "@tabler/icons-svelte/icons/copy";
    import IconClipboard from "@tabler/icons-svelte/icons/clipboard";
    import IconRefresh from "@tabler/icons-svelte/icons/refresh";

    interface Props {
        appState: RuntimeState;
        filterOptions: FilterOption[];
        onFilterChange: (type: QuestionType | "all") => void;
        onReset: () => void;
        onAlgorithmChange: () => void;
        onPreferenceChange: () => void;
        onImport: (state: StoredState) => void;
    }

    let {
        appState = $bindable(),
        filterOptions,
        onFilterChange,
        onReset,
        onAlgorithmChange,
        onPreferenceChange,
        onImport,
    }: Props = $props();

    let open = $state(false);

    let importError = $state("");
    let exportStatus = $state<"idle" | "copied" | "error">("idle");
    let exportErrorMsg = $state("");

    let resetConfirming = $state(false);
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    function handleResetClick() {
        if (resetConfirming) {
            if (resetTimer) clearTimeout(resetTimer);
            resetConfirming = false;
            resetTimer = null;
            onReset();
            return;
        }
        resetConfirming = true;
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
            resetConfirming = false;
            resetTimer = null;
        }, 3000);
    }

    $effect(() => {
        if (!open && resetConfirming) {
            if (resetTimer) clearTimeout(resetTimer);
            resetTimer = null;
            resetConfirming = false;
        }
    });

    async function handleExport() {
        try {
            const encoded = await exportProgress(appState);
            await navigator.clipboard.writeText(encoded);
            exportStatus = "copied";
            setTimeout(() => (exportStatus = "idle"), 2000);
        } catch (e) {
            exportErrorMsg = e instanceof Error ? e.message : "导出失败";
            exportStatus = "error";
            setTimeout(() => (exportStatus = "idle"), 3000);
        }
    }

    async function handleImport() {
        let text: string;
        try {
            text = await navigator.clipboard.readText();
        } catch {
            importError = "无法访问剪贴板，请检查浏览器权限。";
            return;
        }

        if (!text.trim()) {
            importError = "剪贴板为空，请先复制导出的进度字符串。";
            return;
        }

        if (!confirm("导入进度将覆盖当前所有进度，确定继续吗？")) return;

        try {
            const state = await importProgress(text.trim());
            onImport(state);
            importError = "";
        } catch (e) {
            importError = e instanceof Error ? e.message : "未知错误";
        }
    }
</script>

<Dialog.Root bind:open>
    <Dialog.Trigger
        class="text-muted-foreground hover:text-foreground inline-flex size-10 items-center justify-center rounded-full transition-all duration-200 hover:rotate-[30deg]"
        aria-label="设置"
        title="设置"
    >
        <IconSettings size={22} stroke={1.5} />
    </Dialog.Trigger>
    <Dialog.Content
        class="bg-card flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
    >
        <Dialog.Header class="border-b px-5 py-3.5">
            <Dialog.Title class="text-base font-semibold">设置</Dialog.Title>
        </Dialog.Header>

        <div class="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <section class="flex flex-col gap-2.5">
                <h3
                    class="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase"
                >
                    题型筛选
                </h3>
                <QuestionFilters
                    options={filterOptions}
                    activeType={appState.filterType}
                    onSelect={onFilterChange}
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
                    value={appState.settings.selectionMode}
                    onValueChange={(v) => {
                        if (v === "random" || v === "sequential") {
                            appState.settings.selectionMode = v;
                            onAlgorithmChange();
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
                    <Label for="auto-next" class="text-sm font-normal">
                        答对自动下一题
                    </Label>
                    <Switch
                        id="auto-next"
                        bind:checked={appState.settings.autoNextOnCorrect}
                        onCheckedChange={onPreferenceChange}
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
                    </Label>
                    <Input
                        id="pool-size"
                        type="number"
                        min={5}
                        max={100}
                        bind:value={appState.settings.activePoolSize}
                        onchange={onAlgorithmChange}
                        class="h-7 w-20 text-center"
                    />
                </div>
                <div class="flex items-center justify-between gap-3">
                    <Label for="streak-master" class="text-sm font-normal">
                        首次掌握需正确次数
                    </Label>
                    <Input
                        id="streak-master"
                        type="number"
                        min={1}
                        max={10}
                        bind:value={appState.settings.correctStreakToMaster}
                        onchange={onAlgorithmChange}
                        class="h-7 w-20 text-center"
                    />
                </div>
                <div class="flex items-center justify-between gap-3">
                    <Label for="streak-mistake" class="text-sm font-normal">
                        答错后需正确次数
                    </Label>
                    <Input
                        id="streak-mistake"
                        type="number"
                        min={1}
                        max={20}
                        bind:value={appState.settings.correctStreakAfterMistake}
                        onchange={onAlgorithmChange}
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
                        variant={exportStatus === "copied"
                            ? "default"
                            : exportStatus === "error"
                              ? "destructive"
                              : "outline"}
                        size="sm"
                        class="flex-1"
                        onclick={handleExport}
                        disabled={exportStatus !== "idle"}
                        title={exportStatus === "error"
                            ? exportErrorMsg
                            : "复制到剪贴板"}
                    >
                        <IconCopy size={14} stroke={1.75} />
                        {#if exportStatus === "copied"}已复制
                        {:else if exportStatus === "error"}导出失败
                        {:else}导出{/if}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        class="flex-1"
                        onclick={handleImport}
                        title="从剪贴板导入"
                    >
                        <IconClipboard size={14} stroke={1.75} />
                        导入
                    </Button>
                </div>
                {#if importError}
                    <p class="text-destructive text-xs whitespace-pre-wrap">
                        {importError}
                    </p>
                {/if}
            </section>

            <Separator />

            <Button
                variant="destructive"
                size="sm"
                class={cn(
                    "w-full",
                    resetConfirming && "ring-destructive/40 ring-2",
                )}
                onclick={handleResetClick}
            >
                <IconRefresh size={14} stroke={1.75} />
                {resetConfirming ? "再次点击以确认" : "重置所有进度"}
            </Button>
        </div>
    </Dialog.Content>
</Dialog.Root>
