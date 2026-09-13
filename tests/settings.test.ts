import { describe, it, expect, vi, afterEach } from "vitest";
import { reconcileAfterSettingsChange } from "../src/features/quiz/settings";
import { sanitizeBankSettings } from "../src/bankSettings";
import { createActivePoolItem, createDefaultSettings } from "../src/store";
import {
  ACTIVE_POOL_SIZE,
  CORRECT_STREAK_TO_MASTER,
  CORRECT_STREAK_AFTER_MISTAKE,
} from "../src/config";
import type {
  Question,
  RuntimeState,
  ActivePoolItem,
  QuestionType,
  BankSettings,
} from "../src/types";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeQuestion(id: string, type: QuestionType = "judgment"): Question {
  return { id, type, question: `q-${id}`, answer: true };
}

function makeSettings(overrides: Partial<BankSettings> = {}): BankSettings {
  return { ...createDefaultSettings(), ...overrides };
}

function makeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    masteredIds: [],
    activePool: [],
    pendingIds: [],
    currentRound: 0,
    filterType: "all",
    settings: makeSettings(),
    ...overrides,
  };
}

function poolItem(
  id: string,
  patch: Partial<ActivePoolItem> = {},
): ActivePoolItem {
  return { ...createActivePoolItem(id), hasBeenShown: true, ...patch };
}

// ---------------------------------------------------------------------------
// sanitizeBankSettings
// ---------------------------------------------------------------------------

describe("sanitizeBankSettings / notifyNewQuestionInPool", () => {
  it("仅接受显式 true，其他值一律 false", () => {
    expect(
      sanitizeBankSettings(makeSettings({ notifyNewQuestionInPool: true }))
        .notifyNewQuestionInPool,
    ).toBe(true);
    expect(
      sanitizeBankSettings(makeSettings({ notifyNewQuestionInPool: false }))
        .notifyNewQuestionInPool,
    ).toBe(false);
    expect(
      sanitizeBankSettings(
        makeSettings({ notifyNewQuestionInPool: 1 as unknown as boolean }),
      ).notifyNewQuestionInPool,
    ).toBe(false);
  });
});

describe("sanitizeBankSettings / 忽略旧版全局字段", () => {
  it("旧设置里混入的 audioNextOnCorrect / soundEnabled 等不会出现在结果里", () => {
    const result = sanitizeBankSettings({
      ...makeSettings(),
      autoNextOnCorrect: true,
      autoSubmitOnSelection: false,
      soundEnabled: true,
    });
    expect("autoNextOnCorrect" in result).toBe(false);
    expect("autoSubmitOnSelection" in result).toBe(false);
    expect("soundEnabled" in result).toBe(false);
  });
});

describe("sanitizeBankSettings / activePoolSize", () => {
  it("低于下界 → 钳到 5", () => {
    const result = sanitizeBankSettings(makeSettings({ activePoolSize: 2 }));
    expect(result.activePoolSize).toBe(5);
  });

  it("高于上界 → 钳到 100", () => {
    const result = sanitizeBankSettings(makeSettings({ activePoolSize: 500 }));
    expect(result.activePoolSize).toBe(100);
  });

  it("范围内保留", () => {
    expect(sanitizeBankSettings(makeSettings({ activePoolSize: 25 })).activePoolSize).toBe(25);
    expect(sanitizeBankSettings(makeSettings({ activePoolSize: 5 })).activePoolSize).toBe(5);
    expect(sanitizeBankSettings(makeSettings({ activePoolSize: 100 })).activePoolSize).toBe(100);
  });

  it("非数字/NaN → 回退默认值", () => {
    const r1 = sanitizeBankSettings(
      makeSettings({ activePoolSize: NaN }),
    );
    expect(r1.activePoolSize).toBe(ACTIVE_POOL_SIZE);
    const r2 = sanitizeBankSettings(
      makeSettings({ activePoolSize: "foo" as unknown as number }),
    );
    expect(r2.activePoolSize).toBe(ACTIVE_POOL_SIZE);
    const r3 = sanitizeBankSettings(
      makeSettings({ activePoolSize: undefined as unknown as number }),
    );
    expect(r3.activePoolSize).toBe(ACTIVE_POOL_SIZE);
  });

  it("小数会被四舍五入", () => {
    expect(
      sanitizeBankSettings(makeSettings({ activePoolSize: 25.7 }))
        .activePoolSize,
    ).toBe(26);
  });
});

describe("sanitizeBankSettings / correctStreakToMaster", () => {
  it("越界 → 钳到边界", () => {
    expect(
      sanitizeBankSettings(makeSettings({ correctStreakToMaster: 0 }))
        .correctStreakToMaster,
    ).toBe(1);
    expect(
      sanitizeBankSettings(makeSettings({ correctStreakToMaster: 99 }))
        .correctStreakToMaster,
    ).toBe(10);
  });

  it("范围内保留", () => {
    expect(
      sanitizeBankSettings(makeSettings({ correctStreakToMaster: 3 }))
        .correctStreakToMaster,
    ).toBe(3);
  });

  it("非数字 → 默认值", () => {
    expect(
      sanitizeBankSettings(makeSettings({ correctStreakToMaster: NaN }))
        .correctStreakToMaster,
    ).toBe(CORRECT_STREAK_TO_MASTER);
  });
});

describe("sanitizeBankSettings / correctStreakAfterMistake", () => {
  it("越界 → 钳到边界", () => {
    expect(
      sanitizeBankSettings(makeSettings({ correctStreakAfterMistake: 0 }))
        .correctStreakAfterMistake,
    ).toBe(1);
    expect(
      sanitizeBankSettings(makeSettings({ correctStreakAfterMistake: 999 }))
        .correctStreakAfterMistake,
    ).toBe(20);
  });

  it("非数字 → 默认值", () => {
    expect(
      sanitizeBankSettings(makeSettings({ correctStreakAfterMistake: NaN }))
        .correctStreakAfterMistake,
    ).toBe(CORRECT_STREAK_AFTER_MISTAKE);
  });
});

describe("sanitizeBankSettings / selectionMode", () => {
  it("sequential 保留", () => {
    expect(
      sanitizeBankSettings(makeSettings({ selectionMode: "sequential" }))
        .selectionMode,
    ).toBe("sequential");
  });

  it("random 保留", () => {
    expect(
      sanitizeBankSettings(makeSettings({ selectionMode: "random" }))
        .selectionMode,
    ).toBe("random");
  });

  it("非合法值 → 回退 random", () => {
    expect(
      sanitizeBankSettings(
        makeSettings({ selectionMode: "invalid" as unknown as "random" }),
      ).selectionMode,
    ).toBe("random");
    expect(
      sanitizeBankSettings(
        makeSettings({ selectionMode: undefined as unknown as "random" }),
      ).selectionMode,
    ).toBe("random");
  });
});

// ---------------------------------------------------------------------------
// reconcileAfterSettingsChange
// ---------------------------------------------------------------------------

describe("reconcileAfterSettingsChange / 池缩小", () => {
  it("池缩小时保留当前题（即使需要替换最后一位）", () => {
    // sequential 模式让 fillActivePool 行为可预测
    // 注意 sanitizeBankSettings 会把 activePoolSize 钳到 [5,100]
    const questions = [
      makeQuestion("a"),
      makeQuestion("b"),
      makeQuestion("c"),
      makeQuestion("d"),
      makeQuestion("e"),
      makeQuestion("f"),
      makeQuestion("g"),
      makeQuestion("h"),
    ];
    const state = makeState({
      activePool: [
        poolItem("a"),
        poolItem("b"),
        poolItem("c"),
        poolItem("d"),
        poolItem("e"),
        poolItem("f"),
        poolItem("g"),
        poolItem("h"),
      ],
      settings: makeSettings({
        activePoolSize: 5,
        selectionMode: "sequential",
      }),
    });
    // 当前题是 "h"，trim 后默认保留 [a..e]，需要把 e 替换成 h
    const result = reconcileAfterSettingsChange(questions, state, "h");
    const ids = result.state.activePool.map((i) => i.id);
    expect(ids).toContain("h");
    expect(result.state.activePool).toHaveLength(5);
    expect(result.shouldSelectNext).toBe(false);
  });

  it("当前题已在前 N 位时正常保留前 N 位", () => {
    const questions = Array.from({ length: 8 }, (_, i) =>
      makeQuestion(String.fromCharCode(97 + i)),
    );
    const state = makeState({
      activePool: questions.map((q) => poolItem(q.id)),
      settings: makeSettings({
        activePoolSize: 5,
        selectionMode: "sequential",
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state, "a");
    expect(result.state.activePool.map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(result.shouldSelectNext).toBe(false);
  });

  it("无 currentQuestionId 时按顺序 trim", () => {
    const questions = Array.from({ length: 8 }, (_, i) =>
      makeQuestion(String.fromCharCode(97 + i)),
    );
    const state = makeState({
      activePool: questions.map((q) => poolItem(q.id)),
      settings: makeSettings({
        activePoolSize: 5,
        selectionMode: "sequential",
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state);
    expect(result.state.activePool.map((i) => i.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    expect(result.shouldSelectNext).toBe(false);
  });
});

describe("reconcileAfterSettingsChange / 阈值变化导致掌握", () => {
  it("streak 阈值变低使某些题已达标 → 进 mastered、从 池移除", () => {
    const questions = [
      makeQuestion("a"),
      makeQuestion("b"),
      makeQuestion("c"),
    ];
    // 设置阈值改为 2，且 a 已经连续答对 2 次 → 应当被视为已掌握
    const state = makeState({
      activePool: [
        poolItem("a", { consecutiveCorrect: 2, hasEverMistaken: false }),
        poolItem("b", { consecutiveCorrect: 1, hasEverMistaken: false }),
        poolItem("c", { consecutiveCorrect: 0, hasEverMistaken: false }),
      ],
      settings: makeSettings({
        activePoolSize: 5,
        correctStreakToMaster: 2,
        correctStreakAfterMistake: 4,
        selectionMode: "sequential",
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state);
    expect(result.state.masteredIds).toContain("a");
    expect(result.state.activePool.some((i) => i.id === "a")).toBe(false);
  });

  it("hasEverMistaken=true 走 correctStreakAfterMistake 阈值", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      activePool: [
        poolItem("a", { consecutiveCorrect: 3, hasEverMistaken: true }),
        poolItem("b", { consecutiveCorrect: 3, hasEverMistaken: false }),
      ],
      settings: makeSettings({
        activePoolSize: 5,
        // mistake 阈值降到 3：a 应该升级
        correctStreakToMaster: 5,
        correctStreakAfterMistake: 3,
        selectionMode: "sequential",
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state);
    expect(result.state.masteredIds).toContain("a");
    expect(result.state.masteredIds).not.toContain("b");
  });
});

describe("reconcileAfterSettingsChange / shouldSelectNext", () => {
  it("currentQuestion 被踢出池（因达到 mastered 阈值）→ shouldSelectNext=true", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      activePool: [
        poolItem("a", { consecutiveCorrect: 2, hasEverMistaken: false }),
        poolItem("b", { consecutiveCorrect: 0 }),
      ],
      settings: makeSettings({
        activePoolSize: 5,
        correctStreakToMaster: 2, // a 现在符合 mastered
        correctStreakAfterMistake: 4,
        selectionMode: "sequential",
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state, "a");
    expect(result.shouldSelectNext).toBe(true);
    expect(result.state.activePool.some((i) => i.id === "a")).toBe(false);
  });

  it("currentQuestion 仍在池中 → shouldSelectNext=false", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      activePool: [poolItem("a"), poolItem("b")],
      settings: makeSettings({
        activePoolSize: 5,
        selectionMode: "sequential",
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state, "a");
    expect(result.shouldSelectNext).toBe(false);
  });

  it("无 currentQuestionId → shouldSelectNext=false", () => {
    const questions = [makeQuestion("a")];
    const state = makeState({
      activePool: [poolItem("a")],
      settings: makeSettings({
        activePoolSize: 5,
        selectionMode: "sequential",
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state);
    expect(result.shouldSelectNext).toBe(false);
  });
});

describe("reconcileAfterSettingsChange / 未展示题回流", () => {
  it("设置变化时移除未展示活动题，并按当前设置重新补池", () => {
    const questions = [
      makeQuestion("a"),
      makeQuestion("b"),
      makeQuestion("c"),
      makeQuestion("d"),
      makeQuestion("e"),
      makeQuestion("f"),
    ];
    const state = makeState({
      activePool: [
        poolItem("c", { hasBeenShown: true }),
        poolItem("d", { hasBeenShown: false }),
      ],
      settings: makeSettings({
        activePoolSize: 5,
        selectionMode: "sequential",
      }),
    });

    const result = reconcileAfterSettingsChange(questions, state, "c");

    expect(result.state.activePool.map((item) => item.id)).toEqual([
      "c",
      "a",
      "b",
      "d",
      "e",
    ]);
    expect(result.state.pendingIds).toEqual(["f"]);
  });
});

describe("reconcileAfterSettingsChange / 返回结构", () => {
  it("返回 { state, shouldSelectNext }", () => {
    const questions = [makeQuestion("a")];
    const state = makeState({
      activePool: [poolItem("a")],
    });
    const result = reconcileAfterSettingsChange(questions, state);
    expect(result).toHaveProperty("state");
    expect(result).toHaveProperty("shouldSelectNext");
    expect(typeof result.shouldSelectNext).toBe("boolean");
  });

  it("返回的 state 是 RuntimeState（含 pendingIds）", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      activePool: [poolItem("a")],
      settings: makeSettings({
        activePoolSize: 5,
        selectionMode: "sequential",
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state);
    expect(Array.isArray(result.state.pendingIds)).toBe(true);
    // fillActivePool 把 b 拉进 pool
    expect(result.state.activePool.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("会用 sanitized settings 覆盖输入中的非法值", () => {
    const questions = [makeQuestion("a")];
    const state = makeState({
      activePool: [poolItem("a")],
      settings: makeSettings({
        activePoolSize: 1000, // 越界
        selectionMode: "invalid" as unknown as "random",
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state);
    expect(result.state.settings.activePoolSize).toBe(100);
    expect(result.state.settings.selectionMode).toBe("random");
  });

  it("保留按库的 notifyNewQuestionInPool 偏好", () => {
    const questions = [makeQuestion("a")];
    const state = makeState({
      activePool: [poolItem("a")],
      settings: makeSettings({
        activePoolSize: 5,
        selectionMode: "sequential",
        notifyNewQuestionInPool: true,
      }),
    });
    const result = reconcileAfterSettingsChange(questions, state);
    expect(result.state.settings.notifyNewQuestionInPool).toBe(true);
  });
});
