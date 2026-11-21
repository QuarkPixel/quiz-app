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
 * **这里不要 export `service.ts` 里的任何东西**（比如 `createSoundService`）：
 * 它是唯一 import uisfx 的模块，静态导出会把整份合成配方拉回主包。引擎由
 * `app.ts` 在页面空闲时 `import()`，业务只认识 `appSound`。（下面那些类型来自
 * `types.ts`，只有类型、没有运行时代价。）
 *
 * 也不要在这里再加 `playAnswer` / `playSuccess` 这类按「旧音效文件」命名的
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
export type {
  SoundGestureTarget,
  SoundPlayOptions,
  SoundPlayer,
  SoundPreferences,
  SoundService,
} from "./types";
