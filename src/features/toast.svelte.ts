/**
 * 全局提示（Toast）。
 *
 * **单例 + 在 `App.svelte` 里只渲染一份**：提示属于整个页面，不属于某个面板。
 * 以前每个视图各挂一份 `<AlertToast>`，于是：
 *   - 同一时刻挂着的就有好几份（侧边栏 + 内容区 + 设置弹窗），各弹各的；
 *   - 挂在设置弹窗里的那份还被 Dialog 的层级和 `overflow-hidden` 夹着，
 *     提示看起来像「弹窗里的弹窗」，关掉弹窗提示也跟着没了。
 *
 * 现在谁都可以 `toastStore.show(...)`，出现的位置只有一处、在弹窗之上。
 */

import { TOAST_DURATION_MS, TOAST_FADE_MS } from "@/config";

export type ToastVariant = "default" | "success" | "destructive";

export interface ToastMessage {
  title: string;
  description?: string;
  variant: ToastVariant;
}

export class ToastStore {
  /** 当前要显示的那条；`null` = 没有（连容器都不渲染） */
  current: ToastMessage | null = $state(null);
  /** 进场 / 出场用；出场动画放完才把 `current` 清掉 */
  visible: boolean = $state(false);

  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * 弹一条提示。
   *
   * 连着弹多条时后一条直接顶掉前一条（计时重新开始）——同时叠好几个提示
   * 只会挡住页面，用户也读不过来。
   */
  show(
    title: string,
    description?: string,
    variant: ToastVariant = "default",
  ): void {
    this.clearTimers();
    this.current = { title, description, variant };
    this.visible = true;
    this.startHideTimer();
  }

  /** 鼠标停在提示上：先别消失（由 `AlertToast` 的 hover 调用）。 */
  hold(): void {
    if (this.hideTimer !== null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }

  /** 鼠标移开：接着计时。 */
  release(): void {
    if (this.visible) this.startHideTimer();
  }

  /** 立刻收掉（测试隔离、以及「不想再看了」的场合）。 */
  dismiss(): void {
    this.clearTimers();
    this.visible = false;
    this.current = null;
  }

  private startHideTimer(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.visible = false;
      // 出场动画放完再把它从 DOM 里拿掉
      this.clearTimer = setTimeout(() => {
        this.current = null;
        this.clearTimer = null;
      }, TOAST_FADE_MS);
      this.hideTimer = null;
    }, TOAST_DURATION_MS);
  }

  private clearTimers(): void {
    if (this.hideTimer !== null) clearTimeout(this.hideTimer);
    if (this.clearTimer !== null) clearTimeout(this.clearTimer);
    this.hideTimer = null;
    this.clearTimer = null;
  }
}

export const toastStore = new ToastStore();
