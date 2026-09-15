<script lang="ts">
    import { SHORTCUTS } from "@/config";
    import { modKeyLabel } from "$lib/platform";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Switch } from "$lib/components/ui/switch";
    import { Label } from "$lib/components/ui/label";
    import logoRaw from "/assets/icons/logo.svg?raw";

    import { Separator } from "$lib/components/ui/separator";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import SyncSettings from "./SyncSettings.svelte";
    import { IconInfoCircle } from "@tabler/icons-svelte";
    import { toastStore } from "@/features/toast.svelte";
    import { globalSettingsStore } from "@/features/globalSettings.svelte";
    import { createSoundPlayer, setSoundEnabledPreference } from "@/sound";
    import type { SoundPlayer } from "@/sound/types";

    interface Props {
        open?: boolean;
    }

    let { open = $bindable(false) }: Props = $props();

    // 这个 dialog 挂在侧边栏，不依赖具体题库的 QuizSession，所以直接读写共享 store。
    const settings = globalSettingsStore;

    let soundPlayer: SoundPlayer | null = null;

    function ensureSoundPlayer(): SoundPlayer {
        soundPlayer ??= createSoundPlayer();
        return soundPlayer;
    }

    function showToast(
        title: string,
        description?: string,
        variant?: "default" | "success" | "destructive",
    ): void {
        toastStore.show(title, description, variant);
    }

    function setSoundEnabled(next: boolean): void {
        setSoundEnabledPreference(
            settings.value,
            next,
            () => settings.persist(),
            showToast,
            ensureSoundPlayer(),
        );
    }

    function toggleAutoNext(): void {
        const next = !settings.value.autoNextOnCorrect;
        settings.update({ autoNextOnCorrect: next });
        showToast(
            next ? "答对自动下一题已开启" : "答对自动下一题已关闭",
            next
                ? "答对后自动进入下一题。"
                : "答对后停留在结果页（按空格继续）。",
        );
    }

    function setAutoSubmitOnSelection(next: boolean): void {
        settings.update({ autoSubmitOnSelection: next });
    }
</script>


<Dialog.Root bind:open>
    <Dialog.Content
        class="bg-card flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
    >
        <Dialog.Header class="border-b px-5 py-3.5">
            <Dialog.Title class="text-base font-semibold">全局设置</Dialog.Title
            >
        </Dialog.Header>

        <div class="flex flex-col gap-4 overflow-y-auto px-5 py-4">
            <section class="flex flex-col gap-2.5">
                <div class="flex items-center justify-between gap-3">
                    <Label
                        for="global-sound-enabled"
                        class="flex items-center gap-2 text-sm font-normal"
                    >
                        音效
                        <KbdGroup class="text-[10px]">
                            <Kbd>{modKeyLabel}</Kbd>
                            <Kbd>{SHORTCUTS.toggleSound.toUpperCase()}</Kbd>
                        </KbdGroup>
                    </Label>
                    <Switch
                        id="global-sound-enabled"
                        checked={settings.value.soundEnabled}
                        onCheckedChange={(checked) => setSoundEnabled(checked)}
                        size="sm"
                    />
                </div>

                <div class="flex items-center justify-between gap-3">
                    <Label
                        for="global-auto-submit"
                        class="text-sm font-normal flex items-center gap-1"
                    >
                        选中答案自动提交
                        <Tooltip.Root>
                            <Tooltip.Trigger>
                                {#snippet child({ props })}
                                    <button
                                        {...props}
                                        type="button"
                                        class="text-muted-foreground hover:text-foreground inline-flex items-center justify-center"
                                        aria-label="关于自动提交"
                                    >
                                        <IconInfoCircle
                                            size={14}
                                            stroke={1.5}
                                        />
                                    </button>
                                {/snippet}
                            </Tooltip.Trigger>
                            <Tooltip.Content side="top" align="center">
                                <span class="flex items-center"
                                    >单选&thinsp;/&thinsp;判断&thinsp;题选中时，自动提交答案。
                                </span>
                            </Tooltip.Content>
                        </Tooltip.Root>
                    </Label>
                    <Switch
                        id="global-auto-submit"
                        checked={settings.value.autoSubmitOnSelection}
                        onCheckedChange={(checked) =>
                            setAutoSubmitOnSelection(checked)}
                        size="sm"
                    />
                </div>

                <div class="flex items-center justify-between gap-3">
                    <Label
                        for="global-auto-next"
                        class="flex items-center gap-2 text-sm font-normal"
                    >
                        答对自动下一题
                        <KbdGroup class="text-[10px]">
                            <Kbd>{modKeyLabel}</Kbd>
                            <Kbd>{SHORTCUTS.toggleAutoNext.toUpperCase()}</Kbd>
                        </KbdGroup>
                    </Label>
                    <Switch
                        id="global-auto-next"
                        checked={settings.value.autoNextOnCorrect}
                        onCheckedChange={() => toggleAutoNext()}
                        size="sm"
                    />
                </div>
            </section>

            <Separator />

            <SyncSettings />

            <Separator />

            <!-- 水印式落款：压到面板最底部，只做装饰，不参与阅读顺序 -->
            <div
                class="text-muted-foreground/50 flex flex-col items-center gap-2 pt-1 pb-2 select-none"
                aria-hidden="true"
            >
                <div
                    class="[&_svg]:h-3.5 [&_svg]:w-auto"
                    aria-label="Quiz! aPP."
                >
                    {@html logoRaw}
                </div>
            </div>
        </div>
    </Dialog.Content>
</Dialog.Root>
