/**
 * 全局设置：跨题库共享的偏好。
 *
 * 存于 general 配置的 `globalSettings`。这些偏好和具体题库无关，
 * 切换 / 导入题库都不应改变它们。
 */

import { SOUND_ENABLED_BY_DEFAULT } from "./config";
import type { GlobalSettings } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 代码内置的全局设置默认值。 */
export function createDefaultGlobalSettings(): GlobalSettings {
  return {
    soundEnabled: SOUND_ENABLED_BY_DEFAULT,
    autoSubmitOnSelection: true,
    autoNextOnCorrect: false,
  };
}

function toFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** 把任意来源的全局设置净化为合法的 GlobalSettings。 */
export function sanitizeGlobalSettings(value: unknown): GlobalSettings {
  const defaults = createDefaultGlobalSettings();
  const raw = isRecord(value) ? value : {};

  return {
    soundEnabled: toFlag(raw.soundEnabled, defaults.soundEnabled),
    autoSubmitOnSelection: toFlag(
      raw.autoSubmitOnSelection,
      defaults.autoSubmitOnSelection,
    ),
    autoNextOnCorrect: toFlag(raw.autoNextOnCorrect, defaults.autoNextOnCorrect),
  };
}
