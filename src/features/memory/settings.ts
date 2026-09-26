/**
 * 记忆模式的按题库设置：默认值、边界与净化。
 *
 * 与刷题模式的 `src/bankSettings.ts` 并列，存进同一个题库进度对象
 * （`StoredState.memory`），因此导入 / 导出 / 重置都跟着题库走。
 */

import {
  MEMORY_DEFAULT_GRADUATE_LEVEL,
  MEMORY_DEFAULT_ROUND_TARGET,
  MEMORY_GRADUATE_LEVEL_BOUNDS,
  MEMORY_ROUND_TARGET_BOUNDS,
} from "./algorithm";
import type { MemoryBankSettings } from "@/types";

export const MEMORY_SETTINGS_BOUNDS = {
  graduateLevel: MEMORY_GRADUATE_LEVEL_BOUNDS,
  roundTarget: MEMORY_ROUND_TARGET_BOUNDS,
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

/** 代码内置的记忆模式按库设置默认值。 */
export function createDefaultMemorySettings(): MemoryBankSettings {
  return {
    graduateLevel: MEMORY_DEFAULT_GRADUATE_LEVEL,
    roundTarget: MEMORY_DEFAULT_ROUND_TARGET,
    // 默认沿用老规矩（每掌握一题补一题）：打开它是一次明确的选择
    lockRoundPool: false,
  };
}

/** 把任意来源（localStorage / 导入 / 旧版本）的设置净化为合法值。 */
export function sanitizeMemorySettings(
  value: unknown,
  fallback: MemoryBankSettings = createDefaultMemorySettings(),
): MemoryBankSettings {
  const raw = isRecord(value) ? value : {};

  return {
    graduateLevel: toBoundedInt(
      raw.graduateLevel,
      fallback.graduateLevel,
      MEMORY_SETTINGS_BOUNDS.graduateLevel.min,
      MEMORY_SETTINGS_BOUNDS.graduateLevel.max,
    ),
    roundTarget: toBoundedInt(
      raw.roundTarget,
      fallback.roundTarget,
      MEMORY_SETTINGS_BOUNDS.roundTarget.min,
      MEMORY_SETTINGS_BOUNDS.roundTarget.max,
    ),
    // 旧版本没有这个字段：只认真正的 true，其余（undefined / 字符串 / null）都是关
    lockRoundPool: raw.lockRoundPool === true,
  };
}
