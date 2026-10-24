/**
 * 卡片状态的展示口径。
 *
 * 记忆模式里「这道卡现在是什么状态」被三处 UI 各说了一遍（总览列表、热力图、
 * 筛选栏），以前是三条几乎一样的 if 链：加一个状态就得记得改三处，漏掉的那处
 * 会显示空白。
 *
 * 只有「复习中」那句话三处不一样（列表说「3 天后复习」、热力图说「复习中 2/5」、
 * 筛选栏说「今天复习」），所以这里只收公共的三种，复习中由调用方自己补。
 */

import type { MemoryProgress } from "@/types";

/** 未学习 / 学习中 / 已掌握；复习中返回「复习中」（调用方通常要换成更具体的说法）。 */
export function memoryStatusLabel(item: MemoryProgress | undefined): string {
  if (!item) return "未学习";
  if (item.state === "mastered") return "已掌握";
  if (item.state === "learning") return "学习中";
  return "复习中";
}
