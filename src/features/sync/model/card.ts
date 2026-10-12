/**
 * 一张记忆卡片的**全序**与合并算子。整个同步层的正确性都压在这里。
 *
 * ── 为什么是"全序取大"而不是"按档位挑" ──────────────────────────────────────
 *
 * 以前是 `rank = 档位 × 1000 + level`，取大的那条。两个毛病：
 *
 * 1. `MemoryProgress` 里**没有时间戳**，两台设备并发改同一张卡时无法判断谁更晚，
 *    只好拿 `level` 当替身——可 `level` 既不是时钟（复习不一定让它变大），
 *    也不单调（答「忘记」会把它降下来）；
 * 2. `level` 与 `nextDue` 是**耦合**的（复习同时改这两个），所以"按 level 挑"
 *    必然把赢家那条**过期的 `nextDue`** 一起继承过来。线上表现就是
 *    「刚复习完的卡，同步之后又变回待复习」，三个方向（本地复习 / 云端复习 /
 *    答模糊）都复现过。
 *
 * 现在先比 `rev`（修订戳，见 `src/lib/rev.ts`），而且**取整条记录**——
 * `level` 与 `nextDue` 永远同源，不会再错配。
 *
 * ── 全序的六个层级 ──────────────────────────────────────────────────────────
 *
 *   ① 已掌握是终态（`mastered` 在前）—— 掌握是单向的，跨设备永远不该倒退
 *   ② `rev` 大的在前 —— 并发更新的裁决依据
 *   ③ `nextDue` 大的在前 —— 复习过的不许被拽回到期（`rev` 相同时的最后一道防线）
 *   ④ `level` 大的在前
 *   ⑤ 档位（mastered > reviewing > learning）
 *   ⑥ 其余字段的规范化 JSON —— 纯粹为了**确定性**兜底
 *
 * **⑥ 必须排除 `lapses`**：`lapses` 不参与排序，而是在选完赢家之后单独取大。
 * 如果 ⑥ 把它算进去，就会出现「赢家的 `lapses` 不是最大的 → 合并结果改了 `lapses`
 * → 它的排序键跟着变 → 换个结合顺序得到不同结果」——结合律被破坏
 * （`tests/syncMergeAlgebra.test.ts` 里有一条正是这个形状）。
 */

import { revOf } from "@/lib/rev";
import type { MemoryProgress } from "@/types";
import { canonicalJson } from "../hash";

const STATE_PRIORITY: Record<string, number> = {
  learning: 0,
  reviewing: 1,
  mastered: 2,
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 排序键里**不含 `lapses`** 的那部分（见文件头 ⑥ 的说明）。
 *
 * 只用于最后的确定性兜底；前面的 ①–⑤ 都是语义判断，不能省。
 */
function orderKey(entry: MemoryProgress): string {
  const { lapses: _lapses, ...rest } = entry;
  return canonicalJson(rest);
}

/** 两张卡谁更"新"。返回负数 = `a` 在前，正数 = `b` 在前，0 = 完全同序。 */
export function compareCards(a: MemoryProgress, b: MemoryProgress): number {
  // ① 已掌握是终态
  const aMastered = a.state === "mastered" ? 1 : 0;
  const bMastered = b.state === "mastered" ? 1 : 0;
  if (aMastered !== bMastered) return aMastered - bMastered;

  // ② 修订戳：并发更新的唯一可靠依据
  const aRev = revOf(a);
  const bRev = revOf(b);
  if (aRev !== bRev) return aRev - bRev;

  // ③ 复习过的不许被拽回到期
  const aDue = num(a.nextDue);
  const bDue = num(b.nextDue);
  if (aDue !== bDue) return aDue - bDue;

  // ④ 阶梯
  const aLevel = num(a.level);
  const bLevel = num(b.level);
  if (aLevel !== bLevel) return aLevel - bLevel;

  // ⑤ 档位
  const aPriority = STATE_PRIORITY[a.state] ?? 0;
  const bPriority = STATE_PRIORITY[b.state] ?? 0;
  if (aPriority !== bPriority) return aPriority - bPriority;

  // ⑥ 确定性兜底（不含 lapses）
  const aKey = orderKey(a);
  const bKey = orderKey(b);
  if (aKey === bKey) return 0;
  return aKey < bKey ? -1 : 1;
}

/**
 * 合并一张卡：**取整条更"新"的那份**，`lapses` 另取两边最大值。
 *
 * 这个算子满足**交换律、结合律、幂等律**（`lapses` 不在排序键里，所以取大
 * 不会影响赢家的选择）——这正是"两台设备各自算出同一个结果"的保证。
 * 违反它就会出现「A 算出 X、B 算出 Y、再同步一次又变」的隐形 bug。
 */
export function mergeCard(a: MemoryProgress, b: MemoryProgress): MemoryProgress {
  const winner = compareCards(a, b) >= 0 ? a : b;
  return { ...winner, lapses: Math.max(num(a.lapses), num(b.lapses)) };
}
