/**
 * **账本不该把每个题库的全文再存一遍。**
 *
 * 审计实测：200 题的题库 `quiz_app_questions_X` = 37 071 B，而
 * `quiz_app_sync_meta` = 37 532 B——本地占用直接翻倍。而它正是最容易先撞上
 * localStorage 配额（约 5 MB）的那个键，撞上之后 `saveSyncMeta` 的失败还是**静默**的
 * （被 `console.warn` 吞掉）→ `pendingChanges` 永远黄、每轮基于陈旧基准重规划、
 * 又因为"内容没变就不传"的短路变成**静默空转**。
 *
 * 账本里那份"上次同步成功时的快照"只有一处读它：`buildSyncPlan` 把它当三方参照
 * 交给 `decideBank`，而 `mergeBankState` 只从里面读 `state`。所以 `mode` + `state`
 * 就够，题目数组是纯粹的冗余。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { SyncHarness } from "./syncSupport";

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

/** 300 道、题干带点重复的题——和真实题库的体积分布接近。 */
function bigQuestions(): unknown[] {
  return Array.from({ length: 300 }, (_, i) => ({
    id: `q${i}`,
    type: "memory",
    question: `第 ${i} 题的题干，写得长一点更接近真实体积。`.repeat(3),
    answer: `第 ${i} 题的答案。`.repeat(2),
  }));
}

describe("账本体积", () => {
  test("不随题目数量增长（题目数组不再被复制一份）", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "x");
    localStorage.setItem(`quiz_app_questions_${HASH_A}`, JSON.stringify(bigQuestions()));
    h.tick();
    h.setActive(HASH_A);
    h.open("A");
    await h.on("A", (engine) => engine.sync());

    const questionsBytes = localStorage.getItem(`quiz_app_questions_${HASH_A}`)!.length;
    const metaBytes = localStorage.getItem("quiz_app_sync_meta")!.length;

    // 账本里还记着题库行、general 基准、冲突记录，所以不是零；关键是**不含题目**。
    expect(
      metaBytes,
      `账本把题目又存了一遍：题目 ${questionsBytes} B，账本 ${metaBytes} B`,
    ).toBeLessThan(questionsBytes / 4);

    // 那份快照仍然在（三方合并要用），而且仍然带着 state
    const meta = JSON.parse(localStorage.getItem("quiz_app_sync_meta") ?? "{}");
    const row = meta.rows[`bank:${HASH_A}`];
    expect(row, "题库行不见了").toBeDefined();
    expect(row.snapshot, "三方参照没了，合并会退化成「两边各取更靠前的」").toBeDefined();
    expect("questions" in row.snapshot, "账本里还留着题目数组").toBe(false);
  });

  test("瘦身之后，三方合并照常工作（基准里的 state 还在被读到）", async () => {
    h.freshDevice("A");
    h.seedBank(HASH_A, "题库一", "x");
    h.setActive(HASH_A);
    h.open("A");
    await h.on("A", (engine) => engine.sync());
    const gistId = h.store("A").value.gistId;
    h.save("A");
    h.freshDevice("B");
    h.open("B", { gistId });
    await h.on("B", (engine) => engine.sync());
    h.save("B");

    const study = (progress: Record<string, unknown>) => {
      const raw = JSON.parse(localStorage.getItem(`quiz_app_state_${HASH_A}`) ?? "{}");
      localStorage.setItem(
        `quiz_app_state_${HASH_A}`,
        JSON.stringify({ ...raw, memory: { ...(raw.memory ?? {}), progress } }),
      );
      h.tick();
    };
    const card = (level: number, nextDue: number, rev: number) => ({
      state: "reviewing",
      level,
      streak: 0,
      nextDue,
      lapses: 0,
      rev,
    });

    h.engine("A");
    study({ q1: card(3, 111, 5000) });
    h.save("A");
    h.engine("B");
    study({ q1: card(5, 222, 6000) });
    h.save("B");

    h.engine("B");
    await h.on("B", (engine) => engine.sync());
    h.engine("A");
    const merged = await h.on("A", (engine) => engine.sync());
    expect(merged.conflicts).toEqual([]);

    h.engine("A");
    const state = JSON.parse(localStorage.getItem(`quiz_app_state_${HASH_A}`) ?? "{}");
    // 更晚的那份（rev 6000）整条赢——包括它的 level 与 nextDue，不许错配
    expect(state.memory.progress.q1.level).toBe(5);
    expect(state.memory.progress.q1.nextDue).toBe(222);
  });
});
