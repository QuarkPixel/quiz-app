/**
 * 本地存储这条路通不通 —— iOS 上踩过的坑。
 *
 * 页头那颗指示点靠「写入 → 通知」才知道本地脏了。iOS 上见过两种情况：
 *   - 覆盖 `localStorage.setItem` 没生效：写得进去，但没人通知 → 指示点永远不变黄；
 *   - `setItem` 被系统拦掉（隐私模式）：连进度都存不下来。
 * 两种情况都不能假装正常，所以加了探针 + 兜底轮询。
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { SyncEngine } from "@/features/sync/engine.svelte";
import { SyncConfigStore } from "@/features/sync/config.svelte";
import {
  installStorageHook,
  probeStorageHealth,
} from "@/features/sync/storage";

/**
 * 绕过钩子直接落盘（模拟「钩子没生效」：写入是真的，但不通知）。
 *
 * 注意 `this`：`setItem` 是原型上的方法，必须 `.call(localStorage, …)`，
 * 直接 `proto.setItem(...)` 会以原型为 `this` 而炸。
 */
function rawSetItem(): typeof localStorage.setItem {
  const proto = Object.getPrototypeOf(localStorage) as Storage;
  const setItem = proto.setItem;
  return ((key: string, value: string) => {
    setItem.call(localStorage, key, value);
  }) as typeof localStorage.setItem;
}

let savedSetItem: typeof localStorage.setItem;
let savedRemoveItem: typeof localStorage.removeItem;

beforeEach(() => {
  installStorageHook();
  savedSetItem = localStorage.setItem;
  savedRemoveItem = localStorage.removeItem;
  localStorage.clear();
});

afterEach(() => {
  localStorage.setItem = savedSetItem;
  localStorage.removeItem = savedRemoveItem;
  localStorage.clear();
});

describe("本地存储探针", () => {
  test("正常浏览器：ok", () => {
    expect(probeStorageHealth()).toBe("ok");
  });

  test("写不进去（隐私模式）：blocked", () => {
    localStorage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    expect(probeStorageHealth()).toBe("blocked");
  });

  test("写得进去但钩子不通知（iOS）：silent", () => {
    localStorage.setItem = rawSetItem();
    expect(probeStorageHealth()).toBe("silent");
  });

  test("只通知一半（removeItem 没生效）也算 silent", () => {
    localStorage.removeItem = () => {};
    expect(probeStorageHealth()).toBe("silent");
  });
});

describe("引擎遇到 iOS 那种「钩子不生效」", () => {
  function makeEngine(): SyncEngine {
    const store = new SyncConfigStore();
    store.update({ enabled: true, token: "tok", gistId: "", autoSync: true });
    return new SyncEngine(store, "http://127.0.0.1:1");
  }

  test("装兜底轮询，并且真的能把「本地脏了」看出来", () => {
    localStorage.setItem = rawSetItem();
    const engine = makeEngine();
    engine.init();
    try {
      expect(engine.localChangeFallback, "钩子不生效就该退化成定时比对").toBe(true);
      expect(engine.storageBlocked).toBe(false);

      // 先把状态摆成「上一次同步成功」（真实场景里同步完就是这样）
      engine.pendingChanges = false;

      // 写点东西（走的是「不通知」的那条路）
      localStorage.setItem(
        "quiz_app_questions_aaaa",
        JSON.stringify([{ id: "q1", type: "memory", question: "题", answer: "答" }]),
      );
      expect(engine.pendingChanges, "钩子不通知，此刻还不知道脏了").toBe(false);

      // 兜底轮询的一次检查（正常设备上是没人调它的定时器在调）
      (
        engine as unknown as { pollLocalChanges: () => void }
      ).pollLocalChanges();
      expect(engine.pendingChanges, "定时比对应该看出本地脏了").toBe(true);
    } finally {
      engine.dispose();
    }
  });

  test("正常设备上不装兜底", () => {
    const engine = makeEngine();
    engine.init();
    try {
      expect(engine.localChangeFallback).toBe(false);
      expect(engine.storageBlocked).toBe(false);
    } finally {
      engine.dispose();
    }
  });

  test("写不进本地存储：storageBlocked，且永远不算「已同步」", () => {
    localStorage.setItem = () => {
      throw new Error("blocked");
    };
    const engine = makeEngine();
    engine.init();
    try {
      expect(engine.storageBlocked).toBe(true);
      expect(engine.inSync, "存不下来的时候不许显示绿色").toBe(false);
    } finally {
      engine.dispose();
    }
  });
});
