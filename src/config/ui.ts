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

/** 活动池里「答案在这张卡上」的指示点展示时长（毫秒）。 */
export const POOL_ANSWER_POINTER_REVEAL_MS = 3000;

/** 活动池里判定「这是一次点击而不是拖动」的位移容差（像素）。 */
export const POOL_ANSWER_POINTER_TAP_TOLERANCE_PX = 10;

/**
 * 「复制题目」反馈（按钮变色 / 快捷键 toast）回到 idle 的延迟（毫秒）。
 *
 * 三个地方共用这一个值：`QuizSession`、`MemorySession`、
 * `QuestionCopyStatusStore`——以前是三处各写一个 `1800`。
 */
export const COPY_STATUS_RESET_MS = 1800;

/** 总览里从热力图跳到某道卡时，高亮那一下的时长（毫秒）。 */
export const CARD_HIGHLIGHT_MS = 1600;

/**
 * 首屏之后预热「全局设置」面板的延迟（毫秒）。
 * 支持 `requestIdleCallback` 的浏览器走 idle 回调，这条只是兜底。
 */
export const IDLE_PREFETCH_MS = 2000;

/** 「回到顶部」按钮的出现阈值（像素）：滚过这么多才显示。 */
export const SCROLL_TOP_THRESHOLD_PX = 256;
