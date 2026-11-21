/**
 * 全局设置：跨题库共享的偏好。
 *
 * 存于 general 配置的 `globalSettings`。这些偏好和具体题库无关，
 * 切换 / 导入题库都不应改变它们。
 */

import {
  SOUND_ENABLED_BY_DEFAULT,
  SOUND_VOLUME_DEFAULT,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
} from "./config";
import type { GlobalSettings } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 代码内置的全局设置默认值。 */
export function createDefaultGlobalSettings(): GlobalSettings {
  return {
    soundEnabled: SOUND_ENABLED_BY_DEFAULT,
    soundVolume: SOUND_VOLUME_DEFAULT,
    autoSubmitOnSelection: true,
    autoNextOnCorrect: false,
  };
}

function toFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/**
 * 音量只接受有限的数字，并钳到 0–1；保留两位小数（滑块步长 0.05，
 * 两位足够，也避免 `0.30000000000000004` 这种值写进配置）。
 */
export function sanitizeSoundVolume(
  value: unknown,
  fallback: number = SOUND_VOLUME_DEFAULT,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, value));
  return Math.round(clamped * 100) / 100;
}

/** 把任意来源的全局设置净化为合法的 GlobalSettings。 */
export function sanitizeGlobalSettings(value: unknown): GlobalSettings {
  const defaults = createDefaultGlobalSettings();
  const raw = isRecord(value) ? value : {};

  return {
    soundEnabled: toFlag(raw.soundEnabled, defaults.soundEnabled),
    soundVolume: sanitizeSoundVolume(raw.soundVolume, defaults.soundVolume),
    autoSubmitOnSelection: toFlag(
      raw.autoSubmitOnSelection,
      defaults.autoSubmitOnSelection,
    ),
    autoNextOnCorrect: toFlag(raw.autoNextOnCorrect, defaults.autoNextOnCorrect),
  };
}
