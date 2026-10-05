/**
 * 「拉取到当前题库的新内容时才会刷新页面，而且正在答题就先挂起」。
 *
 * 线上踩过的 bug：在设备 B 上答题答到一半，设备 A 那边改了点什么，B 的定时同步
 * 一拉到内容就整页刷新——页面自己跳回首页，答了一半的题也没了。这里把三条规矩
 * 钉死（判据见 `engine.svelte.ts` 的 `execute` 第 ⑤ 步）：
 *
 *   1. 拉下来的不是**当前题库** → 根本不刷新（这次修复的主项）；
 *   2. 是当前题库 → 刷新，但**正在答题 / 开着弹窗 / 页面在后台时挂起**，
 *      等停手之后自己补上（`@/features/userActivity.svelte`）；
 *   3. 冲突没裁决 → 一条也不刷（早期版本在 `syncTwoDevice.test.ts` 里已钉住）。
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { flushSync } from "svelte";

import {
  attachReloadGuard,
  disposeReloadGuard,
  userActivity,
} from "@/features/userActivity.svelte";
import { loadSyncMeta } from "@/features/sync/storage";
import { SyncHarness } from "./syncSupport";

const HASH_A = "aaaabbbbccccdddd";
const HASH_B = "eeeeffff00001111";

let h: SyncHarness;
/** 应用级那一份 guard 会先 `location.reload()` 数到替身上，这里再装一份能数的。 */
let detachGuard: () => void;
let deferredReloads = 0;

beforeAll(async () => {
  h = new SyncHarness();
  await h.start();
});

afterAll(async () => {
  await h.stop();
});

beforeEach(() => {
  h.reset();
  userActivity.reset();
  deferredReloads = 0;
  // 先把模块加载时那份 guard 拆掉（它盯的是同一个单例，会跟这份抢那笔挂起的刷新），
  // 再装一份能数的
  disposeReloadGuard();
  detachGuard = attachReloadGuard(() => {
    deferredReloads += 1;
    h.reloads += 1;
  }, userActivity);
});

afterEach(() => {
  detachGuard();
  userActivity.reset();
});

/** 造两台设备：A 上有一个题库（推进云端），B 是同一串令牌 + 同一个 Gist。 */
async function twoDevices(): Promise<{ gistId: string }> {
  h.freshDevice("A");
  const a = h.open("A");
  h.seedBank(HASH_A, "题库一", "第一版");
  h.setActive(HASH_A);
  await a.sync();
  const gistId = h.store("A").value.gistId;
  h.save("A");
  return { gistId };
}

/** 在那笔挂起的刷新上「停手」，看它会不会补上。 */
function settleAfterIdle(): void {
  flushSync();
}

describe("当前题库没变，就不刷新", () => {
  test("拉下来的是别的题库：一个刷新都不发", async () => {
    const { gistId } = await twoDevices();

    // B：把 A 的题库拉下来，但**当前看的是 B**（先手动造一个本地题库）
    h.freshDevice("B");
    const b = h.open("B", { gistId });
    h.seedBank(HASH_B, "题库二", "本地那份");
    h.setActive(HASH_B);
    h.save("B");
    h.reloads = 0;

    const outcome = await b.sync();
    h.save("B");

    expect(outcome.pulled, "题库一确实拉下来了").toBe(1);
    expect(h.localQuestionText(HASH_A)).toContain("第一版");
    expect(
      h.reloads,
      "拉的是没在看的题库：侧边栏自己会更新，不该打断当前这一页",
    ).toBe(0);
    expect(userActivity.pendingReload).toBeNull();
  });

  test("改的是别的题库的进度：同样不刷新", async () => {
    const { gistId } = await twoDevices();

    h.freshDevice("B");
    const b = h.open("B", { gistId });
    h.seedBank(HASH_B, "题库二", "本地那份");
    h.setActive(HASH_B);
    h.save("B");
    await b.sync();
    h.save("B");

    // A 刷题改进度（题库一），B 当前看的是题库二
    h.engine("A");
    h.studyBank(HASH_A, 7);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    h.reloads = 0;
    const outcome = await h.on("B", (engine) => engine.sync());

    expect(outcome.pulled).toBe(1);
    expect(localStorage.getItem(`quiz_app_state_${HASH_A}`)).toContain("7");
    expect(h.reloads).toBe(0);
  });
});

describe("当前题库变了：该刷，但要等停手", () => {
  test("正在答题：挂起，答完自己补上", async () => {
    const { gistId } = await twoDevices();

    // B 也有一份题库一（同一个 hash），当前看的就是它
    h.freshDevice("B");
    const b = h.open("B", { gistId });
    await b.sync();
    h.save("B");
    expect(h.localQuestionText(HASH_A)).toContain("第一版");

    // A 那边改了题库一的题目
    h.engine("A");
    h.seedBank(HASH_A, "题库一", "第二版");
    await h.on("A", (engine) => engine.sync());

    // B 正在答题（屏上有题）
    h.engine("B");
    userActivity.setAnswering(true);
    h.reloads = 0;

    const outcome = await h.on("B", (engine) => engine.sync());

    expect(outcome.pulled).toBe(1);
    expect(h.localQuestionText(HASH_A)).toContain("第二版");
    expect(h.reloads, "答题期间绝不允许整页刷新").toBe(0);
    expect(userActivity.pendingReload, "这笔刷新要挂着").toBe("synced");

    // 答完（回到首页 / 退出本轮）→ 那笔挂起的刷新自己补上
    userActivity.setAnswering(false);
    settleAfterIdle();

    expect(h.reloads, "停手之后必须补上，否则一直停在旧内容上").toBe(1);
    expect(deferredReloads).toBe(1);
    expect(userActivity.pendingReload).toBeNull();
  });

  test("弹窗开着：挂起，关掉再刷", async () => {
    const { gistId } = await twoDevices();

    h.freshDevice("B");
    const b = h.open("B", { gistId });
    await b.sync();
    h.save("B");

    h.engine("A");
    h.studyBank(HASH_A, 5);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    userActivity.setOverlay("settings", true);
    h.reloads = 0;

    await h.on("B", (engine) => engine.sync());

    expect(h.reloads).toBe(0);
    expect(userActivity.pendingReload).toBe("synced");

    userActivity.setOverlay("settings", false);
    settleAfterIdle();
    expect(h.reloads).toBe(1);
  });

  test("页面在后台：挂起，回到前台再刷", async () => {
    const { gistId } = await twoDevices();

    h.freshDevice("B");
    const b = h.open("B", { gistId });
    await b.sync();
    h.save("B");

    h.engine("A");
    h.studyBank(HASH_A, 6);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    userActivity.setHidden(true);
    h.reloads = 0;

    await h.on("B", (engine) => engine.sync());
    expect(h.reloads).toBe(0);

    userActivity.setHidden(false);
    settleAfterIdle();
    expect(h.reloads).toBe(1);
  });

  test("空闲时：立刻刷新（少了这条，一个「永远挂起」的实现也能过前面的用例）", async () => {
    const { gistId } = await twoDevices();

    h.freshDevice("B");
    const b = h.open("B", { gistId });
    await b.sync();
    h.save("B");

    h.engine("A");
    h.studyBank(HASH_A, 8);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    h.reloads = 0;
    await h.on("B", (engine) => engine.sync());

    expect(h.reloads).toBe(1);
    expect(userActivity.pendingReload).toBeNull();
  });
});

describe("当前题库被删掉", () => {
  test("云端删了正在看的题库 → 跟着删，并且刷新", async () => {
    const { gistId } = await twoDevices();

    h.freshDevice("B");
    const b = h.open("B", { gistId });
    await b.sync();
    h.save("B");
    expect(h.localLibrary().map((x) => x.hash)).toContain(HASH_A);

    // A 删掉题库一（B 正在看的就是它）并推上去
    h.engine("A");
    h.deleteBank(HASH_A);
    await h.on("A", (engine) => engine.sync());

    h.engine("B");
    userActivity.setAnswering(true);
    h.reloads = 0;
    const outcome = await h.on("B", (engine) => engine.sync());

    expect(outcome.removed).toBe(1);
    expect(h.localQuestionText(HASH_A)).toBeNull();
    expect(h.reloads, "答题期间照样先挂起").toBe(0);

    userActivity.setAnswering(false);
    settleAfterIdle();
    expect(h.reloads, "当前题库已经没了，这一页必须重建").toBe(1);
  });

  test("新设备第一次拉到题库（原本没有当前题库）→ 刷新，好把新题库显示出来", async () => {
    const { gistId } = await twoDevices();

    h.freshDevice("B");
    const b = h.open("B", { gistId });
    h.save("B");
    h.reloads = 0;

    await b.sync();
    h.save("B");

    expect(h.localQuestionText(HASH_A)).toContain("第一版");
    expect(h.reloads).toBe(1);
  });
});

describe("收尾状态照旧", () => {
  test("同步的基准线 / 状态行不受刷新判定影响", async () => {
    const { gistId } = await twoDevices();

    h.freshDevice("B");
    const b = h.open("B", { gistId });
    h.seedBank(HASH_B, "题库二", "本地那份");
    h.setActive(HASH_B);
    h.save("B");

    const outcome = await b.sync();
    h.save("B");

    expect(outcome.changedLocal).toBe(false);
    expect(loadSyncMeta().rows[`bank:${HASH_A}`]).toBeDefined();
    expect(b.status.phase).toBe("idle");
    // 云端来的题库一 + 本地新导入的题库二，都算「新增」；两边 activeBank 不同，
    // 列表条目的相对顺序也要重排 → 附带一句「设置已更新」
    expect(b.status.message).toBe("新增 2 · 设置已更新");
  });
});
