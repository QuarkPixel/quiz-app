/**
 * 同步引擎的端到端测试：真模块 + 内存里的 Gitee 替身，跑完整的推送 / 拉取。
 *
 * 这一层是护栏：单测覆盖了合并判定、契约测试覆盖了请求形状，但
 * 「推上去之后拉下来，本地到底变没变」「状态行报的数字对不对」只有这里能验。
 * 线上坏过的几条（上传 0 / 云端 0 个文件 / 新设备清空云端题库列表）
 * 都已经变成这里的用例。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import { SyncEngine } from "@/features/sync/engine.svelte";
import { loadSyncMeta } from "@/features/sync/storage";
import { encodePayload, decodePayload } from "@/features/sync/payload";
import { stableHash } from "@/features/sync/collect";
import {
  GIST_GENERAL_FILE,
  bankRowKey,
  shardFileName,
  shardIndexOf,
} from "@/features/sync/types";
import { SyncHarness } from "./syncSupport";

const HASH_A = "aaaabbbbccccdddd";
const HASH_B = "eeeeffff00001111";

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

describe("引擎（端到端，对着替身）", () => {
  test("第一次同步：建一条 Gist，把本地题库推上去，状态行的数字是对的", async () => {
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "英语短语", "make progress");

    const outcome = await engine.sync();
    h.save("A");

    expect(outcome.pushed).toBe(1);
    const gistId = h.store("A").value.gistId;
    expect(gistId).toBeTruthy();

    const shard = await h.cloudShard(gistId, HASH_A);
    expect(shard?.banks[HASH_A]?.name).toBe("英语短语");
    expect(shard?.banks[HASH_A]?.questions).toHaveLength(2);

    // 「云端 N 个题库 / M 个文件」必须真的记下来（线上表现：永远 0）
    expect(engine.status.remoteBanks).toBe(1);
    expect(engine.status.remoteCount).toBeGreaterThan(0);
    expect(engine.status.message).toBe("上传 1 · 下载 0");
  });

  test("第二次同步：没改动就报「已是最新」，不会重复上传", async () => {
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "英语短语", "make progress");
    await engine.sync();
    h.tick();
    h.save("A");

    const again = await engine.sync();
    h.save("A");

    expect(again.pushed).toBe(0);
    expect(again.pulled).toBe(0);
    expect(again.conflicts).toEqual([]);
    expect(engine.status.message).toBe("已是最新");
  });

  test("导入新题库后再同步：报「上传 1」，云端真的多出这个题库", async () => {
    // 线上 bug：`execute` 把 `recordPushed` 的返回值丢了，明明传上去了却报
    // 「上传 0 · 下载 0」，用户以为同步没工作。
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "题库一", "first");
    await engine.sync();
    const gistId = h.store("A").value.gistId;
    h.tick();
    h.save("A");

    h.seedBank(HASH_B, "题库二", "second");
    const outcome = await engine.sync();
    h.save("A");

    expect(outcome.pushed).toBe(1);
    expect(await h.cloudBanks(gistId)).toEqual(
      expect.arrayContaining([HASH_A, HASH_B]),
    );
  });

  test("云端有、本地没有的题库 → 拉下来，并且进题库列表", async () => {
    h.freshDevice("A");
    const a = h.open("A");
    h.seedBank(HASH_A, "英语短语", "make progress");
    await a.sync();
    const gistId = h.store("A").value.gistId;
    h.tick();
    h.save("A");

    // 设备 B：全新 localStorage，同一串令牌、同一个 gistId
    h.freshDevice("B");
    const b = h.open("B", { gistId });

    const outcome = await b.sync();
    h.save("B");

    expect(outcome.pulled).toBe(1);
    expect(h.localQuestionText(HASH_A)).toContain("make progress");
    // 题库列表是侧边栏的唯一入口，不进列表等于看不见
    expect(h.localLibrary().map((x) => x.hash)).toContain(HASH_A);
    // 基准线按题库记
    expect(loadSyncMeta().rows[bankRowKey(HASH_A)]).toBeDefined();
  });

  test("刷题之后同步：只推这个题库，云端的进度跟着变", async () => {
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "题库一", "first");
    await engine.sync();
    const gistId = h.store("A").value.gistId;
    h.tick();
    h.save("A");

    h.studyBank(HASH_A, 7);
    const outcome = await engine.sync();
    h.save("A");

    expect(outcome.pushed).toBe(1);
    const shard = await h.cloudShard(gistId, HASH_A);
    expect(shard?.banks[HASH_A]?.state).toMatchObject({ currentRound: 7 });
  });

  test("本地删题库 → 云端那一份也回收，空掉的分片文件跟着消失", async () => {
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "题库一", "first");
    await engine.sync();
    const gistId = h.store("A").value.gistId;
    const shardName = shardFileName(shardIndexOf(HASH_A));
    expect(h.cloudFiles(gistId)[shardName]).toBeDefined();
    h.tick();
    h.save("A");

    h.deleteBank(HASH_A);
    await engine.sync();
    h.save("A");

    expect(await h.cloudBanks(gistId)).toEqual([]);
    expect(h.cloudFiles(gistId)[shardName]).toBeUndefined();
    expect(Object.keys(h.cloudFiles(gistId))).toEqual([GIST_GENERAL_FILE]);
  });

  test("云端删掉的题库，本地再同步时跟着删（连列表条目一起）", async () => {
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "题库一", "first");
    h.seedBank(HASH_B, "题库二", "second");
    await engine.sync();
    const gistId = h.store("A").value.gistId;
    h.tick();
    h.save("A");

    // 模拟另一台设备把题库 A 删掉并推上去
    const shard = await h.cloudShard(gistId, HASH_A);
    const remaining = { banks: { [HASH_B]: shard?.banks[HASH_B] } };
    h.fake.put(gistId, shardFileName(shardIndexOf(HASH_A)), await encodePayload(remaining));
    const general = await h.cloudGeneral(gistId);
    h.fake.put(
      gistId,
      GIST_GENERAL_FILE,
      await encodePayload({
        ...general,
        library: (general?.library ?? []).filter((entry) => entry.hash !== HASH_A),
      }),
    );

    await engine.sync();
    h.save("A");

    expect(h.localQuestionText(HASH_A)).toBeNull();
    expect(h.localLibrary().map((x) => x.hash)).toEqual([HASH_B]);
  });

  test("「用本地覆盖云端」：云端换成和本地一模一样", async () => {
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "题库一", "第一版");
    await engine.sync();
    const gistId = h.store("A").value.gistId;
    h.tick();
    h.save("A");

    h.deleteBank(HASH_A);
    h.seedBank(HASH_A, "题库一", "第二版");
    await engine.pushLocal();
    h.save("A");

    const shard = await h.cloudShard(gistId, HASH_A);
    expect(shard?.banks[HASH_A]?.questions[0]).toMatchObject({ question: "第二版" });
  });

  test("「用云端覆盖本地」：本地被换回云端那份", async () => {
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "题库一", "云端版");
    await engine.sync();
    const gistId = h.store("A").value.gistId;
    h.tick();
    h.save("A");

    h.studyBank(HASH_A, 99);
    await engine.pullRemote();
    h.save("A");

    const state = localStorage.getItem(`quiz_app_state_${HASH_A}`) ?? "";
    expect(state).not.toContain("99");
    expect(h.localQuestionText(HASH_A)).toContain("云端版");
  });

  test("测试连接：报出云端的题库数与文件数（顺手回填 gistUrl）", async () => {
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "题库一", "first");
    await engine.sync();
    h.save("A");

    const result = await engine.testConnection();
    h.save("A");

    expect(result.ok).toBe(true);
    expect(result.bankCount).toBe(1);
    expect(result.fileCount).toBeGreaterThan(0);
    expect(engine.status.remoteBanks).toBe(1);
    expect(h.store("A").value.gistUrl).toBeTruthy();
  });

  test("从老格式升级：只有文件级基准时也能判方向，并在这一轮换成题库行", async () => {
    // 线上已经同步过的设备升级上来时，元数据里只有 `banks-N.json`（文件级）。
    // 那时候还没有「逐题库」的概念，所以第一次同步必须靠文件级基准兜底，
    // 而且这一轮结束后要把它换成题库行，否则永远停在老格式上。
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "题库一", "first");
    await engine.sync();
    const gistId = h.store("A").value.gistId;
    h.tick();
    h.save("A");

    // 把元数据改回老格式：删掉题库行，留一条文件行
    const shardName = shardFileName(shardIndexOf(HASH_A));
    const raw = h.cloudFiles(gistId)[shardName];
    const json = await decodePayload(raw);
    const legacyHash = stableHash(JSON.parse(json as string));
    localStorage.setItem(
      "quiz_app_sync_meta",
      JSON.stringify({
        lastSyncedAt: Date.now(),
        bootstrapped: true,
        rows: {
          [shardName]: {
            remoteHash: legacyHash,
            syncedAt: Date.now(),
            remoteUpdatedAt: 0,
          },
        },
      }),
    );
    h.tick();
    h.save("A");

    // 本地改了进度：老格式下应当判成「上传」
    h.studyBank(HASH_A, 6);
    const outcome = await engine.sync();
    h.save("A");

    expect(outcome.pushed).toBe(1);
    expect(
      (await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.state,
    ).toMatchObject({ currentRound: 6 });

    // 元数据换成题库行，文件行被清掉
    const meta = loadSyncMeta();
    expect(meta.rows[bankRowKey(HASH_A)]).toBeDefined();
    expect(meta.rows[shardName]).toBeUndefined();
  });

  test("关掉云同步：冲突状态立刻清空，之后一个请求都不再发", async () => {
    // 线上问题：把云同步开关关掉之后，侧边栏还在提示「有冲突待处理」——
    // 因为冲突状态只存在引擎的内存里，关开关时没人去清它。
    h.freshDevice("A");
    const a = h.open("A");
    h.seedBank(HASH_A, "题库一", "first");
    await a.sync();
    const gistId = h.store("A").value.gistId;
    h.tick();
    h.save("A");

    h.freshDevice("B");
    const b = h.open("B", { gistId });
    await b.sync();
    h.tick();
    h.save("B");

    // 两边各改各的 → 冲突
    h.engine("A");
    h.studyBank(HASH_A, 3);
    h.save("A");
    await a.sync();
    h.save("A");

    h.engine("B");
    h.studyBank(HASH_A, 9);
    h.save("B");
    const conflicted = await b.sync();
    h.save("B");
    expect(conflicted.conflicts).toEqual([HASH_A]);
    expect(b.status.conflicts).toHaveLength(1);

    // 关掉总开关
    const before = h.fake.requests.length;
    h.store("B").update({ enabled: false });

    expect(b.status.conflicts, "冲突提示要跟着关掉").toEqual([]);
    expect(b.status.phase).toBe("disabled");
    expect(b.status.message).toBe("云同步已关闭");

    // 关掉之后任何入口都不该再发请求（online 事件、排上队的防抖、UI 里的按钮）
    await b.sync();
    await b.pushLocal();
    await b.pullRemote();
    expect(h.fake.requests.length, "关掉同步后不该再碰云端").toBe(before);

    // 盘上的基准线不能被清掉：那是下次同步判断「谁改过」的依据
    expect(
      Object.keys(loadSyncMeta().rows).filter((key) => key.startsWith("bank:")),
      "关开关不该抹掉同步记账",
    ).toContain(bankRowKey(HASH_A));
  });

  test("重新打开云同步：先把状态摆正，冲突会重新报出来（数据没被动过）", async () => {
    h.freshDevice("A");
    const a = h.open("A");
    h.seedBank(HASH_A, "题库一", "first");
    await a.sync();
    const gistId = h.store("A").value.gistId;
    h.tick();
    h.save("A");

    h.freshDevice("B");
    const b = h.open("B", { gistId });
    await b.sync();
    h.tick();
    h.save("B");

    h.engine("A");
    h.studyBank(HASH_A, 3);
    h.save("A");
    await a.sync();
    h.save("A");

    h.engine("B");
    h.studyBank(HASH_A, 9);
    h.save("B");
    await b.sync();
    h.save("B");

    h.store("B").update({ enabled: false });
    expect(b.status.conflicts).toEqual([]);

    // 重新打开：自动对一次账，冲突还在（两边数据确实分叉了，不能假装没事）
    h.store("B").update({ enabled: true, autoSync: true });
    await vi.waitFor(
      () => {
        expect(b.status.conflicts).toHaveLength(1);
      },
      { timeout: 4000 },
    );

    // 谁都没被覆盖
    await expect(h.cloudShard(gistId, HASH_A)).resolves.toMatchObject({
      banks: { [HASH_A]: { state: { currentRound: 3 } } },
    });
    expect(localStorage.getItem(`quiz_app_state_${HASH_A}`)).toContain("9");
  });

  test("云端 Gist 被删之后：断开云端再同步会新建一条，本地数据照样上去", async () => {
    h.freshDevice("A");
    const engine = h.open("A");
    h.seedBank(HASH_A, "题库一", "first");
    await engine.sync();
    const store = h.store("A");
    const firstId = store.value.gistId;
    expect(firstId).toBeTruthy();
    h.tick();
    h.save("A");

    // 模拟「那条 Gist 不见了」：指向一个账号里不存在的 id
    store.update({ gistId: "gone-forever" });
    const failed = await engine.sync();
    h.save("A");
    expect(failed.pushed).toBe(0);
    expect(engine.status.phase).toBe("error");
    expect(engine.status.message).toContain("Gist");
    expect(engine.status.message).toContain("重建云端");

    // 「重建云端」= 断开（丢掉 id 与记账）→ 再同步一次就会新建一条
    engine.forgetGist();
    const rebuilt = await engine.sync();
    h.save("A");

    const secondId = h.store("A").value.gistId;
    expect(secondId).toBeTruthy();
    expect(secondId).not.toBe("gone-forever");
    expect(rebuilt.pushed).toBe(1);
    expect(await h.cloudBanks(secondId)).toEqual([HASH_A]);
  });

  test("本地什么都没有时不建空的 Gist", async () => {
    h.freshDevice("A");
    const engine = h.open("A");

    const outcome = await engine.sync();
    h.save("A");

    expect(outcome.pushed).toBe(0);
    expect(h.store("A").value.gistId).toBe("");
    expect(engine.status.message).toContain("还没有题库");
  });
});

// 让类型检查知道 SyncEngine 被用到了（同时钉住导出形状）
export type _Engine = SyncEngine;
