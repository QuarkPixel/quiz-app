/**
 * **「今天 / 本轮」的会话状态不跨设备，而且同步不许把它擦掉。**
 *
 * 用户报的现象：把 14 道待复习全部复习完 → 同步 → 首页又冒出
 * 「今天有一道待复习」，反复复习掉、反复出现。
 *
 * 根因不是进度合并：`memory.retry`（答错后还要重新连对几次）当时在**同步白名单**里。
 * 于是云端留着一条旧待办（比如补完之前的快照，或另一台设备的状态），
 * 合并（取并集）把它**复活** → `reviewQueueToday()` 里"待补"那一支把它重新排进
 * 今天的复习队列 → 首页显示 1 道待复习，而它的 `nextDue` 明明在将来。
 *
 * 所以它们被划成**设备本地字段**：不进快照、不参与合并、写回时贴回本机那份。
 * 两条边界都要顾——**不传出去**，也**不被别人的擦掉**。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { SyncHarness } from "./syncSupport";
import { encodePayload } from "@/features/sync/payload";
import { shardFileName, shardIndexOf } from "@/features/sync/types";

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

function patchMemory(hash: string, patch: Record<string, unknown>): void {
  const raw = JSON.parse(localStorage.getItem(`quiz_app_state_${hash}`) ?? "{}");
  localStorage.setItem(
    `quiz_app_state_${hash}`,
    JSON.stringify({ ...raw, memory: { ...(raw.memory ?? {}), ...patch } }),
  );
  h.tick();
}

function localMemory(hash: string): Record<string, unknown> {
  return (
    JSON.parse(localStorage.getItem(`quiz_app_state_${hash}`) ?? "{}").memory ?? {}
  );
}

async function syncedBank(): Promise<string> {
  h.freshDevice("A");
  h.seedBank(HASH_A, "题库一", "x");
  h.setActive(HASH_A);
  h.open("A");
  await h.on("A", (engine) => engine.sync());
  const gistId = h.store("A").value.gistId;
  h.save("A");
  return gistId;
}

describe("会话状态（retry / review）不跨设备", () => {
  test("本机今天复习到哪了 + 待补的连对，同步之后原样都在", async () => {
    await syncedBank();

    h.engine("A");
    patchMemory(HASH_A, {
      retry: { day: 20000, targets: { q7: 2 } },
      review: { day: 20000, reviewedIds: ["q1", "q2"], total: 6 },
    });
    h.save("A");

    h.engine("A");
    await h.on("A", (engine) => engine.sync());

    h.engine("A");
    const memory = localMemory(HASH_A);
    expect(memory.retry, "本机待补的连对被同步擦掉了").toEqual({
      day: 20000,
      targets: { q7: 2 },
    });
    expect(memory.review, "今天的复习进度被同步擦掉了").toEqual({
      day: 20000,
      reviewedIds: ["q1", "q2"],
      total: 6,
    });
  });

  test("云端不该带上它们（传出去就等着互相干扰）", async () => {
    const gistId = await syncedBank();

    h.engine("A");
    patchMemory(HASH_A, {
      retry: { day: 20000, targets: { q7: 2 } },
      review: { day: 20000, reviewedIds: ["q1"], total: 6 },
    });
    h.save("A");
    h.engine("A");
    await h.on("A", (engine) => engine.sync());

    const cloud = (await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.state as {
      memory?: Record<string, unknown>;
    };
    expect(cloud.memory?.retry, "待补的连对不该上云").toBeUndefined();
    expect(cloud.memory?.review, "今天的复习进度不该上云").toBeUndefined();
  });

  test("用户报的那条路径：云端留着一条旧待办 → **不许**复活成本机的一道「待复习」", async () => {
    const gistId = await syncedBank();

    // 本机：已经把待办补完了（targets 空）
    h.engine("A");
    patchMemory(HASH_A, { retry: { day: 20000, targets: {} } });
    h.save("A");
    h.engine("A");
    await h.on("A", (engine) => engine.sync());

    // 云端那份旧快照里还留着一条待补（老数据 / 另一台设备留下的）
    h.engine("A");
    const state = JSON.parse(localStorage.getItem(`quiz_app_state_${HASH_A}`) ?? "{}");
    const questions = JSON.parse(
      localStorage.getItem(`quiz_app_questions_${HASH_A}`) ?? "[]",
    );
    h.fake.put(
      gistId,
      shardFileName(shardIndexOf(HASH_A)),
      await encodePayload({
        banks: {
          [HASH_A]: {
            mode: "memory",
            name: "题库一",
            questions,
            state: {
              ...state,
              memory: {
                ...(state.memory ?? {}),
                retry: { day: 20000, targets: { q7: 2 } },
              },
            },
          },
        },
      }),
    );

    h.engine("A");
    await h.on("A", (engine) => engine.sync());

    h.engine("A");
    const memory = localMemory(HASH_A);
    expect(
      memory.retry && (memory.retry as { targets: Record<string, unknown> }).targets,
      "云端那条旧待办把本机已经补完的题复活了——首页会多出一道「今天待复习」",
    ).toEqual({});
  });
});
