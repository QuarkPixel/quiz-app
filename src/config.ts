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

/**
 * 英语习题中常见的占位词（规范化为纯字母序列）。
 * 这些词用户不输入也算正确（视为可选 Group 节点）。
 *
 * 原始形式 → 规范化：
 *   sb       → sb
 *   sth      → sth
 *   sb's     → sbs
 *   one's / ones → ones
 *   oneself  → oneself
 *   doing    → doing
 *   to do    → todo
 */

export const PLACEHOLDER_WORDS: readonly string[] = [
  "sb",
  "sth",
  "sp",
  "sbs", // sb's
  "ones", // one's / ones
  "oneself",
  "doing",
  "todo", // to do（连在一起的字母序列）
];

// OKLCH 端点：
//   level = 1（接近掌握）—— 偏黄绿色，与"已完成"绿色相邻
//   level = maxLevel（刚开始或刚答错）—— 偏橙红色，与"待学习"灰色相邻
export const LEARNING_COLOR_LOW = { l: 0.787, c: 0.1898, h: 121.66 };
export const LEARNING_COLOR_HIGH = { l: 0.7455, c: 0.1636, h: 44.92 };

export const PROGRESS_SIDE_CAP_PERCENT: number = 5;
