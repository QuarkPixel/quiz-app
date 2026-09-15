<script lang="ts">
    import { SHORTCUTS } from "@/config";
    import { modKeyLabel } from "$lib/platform";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Button } from "$lib/components/ui/button";
    import ConfirmActionButton from "$lib/components/ConfirmActionButton.svelte";
    import { Switch } from "$lib/components/ui/switch";
    import { Label } from "$lib/components/ui/label";
    import { Separator } from "$lib/components/ui/separator";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import QuestionFilters from "./QuestionFilters.svelte";
    import ShortcutHelp from "./ShortcutHelp.svelte";
    import IconCopy from "@tabler/icons-svelte/icons/copy";
    import IconClipboard from "@tabler/icons-svelte/icons/clipboard";
    import IconRefresh from "@tabler/icons-svelte/icons/refresh";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { useQuizSession } from "@/quiz/session/context";
    import QuestionOrder from "./QuestionOrder.svelte";
    import BankNameSetting from "./BankNameSetting.svelte";
    import { IconInfoCircle } from "@tabler/icons-svelte";
    import { getLearningLevelColor } from "@/features/quiz/learningProgress";
    import SettingsDialog from "./SettingsDialog.svelte";
    import SettingsSection from "./SettingsSection.svelte";
    import SettingNumberRow from "./SettingNumberRow.svelte";

    interface Props {
        open?: boolean;
        /** 当前题库 hash（用于修改名称） */
        hash: string;
        /** 当前题库名称 */
        bankName: string;
    }

    let { open = $bindable(false), hash, bankName }: Props = $props();

    const session = useQuizSession();
    let resetButton: ConfirmActionButton;
    const pendingFilterLabel = $derived(
        session.pendingFilterType === null
            ? ""
            : (session.filterOptions.find(
                  (option) => option.key === session.pendingFilterType,
              )?.label ?? "新筛选"),
    );

    $effect(() => {
        if (!open) {
            resetButton?.reset();
        }
    });
</script>

<SettingsDialog bind:open>
    <BankNameSetting {hash} name={bankName} />

    <!-- ── 当前题库设置：跟着题库走。全局设置在侧边栏左下角 ── -->
    <SettingsSection title="题型筛选">
        <QuestionFilters
            options={session.filterOptions}
            activeType={session.appState.filterType}
            onSelect={(t) => session.setFilter(t)}
        />
    </SettingsSection>

    <Separator />

    <SettingsSection title="刷题顺序">
        <QuestionOrder
            activeOrder={session.appState.settings.selectionMode}
            onSelect={(v) => {
                session.appState.settings.selectionMode = v;
                session.handleAlgorithmChange();
            }}
        />
    </SettingsSection>

    <Separator />

    <SettingsSection title="答题行为">
        <div class="flex items-center justify-between gap-3">
            <Label
                for="notify-new-question"
                class="text-sm font-normal flex items-center gap-1"
            >
                新题入池时预览
                <Tooltip.Root>
                    <Tooltip.Trigger>
                        {#snippet child({ props })}
                            <button
                                {...props}
                                type="button"
                                class="text-muted-foreground hover:text-foreground inline-flex items-center justify-center"
                                aria-label="关于新题入池预览"
                            >
                                <IconInfoCircle size={14} stroke={1.5} />
                            </button>
                        {/snippet}
                    </Tooltip.Trigger>
                    <Tooltip.Content side="top" align="center">
                        <span class="max-w-56 text-pretty">
                            有新题进入活动题池时插入预览
                        </span>
                    </Tooltip.Content>
                </Tooltip.Root>
            </Label>
            <Switch
                id="notify-new-question"
                bind:checked={
                    session.appState.settings.notifyNewQuestionInPool
                }
                onCheckedChange={() => session.handlePreferenceChange()}
                size="sm"
            />
        </div>
    </SettingsSection>

    <Separator />

    <SettingsSection title="学习算法">
        <SettingNumberRow
            id="pool-size"
            label="活动题目池大小"
            min={5}
            max={100}
            bind:value={session.appState.settings.activePoolSize}
            onChange={() => session.handleAlgorithmChange()}
        >
            <div class="w-8 h-1 flex rounded-full overflow-hidden">
                {#each [0, 1, 2] as level}
                    <div
                        style:background-color={getLearningLevelColor(level, 2)}
                        class="h-full w-1/3"
                    ></div>
                {/each}
            </div>
        </SettingNumberRow>
        <SettingNumberRow
            id="streak-master"
            label="首次掌握需正确次数"
            min={1}
            max={10}
            bind:value={session.appState.settings.correctStreakToMaster}
            onChange={() => session.handleAlgorithmChange()}
        >
            <div class="w-2 h-2 bg-success rounded-full"></div>
        </SettingNumberRow>
        <SettingNumberRow
            id="streak-mistake"
            label="答错后需正确次数"
            min={1}
            max={20}
            bind:value={session.appState.settings.correctStreakAfterMistake}
            onChange={() => session.handleAlgorithmChange()}
        >
            <div class="w-2 h-2 bg-warning rounded-full"></div>
        </SettingNumberRow>
    </SettingsSection>

    <Separator />

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
    </SettingsSection>

    <Separator />

    <!-- 快捷键说明：与记忆模式的设置面板共用同一个组件，
         应用级那部分直接读 `@/config` 的注册表 -->
    <ShortcutHelp
        answerRows={[
            { label: "提交答案 / 下一题", keys: ["Space", "Enter"] },
            // 字母与数字都能选中选项（见题型层的 getChoiceAnswerIndexForKey）。
            // 合成一行写：拆成字母 / 数字两行会出现两行同名，既难读也容易被当成重复项
            { label: "选择 / 切换选项", keys: ["A–Z", "1–9"] },
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
            {confirming ? "再次点击以确认" : "重置所有进度"}
        {/snippet}
    </ConfirmActionButton>
</SettingsDialog>

<Dialog.Root
    open={session.pendingFilterType !== null}
    onOpenChange={(nextOpen) => {
        if (!nextOpen) session.cancelPendingFilterChange();
    }}
>
    <Dialog.Content class="max-w-sm">
        <Dialog.Header>
            <Dialog.Title>处理当前活动题池</Dialog.Title>
            <Dialog.Description>
                当前活动题池里有已展示过、但不属于「{pendingFilterLabel}」的题目。未展示题会按新筛选重新入池。
            </Dialog.Description>
        </Dialog.Header>
        <Dialog.Footer>
            <Button
                variant="outline"
                onclick={() => session.confirmPendingFilterChange("keep-shown")}
            >
                保留当前题目
            </Button>
            <Button
                variant="destructive"
                onclick={() =>
                    session.confirmPendingFilterChange("clear-active-pool")}
            >
                清空活动题池
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>
