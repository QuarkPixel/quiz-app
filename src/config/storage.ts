/**
 * 存储键布局
 *
 * Bundled 模式：仅用 STORAGE_PREFIX_STATE + hash（hash 由 __QUESTIONS_HASH__ 注入）。
 * Library 模式：四种 key 都用。
 *
 *   {STORAGE_PREFIX_STATE}{hash}      每个题库一份 StoredState 序列化
 *   {STORAGE_PREFIX_QUESTIONS}{hash}  每个题库的原始 JSON（仅 library）
 *   {STORAGE_KEY_LIBRARY}             library 索引（BankSummary[]）
 *   {STORAGE_KEY_ACTIVE_BANK}         当前选中的 bank hash
 *   {STORAGE_KEY_DEFAULT_SETTINGS}    新题库 / fallback 使用的默认 UserSettings
 */
export const STORAGE_PREFIX_STATE = "quiz_app_state_";
export const STORAGE_PREFIX_QUESTIONS = "quiz_app_questions_";
export const STORAGE_KEY_LIBRARY = "quiz_app_library";
export const STORAGE_KEY_ACTIVE_BANK = "quiz_app_active_bank";
export const STORAGE_KEY_DEFAULT_SETTINGS = "quiz_app_default_settings";
