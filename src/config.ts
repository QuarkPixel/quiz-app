/**
 * 学习算法配置
 * 可通过修改这些常量来调整学习行为
 */

/** 活动题目池大小 */
export const ACTIVE_POOL_SIZE = 25;

/** 从未答错时，需要连续答对的次数才能掌握 */
export const CORRECT_STREAK_TO_MASTER = 3;

/** 答错后，需要连续答对的次数才能掌握 */
export const CORRECT_STREAK_AFTER_MISTAKE = 4;

/** 存储键 */
export const STORAGE_KEY = "quiz_app_state";

/** 背景闪烁动画时长（毫秒） */
export const FLASH_ANIMATION_DURATION = 6000;
