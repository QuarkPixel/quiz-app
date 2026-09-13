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

const STORAGE_KEY = "quiz_app_debug_day_offset";

/** 当前累积的快进天数（读完即忘，只用于 UI 显示） */
export function devDayOffset(): number {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? Number(raw) || 0 : 0;
}

/** 在 Date.now() 的基础上加上已经快进的天数 */
export function devNow(dayOffset: number): number {
  return Date.now() + dayOffset * 86_400_000;
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
