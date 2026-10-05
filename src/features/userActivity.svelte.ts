/**
 * 「用户现在是不是正在做事」+「有没有一笔刷新在等着」。
 *
 * 云同步拉到新内容后要整页刷新一次（见 `sync/engine.svelte.ts` 头部第 3 条），
 * 这一下会**把内存里的会话状态全丢掉**：答题答到一半、活动池刚挑好、复习进度条
 * 数到 4/5 —— 刷新之后都要重来。所以刷新前必须先问一句「现在能打断吗」：
 *
 *   - `answering`：正在答题（两个 session 的 `currentQuestion` 非空时占住）
 *   - `overlay`：  有弹窗开着（设置 / 总览 / 导入确认 / 冲突选择……）
 *   - `hidden`：   页面在后台。后台刷新会把「回来时还在原来那题」这件事也毁掉
 *
 * 三条都不占（也就是指示点变绿、页面在前台）才允许刷新；否则把这次刷新挂起，
 * 等状态自己回到空闲再刷（`attachReloadGuard` 盯着这件事）。
 * 挂起期间拉下来的内容**已经在 localStorage 里**，只是内存里的视图还是旧的。
 *
 * 刻意做成应用级单例（和 `toastStore` / `globalSettingsDialog` 同一类）：
 * 占位的一方是会话、消费的一方是同步引擎，两边在不同的组件树分支上。
 */

import { toastStore } from "./toast.svelte";

/** 弹窗 / 抽屉的占位名字（`setOverlay` 的 key）：三个视图各一份，别写混。 */
export const OVERLAY_KEYS = {
  /** 当前题库设置 / 记忆模式设置 */
  settings: "settings",
  /** 总览 / 记忆模式总览 */
  overview: "overview",
  /** 导入进度的二次确认 */
  importProgress: "import-progress",
} as const;

/** 挂起的那次刷新是「因为什么」：只用来决定要不要弹一条提示。 */
export type ReloadReason = "synced";

/** 提示文案只写这一处（挂起时不弹，真要刷新的那一刻才弹）。 */
const RELOAD_TOAST_TITLE = "已拉取云端更新";
const RELOAD_TOAST_DESCRIPTION = "页面将在停手后自动刷新，进度不会丢失。";

export class UserActivityStore {
  /** 正在答题（会话持有） */
  answering: boolean = $state(false);
  /**
   * 开着的弹窗 / 抽屉（按名字记账，关掉一个不影响另一个）。
   *
   * 用普通对象 + `$state` 而不是 `Set`：`Set` 的 `size` 读不出信号依赖，
   * 加一项 / 删一项不会让 `attachReloadGuard` 里那个 `$effect` 重跑
   * （表现得就像「关掉弹窗之后那笔挂起的刷新永远不来了」）。
   */
  private overlayHolders: Record<string, true> = $state({});
  /** 页面在后台 */
  hidden: boolean = $state(false);

  /**
   * 挂起中的刷新：`null` = 没有。
   *
   * **不发通知**：挂起是「稍后再刷」，不是一件需要用户处理的事；
   * 只有真正要刷新的那一刻才 `toastStore.show()`——否则答题期间会被弹一脸提示。
   */
  pendingReload: ReloadReason | null = $state(null);

  /** 有没有弹窗 / 抽屉开着。 */
  get overlayOpen(): boolean {
    return Object.keys(this.overlayHolders).length > 0;
  }

  /** 现在能不能整页刷新（三条都不占）。 */
  get canReload(): boolean {
    return !this.answering && !this.overlayOpen && !this.hidden;
  }

  /**
   * 正在答题 → true，答题结束 / 回到首页 / 会话销毁 → false。
   *
   * 刻意做成「设成某个值」而不是 begin / end 两个动作：会话重建（切题库、
   * `{#key}` 换实例）时旧实例的 end 可能根本来不及跑，而 `$effect` 的清理 +
   * 新实例的一次 set 天然是对的。
   */
  setAnswering(answering: boolean): void {
    this.answering = answering;
  }

  /** 某个弹窗 / 抽屉开或关（按名字记账，重复调用同名的不会叠加）。 */
  setOverlay(key: string, open: boolean): void {
    if (open) {
      if (this.overlayHolders[key] === true) return;
      this.overlayHolders = { ...this.overlayHolders, [key]: true };
      return;
    }
    if (this.overlayHolders[key] !== true) return;
    const rest = { ...this.overlayHolders };
    delete rest[key];
    this.overlayHolders = rest;
  }

  /** 页面进入后台 / 回到前台（由 `App.svelte` 的窗口监听喂进来）。 */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
  }

  /**
   * 请求一次整页刷新。
   *
   * @returns 立刻能刷就 `true`（调用方自己去 `location.reload()`）；
   *          现在不能打断就记下来并返回 `false`，等状态回到空闲后由
   *          `takeDeferredReload()` 取走。
   */
  requestReload(reason: ReloadReason = "synced"): boolean {
    if (this.canReload) return true;
    // 已经挂着一笔就不再翻案：先来的那笔本来就够用
    this.pendingReload ??= reason;
    return false;
  }

  /** 取走挂起的那笔刷新（没有就是 `null`）。 */
  takeDeferredReload(): ReloadReason | null {
    const reason = this.pendingReload;
    this.pendingReload = null;
    return reason;
  }

  /**
   * 测试用：把状态清干净。
   *
   * 刻意**不提供**「重置成初始值」以外的能力——正常代码里没有「全部撤销」这种需求，
   * 而单例状态跨用例残留正是这个模块最容易踩的坑。
   */
  reset(): void {
    this.answering = false;
    this.overlayHolders = {};
    this.hidden = false;
    this.pendingReload = null;
  }
}

export const userActivity = new UserActivityStore();

/**
 * 把 DOM 事件（页面可见性 / 窗口焦点）接到 `userActivity.hidden` 上。
 *
 * 放在这里而不是 `App.svelte` 里，是为了让它跟着状态本身走：谁引入这个模块，
 * 谁就得到这份接线（`dispose` 可重复调用）。
 */
export function watchPageVisibility(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }

  const sync = (): void => {
    userActivity.setHidden(document.visibilityState === "hidden");
  };
  sync();

  document.addEventListener("visibilitychange", sync);
  window.addEventListener("focus", sync);
  window.addEventListener("blur", sync);

  return () => {
    document.removeEventListener("visibilitychange", sync);
    window.removeEventListener("focus", sync);
    window.removeEventListener("blur", sync);
  };
}

/**
 * 挂起的那笔刷新由谁来执行。
 *
 * `$effect.root` 是**非组件**的响应式作用域：同步引擎（一个普通单例）要能观察
 * 「用户停手了没有」，而这件事没有组件宿主。放在模块里还有一个好处——
 * `tests/userActivity.test.ts` 能用同一份实现验证「挂起 → 空闲后自动刷新」。
 *
 * @param reload 真正执行刷新的动作（默认 `location.reload()`）
 * @param activity 要盯的那个 store（默认应用级单例；测试传自己的进来）
 * @returns 拆掉这个作用域的函数（测试用；应用里活到页面结束）
 */
export function attachReloadGuard(
  reload: () => void = () => window.location.reload(),
  activity: UserActivityStore = userActivity,
): () => void {
  return $effect.root(() => {
    $effect(() => {
      // 读一遍三条状态：任何一条变了都要重新判一次「现在能不能刷」
      void activity.answering;
      void activity.overlayOpen;
      void activity.hidden;
      if (!activity.canReload) return;
      if (activity.takeDeferredReload() === null) return;
      // 挂起的这笔是「稍后再刷」，所以刷新前补一句说明，否则用户只看到页面自己跳了
      toastStore.show(RELOAD_TOAST_TITLE, RELOAD_TOAST_DESCRIPTION);
      reload();
    });
  });
}

/**
 * 应用级的那一份。谁引入这个模块谁就受益（`main.ts` 里只调一次 `watchPageVisibility`）。
 *
 * 之所以在模块加载时就装上：同步引擎是单例、可能在挂载之前就跑完一轮对账，
 * 那会儿也得有人接住「挂起的那笔刷新」。
 */
const detachReloadGuard = attachReloadGuard();

/** 测试用：拆掉上面那一份（可重复调用）。 */
export function disposeReloadGuard(): void {
  detachReloadGuard();
}
