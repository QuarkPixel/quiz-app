/**
 * 音效模块的统一出口。
 *
 * 业务代码通常只用这几样：
 *   - `appSound.play("语义事件")` —— 播放；
 *   - `playSettingToggle` / `playSettingChoice` / `playSettingDeselect` /
 *     `playSettingStep` —— 设置项交互（开关 / 选中 / 取消 / 数值档位）；
 *   - `playHeatmapHover` / `playHeatmapJump` —— 热力图的悬停与跳转；
 *   - `attachOverlaySound(() => open)` —— 浮层开合。
 *
 * 不要在这里再加 `playAnswer` / `playSuccess` 这类按「旧音效文件」命名的
 * 快捷函数：语义事件表已经足够表达，多一层别名就会慢慢长出第二套命名。
 */

export { appSound } from "./app";
export {
  playHeatmapHover,
  playHeatmapJump,
} from "./heatmap";
export { attachOverlaySound } from "./overlay.svelte";
export {
  playSettingChoice,
  playSettingDeselect,
  playSettingStep,
  playSettingToggle,
} from "./settings";
export {
  SOUND_CUES,
  SOUND_PACK,
  type AppSoundEvent,
} from "./cues";
export { createSoundService } from "./service";
export type {
  SoundGestureTarget,
  SoundPlayOptions,
  SoundPreferences,
  SoundService,
} from "./types";
