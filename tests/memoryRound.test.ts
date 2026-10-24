import { describe, expect, it } from "vitest";
import {
  addMemoryRoundCards,
  createMemoryRound,
  isMemoryRoundComplete,
  markMemoryRoundMastered,
  memoryRoundDone,
  memoryRoundRemaining,
  migrateLegacyMemoryRound,
  normalizeMemoryRound,
  pruneMemoryRound,
} from "../src/features/memory/round";

/**
 * 学习轮模型的三条不变式（`src/features/memory/round.ts` 文件头）：
 *
 *   1. `masteredIds ⊆ cardIds`
 *   2. `1 ≤ goal ≤ cardIds.length`
 *   3. 池子 = `cardIds - masteredIds`
 *
 * 它们就是「设 5 题、学到第 3 题突然结束」那条 bug 的防线：目标不可能超过
 * 这一批能学出来的数量。
 */

describe("记忆模式：学习轮模型", () => {
  it("开轮时目标取「设置」与「这一批有几道」的小值", () => {
    expect(createMemoryRound(["a", "b", "c", "d", "e"], 5)?.goal).toBe(5);
    expect(createMemoryRound(["a", "b", "c"], 5)?.goal).toBe(3);
    expect(createMemoryRound(["a"], 5)?.goal).toBe(1);
  });

  it("一道卡都没有时开不出一轮", () => {
    expect(createMemoryRound([], 5)).toBeNull();
  });

  it("非法 / 重复的 id 被清掉，目标跟着收敛", () => {
    const round = createMemoryRound(["a", "a", "", "b"], 5)!;
    expect(round.cardIds).toEqual(["a", "b"]);
    expect(round.goal).toBe(2);
  });

  it("补卡不会把目标顶高（目标是开轮时对用户许下的数量）", () => {
    const round = createMemoryRound(["a", "b"], 2)!;
    const grown = addMemoryRoundCards(round, ["c", "d"]);
    expect(grown.cardIds).toEqual(["a", "b", "c", "d"]);
    expect(grown.goal).toBe(2);
    // 重复补同一道不会长第二份
    expect(addMemoryRoundCards(grown, ["c"]).cardIds).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("掌握一道：计入本轮、离开池子；本轮之外的卡不算", () => {
    const round = createMemoryRound(["a", "b", "c"], 3)!;
    const afterA = markMemoryRoundMastered(round, "a");
    expect(memoryRoundDone(afterA)).toBe(1);
    expect(memoryRoundRemaining(afterA)).toEqual(["b", "c"]);

    // 不在这批里的卡：原样返回（不能凭空把本轮进度顶上去）
    expect(markMemoryRoundMastered(afterA, "z")).toBe(afterA);
    // 重复记同一道也不会数两次
    expect(memoryRoundDone(markMemoryRoundMastered(afterA, "a"))).toBe(1);
  });

  it("学满目标就算这一轮完成", () => {
    let round = createMemoryRound(["a", "b"], 2)!;
    expect(isMemoryRoundComplete(round)).toBe(false);
    round = markMemoryRoundMastered(round, "a");
    expect(isMemoryRoundComplete(round)).toBe(false);
    round = markMemoryRoundMastered(round, "b");
    expect(isMemoryRoundComplete(round)).toBe(true);
  });

  it("读盘净化：目标收敛到这一批的数量，已掌握只留这一批里的", () => {
    const round = normalizeMemoryRound({
      goal: 5,
      cardIds: ["a", "b", "c", "c"],
      masteredIds: ["a", "z"],
    })!;
    expect(round.cardIds).toEqual(["a", "b", "c"]);
    expect(round.goal).toBe(3);
    expect(round.masteredIds).toEqual(["a"]);
  });

  it("读盘净化：题库里没了的卡被剔掉，目标跟着降", () => {
    const round = normalizeMemoryRound(
      { goal: 5, cardIds: ["a", "b", "c"], masteredIds: ["b"] },
      new Set(["a", "b"]),
    )!;
    expect(round.cardIds).toEqual(["a", "b"]);
    expect(round.goal).toBe(2);
    expect(round.masteredIds).toEqual(["b"]);
    // 一张都不剩 → 没有进行中的一轮
    expect(
      normalizeMemoryRound({ goal: 5, cardIds: ["x"] }, new Set(["a"])),
    ).toBeUndefined();
  });

  it("剔除「已经不属于这一轮」的卡，但已掌握的始终留着", () => {
    const round = markMemoryRoundMastered(
      createMemoryRound(["a", "b", "c"], 3)!,
      "b",
    );
    // a 在别处被标熟了（不再是「能学」的卡），c 还能学
    const pruned = pruneMemoryRound(
      round,
      (id) => id !== "a" && id !== "b",
    )!;
    // b 已掌握 → 留着（否则本轮进度凭空变少、永远学不完）；a 被剔掉
    expect(pruned.cardIds).toEqual(["b", "c"]);
    expect(pruned.masteredIds).toEqual(["b"]);
    expect(pruned.goal).toBe(2);
  });

  it("旧版三份字段迁移：这一批取池子，目标收敛到学得完的数量", () => {
    const round = migrateLegacyMemoryRound({
      roundGoal: 5,
      roundPoolIds: ["a", "b"],
      activePoolIds: ["a", "b"],
    })!;
    expect(round.cardIds).toEqual(["a", "b"]);
    expect(round.goal).toBe(2);
    // 旧数据没记「哪几道已掌握」，只能从 0 重新数
    expect(round.masteredIds).toEqual([]);

    // 没有池子就没有可续的一轮
    expect(
      migrateLegacyMemoryRound({ roundGoal: 5, activePoolIds: [] }),
    ).toBeUndefined();
  });

  it("旧版迁移：学到一半去复习过的那份，取 `learningPool` 而不是到期队列", () => {
    // 复习期间旧版把学习池挪进 `learningPool`，`activePool` 换成了到期队列
    const round = migrateLegacyMemoryRound({
      roundGoal: 5,
      learningPoolIds: ["a", "b", "c"],
      activePoolIds: ["z"],
    })!;
    expect(round.cardIds).toEqual(["a", "b", "c"]);
    expect(round.goal).toBe(3);
  });
});
