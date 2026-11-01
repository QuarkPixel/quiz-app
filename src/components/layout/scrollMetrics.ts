/**
 * 滚动区的「一次读数」——把 `ViewShell` 里那五个平行字段收成一个不可分的值。
 *
 * 以前外壳里是五个各自独立的 `$state`：
 *
 *   isScrollable / scrollTop / atTop / atBottom（外加 `scrolling`）
 *
 * 前四个全部由**同一次** DOM 读数算出（`scrollHeight - clientHeight` 与
 * `scrollTop`），彼此之间存在恒等关系：
 *
 * ```
 *   isScrollable ⇔ max > 1
 *   atTop        ⇔ scrollTop <= 2
 *   atBottom     ⇔ scrollTop >= max - 2
 * ```
 *
 * 也就是说真正被观测到的只有两个数，其余都是它们的函数。分成四个字段存，
 * 就等于允许四个值各自漂移：`atTop` 和 `atBottom` 同时为真、`isScrollable`
 * 为假却 `atBottom` 为假……这些画面在类型上完全合法，只能靠「每次记得四个
 * 一起赋值」保证不出现。任何一处单独改其中一个都是 bug，而且症状很轻——
 * 某条遮罩该收没收、按钮该藏没藏——没人会立刻发现。
 *
 * 现在只存 `ScrollReading`，其余一律用下面的纯函数派生：
 *
 * ```
 *   still       滚不动（余量 <= 1px）——没有东西可滚，也就无所谓贴顶贴底
 *   scrollable  能滚，带着当前位置与可滚动余量
 * ```
 *
 * 「滚不动」单独成一支，于是 `max` / `offset` **只在真的能滚时才存在**：
 * 「不能滚但余量很大」这种自相矛盾的读数在类型上构造不出来，遮罩也不必再
 * 靠 `isScrollable && !atTop` 这种两段判断兜着。
 */

/**
 * 判「贴边」的容差（px）。
 *
 * 浏览器给的 `scrollTop` 带亚像素（0.5、1.5 很常见，缩放 / 高 DPI 下尤其），
 * 硬比 `0` 会让「明明已经在顶上了」判成没贴顶，遮罩就一直亮着。
 */
const EDGE_SLACK_PX = 2;

/** 余量小于这个值就算滚不动：浏览器的 `scrollHeight` 同样是取整过的。 */
const MIN_SCROLLABLE_PX = 1;

/** 一次 DOM 读数（`HTMLDivElement` 直接满足这个形状）。 */
export interface ScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/**
 * 滚动区此刻的样子。
 *
 * 两态互斥且穷尽，所以「能滚」与「位置 / 余量」不会各自为政：
 * 拿到 `still` 就调不出 `max`，拿到 `scrollable` 就一定有个确定的位置。
 */
export type ScrollReading =
  /** 滚不动：内容没超出容器（含 `scrollHeight < clientHeight` 这种退化情形）。 */
  | { kind: "still" }
  /** 能滚：`offset` 是当前 `scrollTop`，`max` 是还能再滚多远。 */
  | { kind: "scrollable"; offset: number; max: number };

/** 把一次 DOM 读数收敛成 `ScrollReading`。**这是唯一的入口**。 */
export function readScroll(metrics: ScrollMetrics): ScrollReading {
  const max = metrics.scrollHeight - metrics.clientHeight;
  if (max <= MIN_SCROLLABLE_PX) return { kind: "still" };
  return { kind: "scrollable", offset: metrics.scrollTop, max };
}

/**
 * 当前滚动位置（px）。滚不动时是 0。
 *
 * 「回到顶部」按钮只看这个数决定露不露面——滚不动时位置必然是 0，
 * 所以那一支不带 `offset` 不会丢信息。
 */
export function scrollOffset(reading: ScrollReading): number {
  return reading.kind === "scrollable" ? reading.offset : 0;
}

/** 是否贴着顶（上方没有「被切掉的内容」）。滚不动时也算贴着。 */
export function pinnedToTop(reading: ScrollReading): boolean {
  return reading.kind === "still" || reading.offset <= EDGE_SLACK_PX;
}

/** 是否贴着底（下方没有「被切掉的内容」）。滚不动时也算贴着。 */
export function pinnedToBottom(reading: ScrollReading): boolean {
  return (
    reading.kind === "still" || reading.offset >= reading.max - EDGE_SLACK_PX
  );
}
