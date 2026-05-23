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

/**
 * 存储键布局
 *
 * Bundled 模式：仅用 STORAGE_PREFIX_STATE + hash（hash 由 __QUESTIONS_HASH__ 注入）。
 * Library 模式：四种 key 都用。
 *
 *   {STORAGE_PREFIX_STATE}{hash}      每个题库一份 RuntimeState（StoredState 序列化）
 *   {STORAGE_PREFIX_QUESTIONS}{hash}  每个题库的原始 JSON（仅 library）
 *   {STORAGE_KEY_LIBRARY}             library 索引（BankSummary[]）
 *   {STORAGE_KEY_ACTIVE_BANK}         当前选中的 bank hash
 */
export const STORAGE_PREFIX_STATE = "quiz_app_state_";
export const STORAGE_PREFIX_QUESTIONS = "quiz_app_questions_";
export const STORAGE_KEY_LIBRARY = "quiz_app_library";
export const STORAGE_KEY_ACTIVE_BANK = "quiz_app_active_bank";

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

/**
 * 进度条样式配置
 */

// OKLCH 端点（贴合主题色 olive #81912F → mustard #F8C463）：
export const LEARNING_COLOR_LOW = { l: 0.65, c: 0.11, h: 124 };
export const LEARNING_COLOR_HIGH = { l: 0.82, c: 0.13, h: 80 };

export const PROGRESS_SIDE_CAP_PERCENT: number = 5;
