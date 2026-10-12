/**
 * **刷题模式（quiz）的进度也必须按卡/按字段合并**。
 *
 * 审计复现：`planProgressMerge` 的"要不要合"只看 `state.memory.progress`，
 * 而刷题模式的进度在 `masteredIds` / `masteredMistakes` / `currentRound` 里
 * ——于是它**永远算不出"云端有新东西"** ⇒ 永远 skip ⇒ 本地那份整份盖上去，
 * 云端那份静默消失（没有冲突、没有「合并进度」、指示点还是绿的）。
 *
 * `model/merge.ts` 里刷题那一支的合并算子（`mergeHighWaterSet` /
 * `mergeNumberRecord` / `currentRound` 取大）本身是对的，只是**从来没人调用**
 * ——这段就是让那条路真的被走到。
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

/** 造一个**刷题模式**题库（`seedBank` 只会造记忆题库）。 */
function seedQuizBank(hash: string, name: string): void {
  localStorage.setItem(
    `quiz_app_questions_${hash}`,
    JSON.stringify([
      { id: "q1", type: "judgment", question: "1+1=2？", answer: true },
      { id: "q2", type: "judgment", question: "2+2=5？", answer: false },
    ]),
  );
  localStorage.setItem(
    `quiz_app_state_${hash}`,
    JSON.stringify({
      masteredIds: [],
      masteredMistakes: {},
      activePool: [],
      currentRound: 1,
      filterType: "all",
      settings: {
        activePoolSize: 25,
        correctStreakToMaster: 3,
        correctStreakAfterMistake: 4,
        selectionMode: "random",
        notifyNewQuestionInPool: false,
      },
      ui: { progressFocused: false, showPool: false },
    }),
  );
  const general = JSON.parse(localStorage.getItem("quiz_app_general") ?? "{}");
  general.library = [
    ...(general.library ?? []).filter((b: { hash: string }) => b.hash !== hash),
    { hash, name, mode: "quiz", count: 2, addedAt: Date.now() },
  ];
  localStorage.setItem("quiz_app_general", JSON.stringify(general));
  h.tick();
}

function patchState(hash: string, patch: Record<string, unknown>): void {
  const raw = JSON.parse(localStorage.getItem(`quiz_app_state_${hash}`) ?? "{}");
  localStorage.setItem(`quiz_app_state_${hash}`, JSON.stringify({ ...raw, ...patch }));
  h.tick();
}

function localState(hash: string): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(`quiz_app_state_${hash}`) ?? "{}");
}

/** 两台设备都看到同一个刷题题库（B 接上 A 的云端）。 */
async function twoDevices(): Promise<string> {
  h.freshDevice("A");
  seedQuizBank(HASH_A, "题库一");
  h.setActive(HASH_A);
  h.open("A");
  await h.on("A", (engine) => engine.sync());
  const gistId = h.store("A").value.gistId;
  h.save("A");

  h.freshDevice("B");
  h.open("B", { gistId });
  await h.on("B", (engine) => engine.sync());
  h.save("B");
  return gistId;
}

describe("刷题模式的进度分叉要合并，不能整份盖掉", () => {
  test("A 掌握 q1、B 掌握 q2 → 两边都该在（本地与云端）", async () => {
    const gistId = await twoDevices();

    h.engine("A");
    patchState(HASH_A, { masteredIds: ["q1"] });
    h.save("A");
    h.engine("B");
    patchState(HASH_A, { masteredIds: ["q2"] });
    h.save("B");

    // B 先同步（把 q2 推上去），A 再同步
    h.engine("B");
    await h.on("B", (engine) => engine.sync());
    h.engine("A");
    await h.on("A", (engine) => engine.sync());

    h.engine("A");
    expect(
      [...(localState(HASH_A).masteredIds as string[])].sort(),
      "A 自己掌握的 q1 被云端那份盖掉了",
    ).toEqual(["q1", "q2"]);

    const cloud = (await h.cloudShard(gistId, HASH_A))?.banks[HASH_A]?.state as {
      masteredIds: string[];
    };
    expect([...cloud.masteredIds].sort(), "云端也该是并集").toEqual(["q1", "q2"]);
  });

  test("`currentRound` 取两边最大值（不是谁在本地谁赢）", async () => {
    await twoDevices();

    h.engine("A");
    patchState(HASH_A, { currentRound: 12 });
    h.save("A");
    h.engine("B");
    patchState(HASH_A, { currentRound: 7 });
    h.save("B");

    h.engine("B");
    await h.on("B", (engine) => engine.sync());
    h.engine("A");
    await h.on("A", (engine) => engine.sync());

    h.engine("A");
    expect(localState(HASH_A).currentRound, "取大的那个").toBe(12);
  });

  test("`masteredMistakes` 逐键取大（两边的键都留着）", async () => {
    await twoDevices();

    h.engine("A");
    patchState(HASH_A, { masteredMistakes: { q1: 2 } });
    h.save("A");
    h.engine("B");
    patchState(HASH_A, { masteredMistakes: { q2: 5 } });
    h.save("B");

    h.engine("B");
    await h.on("B", (engine) => engine.sync());
    h.engine("A");
    await h.on("A", (engine) => engine.sync());

    h.engine("A");
    expect(localState(HASH_A).masteredMistakes, "两边的键都要在").toEqual({
      q1: 2,
      q2: 5,
    });
  });

  test("两边都没从云端拿到新东西时**不算合并**（别虚报「合并进度」）", async () => {
    await twoDevices();

    h.engine("A");
    patchState(HASH_A, { currentRound: 3 });
    h.save("A");
    const outcome = await h.on("A", (engine) => engine.sync());
    expect(outcome.progressMerged, "只是上传自己的改动，不该报合并").toBe(0);
    expect(outcome.pushed).toBe(1);
  });
});
