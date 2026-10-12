/**
 * 三方合并的**通用算子**。每个都必须满足交换律、结合律、幂等律
 * （`tests/syncMergeAlgebra.test.ts` 会验），否则两台设备会各算出各的结果。
 *
 * 「相对基准谁改了听谁的」这类三方算子严格说不是二元格运算（它依赖 `base`），
 * 但它在**两边都改过**时的收敛性必须单独保证——见 `pickScalar` 的说明，
 * 那里以前是「听本地的」，两边会永远互相覆盖。
 */

import { canonicalJson } from "../hash";
import { same } from "./same";

/** 数值取大（计数器类字段）。 */
export function maxNumber(a: unknown, b: unknown): number {
  return Math.max(num(a), num(b));
}

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 单值字段的三方选择。
 *
 * - 只有一边相对基准改了 → 听改了的那边；
 * - **两边都改了 → 取规范化 JSON 较大的那份**。
 *
 * 第二条是有意为之：以前这里是「听本地的」（`return local ?? remote`），
 * 那**违反交换律**——A 设备算出 A 的设置、B 设备算出 B 的设置，谁本地谁赢，
 * 于是两边会一直互相覆盖。现在两边算出同一个结果，代价是"这一轮谁赢"没有语义
 * 依据（设置这类字段没有修订戳）。这是**已知的取舍**：设置改动很罕见，
 * 而且输了只是要重设一次，不会丢进度；比起永远收敛不了要好。
 *
 * 想彻底解决就得给设置也加修订戳，那是另一个改动。
 */
export function pickScalar(base: unknown, local: unknown, remote: unknown): unknown {
  const localChanged = !same(local, base);
  const remoteChanged = !same(remote, base);
  if (localChanged && !remoteChanged) return local;
  if (!localChanged && remoteChanged) return remote;
  const a = local ?? remote;
  const b = remote ?? local;
  return same(a, b) ? a : canonicalMax(a, b);
}

/**
 * 两个值里取规范化 JSON 较大的那份（纯粹的确定性兜底，无语义偏好）。
 *
 * 用 `canonicalJson` 而不是 `JSON.stringify`：后者比的是**插入顺序**，
 * 会让「同一个设置」在不同设备上判成不同值，那正是老 bug 的成因。
 */
export function canonicalMax(a: unknown, b: unknown): unknown {
  return canonicalJson(a ?? null) >= canonicalJson(b ?? null) ? a : b;
}

/**
 * 「带 day 的当天状态」的合并（`memory.retry` / `memory.review`）。
 *
 * `day` 大的整条赢；同一天才交给 `sameDay` 去合。`day` 是学习日锚点，
 * 比它的大小是单调的 ⇒ 交换律/结合律成立（`max` + 同日的格运算）。
 *
 * 跨天不合是有意的：合了会把昨天的「还要重新连对几次」搬到今天，
 * 或者让进度条的分子分母对不上。
 */
export function mergeDayScoped(
  local: unknown,
  remote: unknown,
  sameDay: (a: unknown, b: unknown) => unknown,
): unknown {
  const a = asRecord(local);
  const b = asRecord(remote);
  if (a === undefined) return remote;
  if (b === undefined) return local;
  const aDay = num(a.day);
  const bDay = num(b.day);
  if (aDay !== bDay) return aDay > bDay ? local : remote;
  return sameDay(local, remote);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
