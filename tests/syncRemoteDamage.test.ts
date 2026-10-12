/**
 * **云端读不出来 ≠ 云端没有**。
 *
 * 分片解不开时，它里面的题库在 `remote.banks` 里根本不存在，判定就会当成
 * 「云端删掉了」推出 `deleteLocal` → 本地题库连题目带**还没同步的进度**一起被删。
 * 而 `_general.json` 解不开会被当成「云端没有 general」→ 用空壳合并再把空壳推上去
 * → 两边的设置一起变成 `{}`。
 *
 * 这一组是审计复现出来之后补的闸门：**远端有读不出来的文件就整轮停手**。
 * 会「读不出来」的真实原因：响应体被截断、payload 版本比本机新
 * （`decodePayload` 是故意返回 null 的，注释写着「调用方应当跳过它而不是当成
 * 损坏数据删掉」）、文件被写坏。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { SyncHarness } from "./syncSupport";
import { decodePayload } from "@/features/sync/payload";
import {
  GIST_GENERAL_FILE,
  shardFileName,
  shardIndexOf,
} from "@/features/sync/types";

const HASH_A = "aaaabbbbccccdddd";

let h: SyncHarness;

beforeAll(async () => {
  h = new SyncHarness();
  await h.start();
});
afterAll(async () => {
  await h.stop();
});
beforeEach(() => {
  h.reset();
});

/** A 建库并同步；返回 gistId 与「A 已经答了一题但还没同步」的状态。 */
async function syncedDeviceWithUnsyncedWork(): Promise<string> {
  h.freshDevice("A");
  h.seedBank(HASH_A, "题库一", "第一版");
  h.setActive(HASH_A);
  h.open("A");
  await h.on("A", (engine) => engine.sync());
  const gistId = h.store("A").value.gistId;
  h.save("A");

  // 答了一题（第 7 轮），还没同步
  h.engine("A");
  const raw = JSON.parse(localStorage.getItem(`quiz_app_state_${HASH_A}`) ?? "{}");
  localStorage.setItem(
    `quiz_app_state_${HASH_A}`,
    JSON.stringify({ ...raw, currentRound: 7 }),
  );
  h.tick();
  h.save("A");
  return gistId;
}

describe("云端有读不出来的文件 → 整轮停手", () => {
  test("分片解不开：不删本地题库、不动还没同步的进度、状态是错误", async () => {
    const gistId = await syncedDeviceWithUnsyncedWork();

    // 把云端分片写成垃圾（模拟截断 / 新版本 payload / 写坏）
    h.fake.put(gistId, shardFileName(shardIndexOf(HASH_A)), "!!! not a payload !!!");

    h.engine("A");
    const outcome = await h.on("A", (engine) => engine.sync());

    expect(outcome.removed, "读不出来绝不能被当成「云端删了它」").toBe(0);
    expect(outcome.pulled).toBe(0);
    expect(outcome.pushed).toBe(0);
    expect(h.localQuestionText(HASH_A), "本地题库被删了").not.toBeNull();
    const state = JSON.parse(localStorage.getItem(`quiz_app_state_${HASH_A}`) ?? "{}");
    expect(state.currentRound, "还没同步的那次答题被抹掉了").toBe(7);
    expect(h.engine("A").status.phase, "应当明确报错，而不是安静地继续").toBe("error");
  });

  test("分片解不开之后再修好云端：那一轮的东西照常补上去（停手不是死锁）", async () => {
    const gistId = await syncedDeviceWithUnsyncedWork();
    const shard = shardFileName(shardIndexOf(HASH_A));
    const good = h.cloudFiles(gistId)[shard]!;

    h.fake.put(gistId, shard, "!!! broken !!!");
    h.engine("A");
    await h.on("A", (engine) => engine.sync());

    // 云端恢复（比如版本不兼容时用户升级了应用）
    h.fake.put(gistId, shard, good);
    h.engine("A");
    const healed = await h.on("A", (engine) => engine.sync());
    expect(healed.pushed, "修好之后那一轮改动要能传上去").toBe(1);
    const cloud = (await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.state as {
      currentRound: number;
    };
    expect(cloud.currentRound).toBe(7);
  });

  test("_general.json 解不开：不许把两边的设置一起清空", async () => {
    const gistId = await syncedDeviceWithUnsyncedWork();
    const before = JSON.parse(localStorage.getItem("quiz_app_general") ?? "{}");

    h.fake.put(gistId, GIST_GENERAL_FILE, "!!! not a payload !!!");
    h.engine("A");
    const outcome = await h.on("A", (engine) => engine.sync());

    expect(outcome.settingsChanged, "读不出来不能被当成「云端没有 general」").toBe(false);
    const after = JSON.parse(localStorage.getItem("quiz_app_general") ?? "{}");
    expect(after.defaultSettings, "本地设置被清空了").toEqual(before.defaultSettings);
    expect(after.globalSettings).toEqual(before.globalSettings);
    expect(after.library, "题库列表被清空了").toEqual(before.library);
    // 云端那份也不能被空壳盖掉：它应当**原样**还是我写进去的那个坏值
    //（停手 = 一个字节都不动；被空壳盖掉才是灾难——那会把设置永久清空）
    expect(h.cloudFiles(gistId)[GIST_GENERAL_FILE]).toBe("!!! not a payload !!!");
  });

  test("云端文件正常时这道闸不拦路（别把正常同步也挡了）", async () => {
    await syncedDeviceWithUnsyncedWork();
    h.engine("A");
    const outcome = await h.on("A", (engine) => engine.sync());
    expect(outcome.pushed).toBe(1);
    expect(h.engine("A").status.phase).not.toBe("error");
  });
});

describe("remoteReadDamage 的判据", () => {
  test("「文件在但解不开」与「文件压根没有」必须分得开", async () => {
    // 没有 general 文件 → generalHash 为空 → 不算损坏
    const noGeneral = await decodePayload("garbage");
    expect(noGeneral).toBeNull();

    // 云端只有一个解不开的分片 → 算损坏
    const gistId = await syncedDeviceWithUnsyncedWork();
    const shard = shardFileName(shardIndexOf(HASH_A));
    const good = h.cloudFiles(gistId)[shard]!;
    h.fake.put(gistId, shard, "!!! broken !!!");
    h.engine("A");
    await h.on("A", (engine) => engine.sync());
    expect(h.engine("A").status.phase).toBe("error");
    // 修好之后不再报错
    h.fake.put(gistId, shard, good);
    h.engine("A");
    await h.on("A", (engine) => engine.sync());
    expect(h.engine("A").status.phase).not.toBe("error");
  });
});
