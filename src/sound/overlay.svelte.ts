/**
 * 「窗口打开 / 关闭」的统一配音。
 *
 * 对话框、抽屉这些浮层各自在自己的组件里改 `open`，没有共同的事件总线；
 * 所以在**浮层外壳**里盯住这个布尔量，由真 → 假的跳变决定响 open 还是 close。
 *
 * 用 `$effect` 而不是在触发按钮上加音效：同一个浮层有多个入口（图标、快捷键、
 * 代码里 show()），按钮那层会漏，而且「点了按钮但被拦下没打开」也会误响。
 * 盯状态则只认结果。
 *
 * 初值按 `false` 算：懒加载的对话框可能在 `open` 已经是 true 之后才挂载
 * （首屏之后才 import），那一下同样该有「打开」的反馈。
 */

import { untrack } from "svelte";
import { appSound } from "./app";

export interface OverlaySoundOptions {
  /**
   * 这次「打开」是另一段动作的延续，声音已经在那一段里响过了。
   *
   * 目前唯一的用户：记忆首页点热力图格子 → 已经响过 `heatmap-jump`（swipe），
   * 紧接着总览窗口出现。两声响在同一帧会叠成一个怪音，所以这一下不再补
   * `dialog-open`。返回 true 只是「这一次」静音，不影响后续正常开合。
   *
   * 在 effect 里用 `untrack` 读：它只描述这一次要不要静音，不该把判断用的
   * 状态拖进 effect 的依赖集（否则跳转目标清空时又要重跑一遍）。
   */
  skipOpen?: () => boolean;

  /**
   * 这次「关闭」紧跟着一个结果音（删除成功 / 重命名保存）：不要再补一声
   * `dialog-close`。两声响在同一帧会叠成一个怪音，而且结果音才是用户要听的。
   *
   * 只在关闭时读，同样用 `untrack`：调用方用一个一次性标记表达「刚刚那下
   * 已经配过音了」，标记清掉不该让 effect 重跑。
   */
  skipClose?: () => boolean;
}

export function attachOverlaySound(
  isOpen: () => boolean,
  options: OverlaySoundOptions = {},
): void {
  let previous = false;

  $effect(() => {
    const open = isOpen();
    if (open === previous) return;
    previous = open;
    if (open) {
      if (untrack(() => options.skipOpen?.() === true)) return;
      appSound.play("dialog-open");
      return;
    }
    if (untrack(() => options.skipClose?.() === true)) return;
    appSound.play("dialog-close");
  });
}
