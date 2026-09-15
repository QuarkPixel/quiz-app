/**
 * 存储键布局
 *
 *   {STORAGE_KEY_GENERAL}            唯一的 general 配置
 *                                    { activeBank, defaultSettings, library, globalSettings }
 *   {STORAGE_PREFIX_QUESTIONS}{hash} 每个题库的题目数组 JSON
 *   {STORAGE_PREFIX_STATE}{hash}     每个题库的 StoredState 序列化（进度 + 按库设置 + UI 偏好）
 *   {STORAGE_KEY_SYNC_CONFIG}        云同步的令牌 + 目标 Gist（**不上传**）
 *   {STORAGE_KEY_SYNC_META}          同步元数据（基准线，**不上传**）
 *   {SYNC_STORAGE_PREFIX}*           同步过程中落盘的辅助键，一律不进云端
 *
 * 只有 general 配置和每个题库的内容 / 进度，不再有其它离散的配置键。
 */
export const STORAGE_KEY_GENERAL = "quiz_app_general";
export const STORAGE_PREFIX_QUESTIONS = "quiz_app_questions_";
export const STORAGE_PREFIX_STATE = "quiz_app_state_";

/** 云同步配置（令牌 + 目标 Gist）。凭据就在这里，绝不进云端。 */
export const STORAGE_KEY_SYNC_CONFIG = "quiz_app_sync_config";

/** 云同步元数据：各题库的同步基准线、上次同步时间。 */
export const STORAGE_KEY_SYNC_META = "quiz_app_sync_meta";

/** 同步辅助键的公共前缀：白名单按它判定「哪些键不进云端」。 */
export const SYNC_STORAGE_PREFIX = "quiz_app_sync_";

/**
 * 旧版（拆分键）布局，仅用于首次加载时的一次性迁移。
 * 迁移完成后会把它们从 localStorage 里删除。
 */
export const LEGACY_STORAGE_KEY_LIBRARY = "quiz_app_library";
export const LEGACY_STORAGE_KEY_ACTIVE_BANK = "quiz_app_active_bank";
export const LEGACY_STORAGE_KEY_DEFAULT_SETTINGS = "quiz_app_default_settings";
