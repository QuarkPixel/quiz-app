/**
 * 「此刻正在做哪个题库」——同步在写本地之前唯一要问的用户活动。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────────────
 *
 * 「云端有更新的内容」有两种处理：用户没在用它 → 直接落地；用户正在做这个题库
 * → 落地会把屏上那一轮（题干、作答草稿、判分页）换掉，所以先问一句。
 *
 * 这件事**不能从落盘状态里猜**：`quizSession` 存在只说明"上次停在这道题"，
 * 不代表用户现在正看着它；`memory.sessions` 同理。它也不是"页面可见"这种
 * 模糊信号——后台标签页里同步照样应该静默应用。
 *
 * 所以由一个显式的小仓库回答，只有一个字段：
 *
 *   - `hash`：当前挂载的是哪个题库（同一时刻只有一个视图）
 *   - `busy`：屏上有没有正在做的东西（一道题 / 一张卡）
 *
 * 视图在挂载时 `enter(hash)`、在 `currentQuestion` 变化时 `setBusy(...)`，
 * 卸载时执行 `enter` 返回的清理函数。同步只读 `isBusy(hash)`。
 *
 * **不要**把这个判断塞回同步引擎的某个布尔里：那会让"谁负责说用户在答题"
 * 又变成两处各写一份（旧版 `userActivity` 就是这么长出来的）。
 */

class ActiveWorkStore {
  private current = $state<{ hash: string; busy: boolean } | null>(null);

  /**
   * 声明"当前视图在看这个题库"。返回卸载时调用的清理函数。
   *
   * 幂等：重复进入同一个题库会重置 `busy`（新挂载的会话还没出题）。
   */
  enter(hash: string): () => void {
    this.current = { hash, busy: false };
    return () => {
      if (this.current?.hash === hash) this.current = null;
    };
  }

  /** 屏上有没有正在做的东西。只对当前挂载的那个题库生效。 */
  setBusy(hash: string, busy: boolean): void {
    const current = this.current;
    if (current === null || current.hash !== hash) return;
    if (current.busy === busy) return;
    this.current = { hash, busy };
  }

  /** 这个题库此刻是不是"用户正在做"（同步写本地前要问的就是这一句）。 */
  isBusy(hash: string): boolean {
    return this.current?.hash === hash && this.current.busy;
  }

  /** 当前挂载的题库（排查 / 测试用）。 */
  get hash(): string | null {
    return this.current?.hash ?? null;
  }

  /** 测试之间复位。 */
  reset(): void {
    this.current = null;
  }
}

export const activeWork = new ActiveWorkStore();
