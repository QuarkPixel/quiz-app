/**
 * 存储键布局
 *
 *   {STORAGE_KEY_GENERAL}            唯一的 general 配置
 *                                    { activeBank, defaultSettings, library, globalSettings }
 *   {STORAGE_PREFIX_QUESTIONS}{hash} 每个题库的题目数组 JSON
 *   {STORAGE_PREFIX_STATE}{hash}     每个题库的 StoredState 序列化（进度 + 按库设置 + UI 偏好）
 *
 * 只有 general 配置和每个题库的内容 / 进度，不再有其它离散的配置键。
 */
export const STORAGE_KEY_GENERAL = "quiz_app_general";
export const STORAGE_PREFIX_QUESTIONS = "quiz_app_questions_";
export const STORAGE_PREFIX_STATE = "quiz_app_state_";

/**
 * 旧版（拆分键）布局，仅用于首次加载时的一次性迁移。
 * 迁移完成后会把它们从 localStorage 里删除。
 */
export const LEGACY_STORAGE_KEY_LIBRARY = "quiz_app_library";
export const LEGACY_STORAGE_KEY_ACTIVE_BANK = "quiz_app_active_bank";
export const LEGACY_STORAGE_KEY_DEFAULT_SETTINGS = "quiz_app_default_settings";
