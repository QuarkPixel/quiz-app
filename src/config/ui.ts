/** UI 动画 / 计时常量 */

/** 背景闪烁动画时长（毫秒） */
export const FLASH_ANIMATION_DURATION = 6000;

/** 「再次点击以确认」类按钮的回退超时（毫秒）。
 *  超时后 confirming 状态自动复位，避免用户长时间未操作后误触。
 */
export const CONFIRM_TIMEOUT_MS = 3000;

/** mastered 进度条段「庆祝」动画时长（毫秒）。需要和 CSS 里的 animation duration 保持一致。 */
export const MASTERED_CELEBRATE_DURATION_MS = 700;

/** Toast 可见时长（毫秒）。 */
export const TOAST_DURATION_MS = 2200;

/** Toast 淡出后清理 DOM 节点的延迟（毫秒）。 */
export const TOAST_FADE_MS = 250;

/** 「导出已复制」按钮回到 idle 状态的延迟（毫秒）。 */
export const EXPORT_STATUS_SUCCESS_RESET_MS = 2000;

/** 「导出失败」按钮回到 idle 状态的延迟（毫秒）。 */
export const EXPORT_STATUS_ERROR_RESET_MS = 3000;

/** 活动池列表项的 flip / in 动画时长（毫秒）。 */
export const POOL_ITEM_FLIP_DURATION_MS = 420;

/** 活动池列表项的 out 动画时长（毫秒）。 */
export const POOL_ITEM_OUT_DURATION_MS = 260;
