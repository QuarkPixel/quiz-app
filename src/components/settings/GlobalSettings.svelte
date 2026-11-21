<script lang="ts">
    import {
        APP_SHORTCUTS,
        SOUND_VOLUME_MAX,
        SOUND_VOLUME_MIN,
        SOUND_VOLUME_STEP,
    } from "@/config";
    import { modKeyLabel } from "$lib/platform";
    import * as Dialog from "$lib/components/ui/dialog";
    import { Switch } from "$lib/components/ui/switch";
    import { Label } from "$lib/components/ui/label";
    import * as Slider from "$lib/components/ui/slider";
    import logoRaw from "/assets/icons/logo.svg?raw";

    import { Separator } from "$lib/components/ui/separator";
    import { Kbd, KbdGroup } from "$lib/components/ui/kbd";
    import * as Tooltip from "$lib/components/ui/tooltip";
    import { prefersReducedMotion } from "$lib/utils";
    import { slide } from "svelte/transition";
    import { cubicOut } from "svelte/easing";
    import SyncSettings from "./SyncSettings.svelte";
    import IconInfoCircle from "@tabler/icons-svelte/icons/info-circle";
    import { toastStore } from "@/features/toast.svelte";
    import { globalSettingsStore } from "@/features/globalSettings.svelte";
    import {
        applySoundEnabledPreference,
        setSoundVolumePreference,
        toggleAutoNextPreference,
    } from "@/features/globalSettingsActions";
    import { appSound, attachOverlaySound, playSettingToggle } from "@/sound";

    interface Props {
        open?: boolean;
    }

    let { open = $bindable(false) }: Props = $props();

    // 这个 dialog 挂在侧边栏，不依赖具体题库的 QuizSession，所以直接读写共享 store。
    const settings = globalSettingsStore;

    // 浮层的开合由状态驱动（图标 / ⌘⇧I / 任何 show() 都走同一条）。
    attachOverlaySound(() => open);

    function showToast(
        title: string,
        description?: string,
        variant?: "default" | "success" | "destructive",
    ): void {
        toastStore.show(title, description, variant);
    }

    function setSoundEnabled(next: boolean): void {
        applySoundEnabledPreference(settings, next, showToast, appSound);
    }

    function setSoundVolume(next: number): void {
        setSoundVolumePreference(settings, next, appSound);
    }

    function toggleAutoNext(): void {
        toggleAutoNextPreference(settings, showToast, appSound);
    }

    function setAutoSubmitOnSelection(next: boolean): void {
        settings.update({ autoSubmitOnSelection: next });
        playSettingToggle(next);
    }
</script>

<Dialog.Root bind:open>
    <Dialog.Content
        class="bg-card flex max-h-[calc(100vh-4rem)] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
    >
        <Dialog.Header class="border-b px-5 py-3.5">
            <Dialog.Title class="text-base font-semibold">
                全局设置
            </Dialog.Title>
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
                            <Kbd>{APP_SHORTCUTS.toggleSound.kbd}</Kbd>
                        </KbdGroup>
                    </Label>
                    <Switch
                        id="global-sound-enabled"
                        checked={settings.value.soundEnabled}
                        onCheckedChange={(checked) => setSoundEnabled(checked)}
                        size="sm"
                    />
                </div>

                <!--
                    音量是音效的附属项：关掉音效时整行不出现，开关与下一项之间
                    仍走 section 的统一 gap；打开时才用 mb-1.5 把「音效 + 音量」
                    这一组和下一项隔开，看上去像这一项长出来的子选项。
                -->
                {#if settings.value.soundEnabled}
                    <div
                        class="mb-1.5 flex items-center justify-between gap-3"
                        transition:slide={{
                            duration: prefersReducedMotion ? 0 : 180,
                            easing: cubicOut,
                        }}
                    >
                        <Label
                            for="global-sound-volume"
                            class="text-muted-foreground text-xs font-normal"
                        >
                            音量
                        </Label>
                        <div class="flex items-center gap-2">
                            <Slider.Root
                                type="single"
                                min={SOUND_VOLUME_MIN}
                                max={SOUND_VOLUME_MAX}
                                step={SOUND_VOLUME_STEP}
                                value={settings.value.soundVolume}
                                onValueChange={(value) => setSoundVolume(value)}
                                class="w-28 sm:w-32"
                            >
                                {#snippet children({ thumbs })}
                                    <span
                                        data-orientation="horizontal"
                                        class="bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full"
                                    >
                                        <Slider.Range />
                                    </span>
                                    {#each thumbs as thumb (thumb)}
                                        <Slider.Thumb
                                            id="global-sound-volume"
                                            index={thumb}
                                            aria-label="音效音量"
                                        />
                                    {/each}
                                {/snippet}
                            </Slider.Root>
                            <span
                                class="text-muted-foreground w-9 text-right text-xs tabular-nums"
                            >
                                {Math.round(settings.value.soundVolume * 100)}%
                            </span>
                        </div>
                    </div>
                {/if}

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
                                <span class="flex items-center">
                                    单选&thinsp;/&thinsp;判断&thinsp;题选中时，自动提交答案。
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
                            <Kbd>{APP_SHORTCUTS.toggleAutoNext.kbd}</Kbd>
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
