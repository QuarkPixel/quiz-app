/**
 * **账本写失败必须说出来。**
 *
 * 写不进去（配额满 / 隐私模式）时的旧行为是把异常 `console.warn` 吞掉、返回 void：
 * `computePendingChanges` 会一直读到旧行 ⇒ 指示灯**永远黄**、每轮基于陈旧基准
 * 重新规划，而"内容没变就不传"的短路又让这一轮什么都不做 ⇒ **静默空转**。
 * 用户只看到"同步了，但一直是黄的"，没有任何线索指向"本地存储满了"。
 *
 * 注意这条用例的构造方式：`writeLocal` 走的是 `installStorageHook()` 当时**捕获**的
 * 那个 `localStorage.setItem`（`hookState.originalSetItem`），所以**必须在**同步层
 * 第一次装钩子**之前**把它换掉——否则运行时再改 `localStorage.setItem` 根本影响不到它。
 * 这就是为什么要 `vi.resetModules()` + 动态 import。
 */

import { describe, expect, test, vi } from "vitest";

describe("账本写失败", () => {
  test("写不进去时状态变成错误，而不是安静地报「已同步」", async () => {
    vi.resetModules();

    // 先装"配额满"：只拦账本那个键，别的键照常（题库、进度都还得存得进去）
    const original = localStorage.setItem.bind(localStorage);
    localStorage.setItem = ((key: string, value: string) => {
      if (key.startsWith("quiz_app_sync_meta")) {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      return original(key, value);
    }) as typeof localStorage.setItem;

    try {
      const { SyncHarness } = await import("./syncSupport");
      const h = new SyncHarness();
      await h.start();
      const HASH = "aaaabbbbccccdddd";
      h.freshDevice("A");
      h.seedBank(HASH, "题库一", "x");
      h.setActive(HASH);
      h.open("A");

      // 第一次同步会走到"记基准线"（云端刚建出来那条路）
      await h.on("A", (engine) => engine.sync());

      expect(
        h.engine("A").status.phase,
        "账本压根没写进去，却还是「同步成功」的状态",
      ).toBe("error");
      expect(h.engine("A").status.message ?? "").toMatch(/存储/);

      // 数据本身照常落好了（题目还在），不是同步失败
      expect(h.localQuestionText(HASH), "题目不该受影响").not.toBeNull();
      await h.stop();
    } finally {
      localStorage.setItem = original as typeof localStorage.setItem;
    }
  });
});
