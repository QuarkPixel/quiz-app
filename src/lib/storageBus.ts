/**
 * 「盘上某个键被**外部**改写了」的广播。
 *
 * 应用里有两类写入者：
 *
 *   1. 用户自己的操作（答题、改设置、导入）——写盘的同时内存里那份就是最新的，
 *      不需要任何人再读一遍；
 *   2. 同步（拉取 / 合并）——它写的是云端那份，**内存完全不知情**。
 *
 * 第 2 类以前靠「整页刷新」收场：`location.reload()` 把内存里的会话、滚动位置、
 * 作答草稿全丢掉，正在答题的人会看到页面自己跳一下。那是用暴力掩盖缺失的通道，
 * 不是设计。
 *
 * 所以现在把第 2 类收敛成**一条总线**：外部写盘（`applyRemoteValue`）之后广播键名，
 * 谁持有这个键的内存副本，谁自己重读。`location.reload()` 不再需要。
 *
 * 约定：
 *   - **只有外部写入才广播**。用户自己的写入走普通 `localStorage.setItem`，
 *     不经过这里——否则「刚写下去的内容又被自己读回来」会触发无谓的重建。
 *   - 订阅方要**幂等**：同一个键可能在一轮同步里被写多次（合并 + 后续分片）。
 *   - 回调里不要反过来写盘（`saveState` 之类），那会把刚落下来的合并结果覆盖掉；
 *     确需写入的，先在内存里合并完再写（见两个 Session 的 `isReloading`）。
 */

type StorageWriteListener = (key: string) => void;

const listeners = new Set<StorageWriteListener>();

/** 订阅「外部写盘」。返回取消订阅的函数。 */
export function subscribeStorageWrite(
  listener: StorageWriteListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 外部把某个键写进 localStorage 之后调用（`applyRemoteValue` 是唯一入口）。 */
export function notifyStorageWrite(key: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(key);
    } catch (e) {
      console.warn("Storage write listener failed:", e);
    }
  }
}
