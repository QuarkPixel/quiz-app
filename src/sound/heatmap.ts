/**
 * 热力图的两种声音。
 *
 * 这是全应用**唯一**允许「密集悬停音」的地方，所以规则单独收在这里：
 *
 *   - 只有细指针的移动才响（组件侧已经过滤了 `pointerType === "touch"`）；
 *   - hover 用 55ms 冷却限流，快速扫过时宁可漏掉几格，也不要变成机关枪；
 *   - 音色就是库里那一个 `hover`，**不做变调**——格子密集，任何音高变化
 *     都会变成旋律，反而过火；
 *   - 点击跳转是另一个语义（`forward`），不跟 hover 共用声音。
 */

import { appSound } from "./app";

/** 扫过时两格之间至少隔多久（毫秒）。 */
const HOVER_COOLDOWN_MS = 55;

/** 鼠标划过一个格子（只在换格时调用）。 */
export function playHeatmapHover(): void {
  appSound.play("heatmap-hover", { cooldownMs: HOVER_COOLDOWN_MS });
}

/** 点击格子跳到对应题目。 */
export function playHeatmapJump(): void {
  appSound.play("heatmap-jump");
}
