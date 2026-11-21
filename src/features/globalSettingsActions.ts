/**
 * 全局设置里那几个「开关型」偏好的统一入口。
 *
 * 这些动作（音效 / 音量 / 答中自动下一题）写在 `GlobalSettings` 面板上，
 * 但做题界面的快捷键也要能按到——以前 `QuizSession`、`MemorySession`、
 * `GlobalSettings.svelte` 各写了一遍（文案、持久化、试听逻辑还各不相同），
 * 于是记忆模式漏了 ⌘N / ⌘S 两个键。这里收成一份，谁要就调这里。
 *
 * 音效服务从参数注入（而不是在这里 import 单例）：面板 / 会话用的是同一个
 * `appSound`，测试则塞一个假的进来断言「开 / 关 / 试听」的顺序。
 */

import type { GlobalSettingsStore } from "@/features/globalSettings.svelte";
import type { Toast } from "@/features/toast.svelte";
import { sanitizeSoundVolume } from "@/globalSettings";
import type { SoundService } from "@/sound";

/** 设成指定值：开启时试听一声，并提示结果。 */
export function applySoundEnabledPreference(
  store: GlobalSettingsStore,
  next: boolean,
  toast: Toast,
  sound: SoundService,
): void {
  if (store.value.soundEnabled === next) return;

  store.update({ soundEnabled: next });
  // 先让播放器跟上开关，再试听：关掉时 `applyPreferences` 会 stopAll，
  // 不能反过来（否则试听声会被立刻掐掉，或者关了还在响）。
  sound.applyPreferences(store.value);
  if (next) sound.play("sound-enabled");
  toast(next ? "音效已开启" : "音效已关闭");
}

/** ⌘S：翻转音效开关。 */
export function toggleSoundPreference(
  store: GlobalSettingsStore,
  toast: Toast,
  sound: SoundService,
): void {
  applySoundEnabledPreference(store, !store.value.soundEnabled, toast, sound);
}

/**
 * 设置主音量（0–1）。
 *
 * **每一档都落盘并立刻试听**：音量滑块不是「松手才生效」的表单，拖动过程中
 * 必须听到新音量（官方 demo 也是 `input` 就 `volume-change`）。一次拖动只有
 * 二十来档、每档一次 localStorage 写入，代价可以忽略；换来的是所见即所听。
 *
 * `retrigger: "restart"` 让快速拖动只保留最后一声，`cooldownMs: 45` 限制
 * 连续 trigger 的密度（与官方 demo 的 `VOLUME_PREVIEW_PLAY_OPTIONS` 同口径）。
 */
export function setSoundVolumePreference(
  store: GlobalSettingsStore,
  next: number,
  sound: SoundService,
): void {
  const volume = sanitizeSoundVolume(next, store.value.soundVolume);
  if (store.value.soundVolume === volume) return;

  store.update({ soundVolume: volume });
  sound.applyPreferences(store.value);
  if (volume > 0) {
    sound.play("volume-changed", {
      cooldownMs: 45,
      retrigger: "restart",
    });
  }
}

/** ⌘N：翻转「答对自动下一题」。 */
export function toggleAutoNextPreference(
  store: GlobalSettingsStore,
  toast: Toast,
  sound: SoundService,
): void {
  const next = !store.value.autoNextOnCorrect;
  store.update({ autoNextOnCorrect: next });
  sound.play(next ? "setting-toggle-on" : "setting-toggle-off");
  toast(
    next ? "答对自动下一题已开启" : "答对自动下一题已关闭",
    next ? "答对后自动进入下一题。" : "答对后停留在结果页（按空格继续）。",
  );
}
