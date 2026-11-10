/**
 * 临时调试用：让记忆模式的时间「快进」若干天，方便检验复习曲线。
 *
 * 删除方式（三处，全部删完即与原始代码一致）：
 *   1. 删掉本文件
 *   2. `MemorySession.svelte.ts` 里删掉 `devClock` 的 import、`debugAddDay()` /
 *      `debugDayOffset` / `debugResetDays()`，并把 `debugOffset` 字段、`now`
 *      getter 里的 `devNow(this.debugOffset)` 换回 `Date.now()`（测试用的
 *      `fixedNow` 要保留）
 *   3. `MemorySettings.svelte` 里删掉「时间修改」那一段（含 devAddDay 的 import）
 */

import { addDayKeys, dayAnchor, dayKeyOf } from "./day";
import { studyDay } from "./algorithm";

const STORAGE_KEY = "quiz_app_debug_day_offset";

/** 当前累积的快进天数（读完即忘，只用于 UI 显示） */
export function devDayOffset(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? Number(raw) || 0 : 0;
}

/**
 * 在 `Date.now()` 的基础上加上已经快进的天数。
 *
 * **按「学习日」快进，不是按 24 小时**：直接 `+ n * 86_400_000` 在凌晨 0–5 点
 * 会让时钟落在同一个学习日里（3 点 + 24h 还是 3 点，减 5 小时又回到前一天），
 * 表现成「点了加一天，界面没反应」。
 *
 * 这里先把当前时刻换算成「学习日内偏移」（以凌晨 5 点为 0），
 * 再落到目标学习日的 0 点 + 同一个偏移上：
 *   3 点（属于前一天）→ 目标学习日的 3 点，仍然是那个学习日
 *   10 点 → 目标学习日的 10 点
 */
export function devNow(dayOffset: number): number {
  if (!dayOffset) return Date.now();
  const now = Date.now();
  const targetKey = addDayKeys(dayKeyOf(now), dayOffset);
  const offsetInStudyDay = now - studyDay(now);
  return dayAnchor(targetKey) + offsetInStudyDay;
}

/** 快进一天 */
export function devAddDay(): number {
  const next = devDayOffset() + 1;
  localStorage.setItem(STORAGE_KEY, String(next));
  return next;
}

/** 清零 */
export function devResetDays(): void {
  localStorage.removeItem(STORAGE_KEY);
}
