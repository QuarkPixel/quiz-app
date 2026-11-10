/**
 * 「重置进度」在合并时的传播。
 *
 * `masteredIds` 是 highWaterSet（只涨不落），所以一次重置在合并时会被另一台
 * 设备的旧值原样复活——这就是「A 重置了、同步完又全回来了」。现在重置会盖一个
 * `resetRev`，两边不一致时戳大的那一侧整段赢。
 */

import { describe, it, expect } from "vitest";
import { mergeBankState } from "@/features/sync/model/merge";

type Merged = {
  masteredIds: string[];
  masteredMistakes: Record<string, boolean>;
  activePool: { id: string; rev?: number }[];
  resetRev?: number;
  quizSession?: { currentId: string; phase: string };
};

function merge(params: Parameters<typeof mergeBankState>[0]): Merged {
  return mergeBankState(params) as unknown as Merged;
}

function poolItem(id: string, rev: number) {
  return {
    id,
    consecutiveCorrect: 1,
    hasEverMistaken: false,
    hasBeenShown: true,
    lastSelectedRound: 1,
    rev,
  };
}

describe("resetRev：重置是一条会传播的删除", () => {
  it("A 重置（戳更大）→ 另一端的旧 masteredIds 不复活", () => {
    const merged = merge({
      base: { masteredIds: ["q1"], activePool: [], resetRev: 100 },
      // A 刚重置：masteredIds 空、戳更新
      local: { masteredIds: [], activePool: [], resetRev: 200 },
      // B 还停在重置前
      remote: { masteredIds: ["q1", "q2"], activePool: [], resetRev: 100 },
      mode: "quiz",
    });

    expect(merged.masteredIds).toEqual([]);
    expect(merged.resetRev).toBe(200);
  });

  it("重置后另一端新学的池子条目（rev 更大）保留", () => {
    const merged = merge({
      local: { masteredIds: [], activePool: [], resetRev: 200 },
      remote: {
        masteredIds: [],
        activePool: [poolItem("q3", 300)],
        resetRev: 100,
      },
      mode: "quiz",
    });

    expect(merged.activePool.map((item) => item.id)).toEqual(["q3"]);
    expect(merged.resetRev).toBe(200);
  });

  it("重置前就存在的池子条目不会被并集带回来", () => {
    const merged = merge({
      local: { masteredIds: [], activePool: [], resetRev: 200 },
      remote: {
        masteredIds: [],
        // 这条的 rev 早于重置 → 它是重置前的旧池子
        activePool: [poolItem("q3", 100)],
        resetRev: 100,
      },
      mode: "quiz",
    });

    expect(merged.activePool).toEqual([]);
  });

  it("两边都没重置过（都是 0）→ 照常并集，不受影响", () => {
    const merged = merge({
      local: { masteredIds: ["q1"], activePool: [] },
      remote: { masteredIds: ["q2"], activePool: [] },
      mode: "quiz",
    });

    expect([...merged.masteredIds].sort()).toEqual(["q1", "q2"]);
    expect(merged.resetRev).toBeUndefined();
  });

  it("记忆模式：重置会丢掉另一端的旧进度条目", () => {
    const card = (rev: number) => ({
      state: "reviewing" as const,
      level: 2,
      streak: 0,
      nextDue: 0,
      lapses: 0,
      rev,
    });

    const merged = mergeBankState({
      local: {
        masteredIds: [],
        resetRev: 200,
        memory: { progress: {}, settings: {} },
      },
      remote: {
        masteredIds: [],
        resetRev: 100,
        memory: { progress: { q1: card(100) }, settings: {} },
      },
      mode: "memory",
    }) as unknown as { memory: { progress: Record<string, unknown> } };

    expect(merged.memory.progress).toEqual({});
  });
});
