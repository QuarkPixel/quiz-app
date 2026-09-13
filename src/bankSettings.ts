/**
 * 按题库的学习设置：默认值、边界与净化。
 *
 * 这里只保留「跟着题库走」的设置。音效 / 选中自动提交 / 答对自动下一题
 * 属于全局设置，见 `src/globalSettings.ts`。
 */

import {
  ACTIVE_POOL_SIZE,
  CORRECT_STREAK_AFTER_MISTAKE,
  CORRECT_STREAK_TO_MASTER,
} from "./config";
import type { BankSettings } from "./types";

export const BANK_SETTINGS_BOUNDS = {
  activePoolSize: { min: 5, max: 100 },
  correctStreakToMaster: { min: 1, max: 10 },
  correctStreakAfterMistake: { min: 1, max: 20 },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;

  const rounded = Math.round(numberValue);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}

/** 代码内置的按库设置默认值。 */
export function createDefaultBankSettings(): BankSettings {
  return {
    activePoolSize: ACTIVE_POOL_SIZE,
    correctStreakToMaster: CORRECT_STREAK_TO_MASTER,
    correctStreakAfterMistake: CORRECT_STREAK_AFTER_MISTAKE,
    selectionMode: "random",
    notifyNewQuestionInPool: false,
  };
}

/**
 * 把任意来源（localStorage、导入、旧版本）的设置净化为合法的 BankSettings。
 * 显式挑选字段，避免旧版残留的全局字段（autoNextOnCorrect 等）混进来。
 *
 * @param fallback 缺失 / 非法字段的回退值。默认是代码内置默认；
 *                 读取某个题库的 state 时传入 general 配置里的默认模板，
 *                 好让部分缺失的旧进度继承用户当前的按库默认设置。
 */
export function sanitizeBankSettings(
  value: unknown,
  fallback: BankSettings = createDefaultBankSettings(),
): BankSettings {
  const raw = isRecord(value) ? value : {};
  const rawSelectionMode = raw.selectionMode;

  return {
    activePoolSize: toBoundedInt(
      raw.activePoolSize,
      fallback.activePoolSize,
      BANK_SETTINGS_BOUNDS.activePoolSize.min,
      BANK_SETTINGS_BOUNDS.activePoolSize.max,
    ),
    correctStreakToMaster: toBoundedInt(
      raw.correctStreakToMaster,
      fallback.correctStreakToMaster,
      BANK_SETTINGS_BOUNDS.correctStreakToMaster.min,
      BANK_SETTINGS_BOUNDS.correctStreakToMaster.max,
    ),
    correctStreakAfterMistake: toBoundedInt(
      raw.correctStreakAfterMistake,
      fallback.correctStreakAfterMistake,
      BANK_SETTINGS_BOUNDS.correctStreakAfterMistake.min,
      BANK_SETTINGS_BOUNDS.correctStreakAfterMistake.max,
    ),
    selectionMode:
      rawSelectionMode === "sequential" || rawSelectionMode === "random"
        ? rawSelectionMode
        : fallback.selectionMode,
    notifyNewQuestionInPool:
      typeof raw.notifyNewQuestionInPool === "boolean"
        ? raw.notifyNewQuestionInPool
        : fallback.notifyNewQuestionInPool,
  };
}
