/**
 * 全局设置里那几个「开关型」偏好的统一入口。
 *
 * 这三个动作（音效 / 答中自动下一题 / 选中自动提交）写在 `GlobalSettings` 面板上，
 * 但做题界面的快捷键也要能按到——以前 `QuizSession`、`MemorySession`、
 * `GlobalSettings.svelte` 各写了一遍（文案、持久化、试听逻辑还各不相同），
 * 于是记忆模式漏了 ⌘N / ⌘S 两个键。这里收成一份，谁要就调这里。
 */

import type { GlobalSettingsStore } from "@/features/globalSettings.svelte";
import type { Toast } from "@/features/toast.svelte";
import { setSoundEnabledPreference } from "@/sound";
import type { SoundPlayer } from "@/sound/types";

/** 设成指定值：开启时试听一声，并提示结果。 */
export function applySoundEnabledPreference(
  store: GlobalSettingsStore,
  next: boolean,
  toast: Toast,
  player: SoundPlayer,
): void {
  setSoundEnabledPreference(
    store.value,
    next,
    () => store.persist(),
    toast,
    player,
  );
}

/** ⌘S：翻转音效开关。 */
export function toggleSoundPreference(
  store: GlobalSettingsStore,
  toast: Toast,
  player: SoundPlayer,
): void {
  applySoundEnabledPreference(store, !store.value.soundEnabled, toast, player);
}

/** ⌘N：翻转「答对自动下一题」。 */
export function toggleAutoNextPreference(
  store: GlobalSettingsStore,
  toast: Toast,
): void {
  const next = !store.value.autoNextOnCorrect;
  store.update({ autoNextOnCorrect: next });
  toast(
    next ? "答对自动下一题已开启" : "答对自动下一题已关闭",
    next ? "答对后自动进入下一题。" : "答对后停留在结果页（按空格继续）。",
  );
}
