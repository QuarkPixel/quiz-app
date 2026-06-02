import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  loadRuntimeState,
  rebuildRuntimeState,
  createResetRuntimeState,
} from "../src/features/quiz/runtime";
import {
  createActivePoolItem,
  createDefaultSettings,
  saveState,
} from "../src/store";
import {
  STORAGE_PREFIX_STATE,
  ACTIVE_POOL_SIZE,
  CORRECT_STREAK_TO_MASTER,
  CORRECT_STREAK_AFTER_MISTAKE,
} from "../src/config";
import type {
  Question,
  QuestionType,
  RuntimeState,
  StoredState,
} from "../src/types";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeQuestion(id: string, type: QuestionType = "judgment"): Question {
  return { id, type, question: `q-${id}`, answer: true };
}

const HASH = "test_hash";

// ---------------------------------------------------------------------------
// loadRuntimeState
// ---------------------------------------------------------------------------

describe("loadRuntimeState", () => {
  it("localStorage 空 → 默认 StoredState + computed pendingIds", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
    ];
    const state = loadRuntimeState(questions, HASH);
    expect(state.masteredIds).toEqual([]);
    expect(state.activePool).toEqual([]);
    expect(state.currentRound).toBe(0);
    expect(state.filterType).toBe("all");
    expect(state.settings).toEqual({
      ...createDefaultSettings(),
      soundEnabled: false,
    });
    expect(state.pendingIds).toEqual(["a", "b"]);
  });

  it("filterType 不在题库可用类型里 → 被 normalize 到 'all'", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
    ];
    // 存储 filterType=blank，但题库里没有 blank
    const stored: StoredState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "blank",
      settings: createDefaultSettings(),
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const state = loadRuntimeState(questions, HASH);
    expect(state.filterType).toBe("all");
  });

  it("题库只有一种类型时，filterType 被 normalize 到该单一类型", () => {
    const questions = [
      makeQuestion("a", "single"),
      makeQuestion("b", "single"),
    ];
    const stored: StoredState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const state = loadRuntimeState(questions, HASH);
    expect(state.filterType).toBe("single");
  });

  it("filterType 在可用类型里 → 保留", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
    ];
    const stored: StoredState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "single",
      settings: createDefaultSettings(),
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const state = loadRuntimeState(questions, HASH);
    expect(state.filterType).toBe("single");
    // pendingIds 应反映 filter
    expect(state.pendingIds).toEqual(["b"]);
  });

  it("损坏的 settings 值（越界）→ sanitize", () => {
    const questions = [makeQuestion("a")];
    const stored = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: {
        autoNextOnCorrect: false,
        activePoolSize: 9999, // 越界
        correctStreakToMaster: -1, // 越界
        correctStreakAfterMistake: 999, // 越界
        selectionMode: "invalid",
      },
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const state = loadRuntimeState(questions, HASH);
    expect(state.settings.activePoolSize).toBe(100); // 钳到上界
    expect(state.settings.correctStreakToMaster).toBe(1); // 钳到下界
    expect(state.settings.correctStreakAfterMistake).toBe(20); // 钳到上界
    expect(state.settings.selectionMode).toBe("random"); // 非法 → random
  });

  it("损坏的 settings 值（JSON 中 NaN 序列化为 null）→ sanitize", () => {
    const questions = [makeQuestion("a")];
    const stored = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: {
        autoNextOnCorrect: false,
        activePoolSize: NaN,
        correctStreakToMaster: NaN,
        correctStreakAfterMistake: NaN,
        selectionMode: "random",
      },
    };
    // JSON.stringify 会把 NaN 转成 null。null 经 Number() → 0，
    // 落入 [min, max] 区间下界 → 钳到 min。
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const state = loadRuntimeState(questions, HASH);
    expect(state.settings.activePoolSize).toBe(5); // min
    expect(state.settings.correctStreakToMaster).toBe(1); // min
    expect(state.settings.correctStreakAfterMistake).toBe(1); // min
  });

  it("内存中直接传入 NaN（绕过 JSON） → 回退默认值", () => {
    // 模拟存储里被某种异常写入了字符串 "NaN" 之类的非数值。
    const questions = [makeQuestion("a")];
    const stored = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: {
        autoNextOnCorrect: false,
        activePoolSize: "not-a-number",
        correctStreakToMaster: "abc",
        correctStreakAfterMistake: "xyz",
        selectionMode: "random",
      },
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const state = loadRuntimeState(questions, HASH);
    expect(state.settings.activePoolSize).toBe(ACTIVE_POOL_SIZE);
    expect(state.settings.correctStreakToMaster).toBe(CORRECT_STREAK_TO_MASTER);
    expect(state.settings.correctStreakAfterMistake).toBe(
      CORRECT_STREAK_AFTER_MISTAKE,
    );
  });

  it("pendingIds 排除 mastered 和 activePool", () => {
    const questions = [
      makeQuestion("a"),
      makeQuestion("b"),
      makeQuestion("c"),
      makeQuestion("d"),
    ];
    const stored: StoredState = {
      masteredIds: ["a"],
      activePool: [createActivePoolItem("b", 25)],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const state = loadRuntimeState(questions, HASH);
    expect(state.pendingIds).toEqual(["c", "d"]);
  });
});

// ---------------------------------------------------------------------------
// rebuildRuntimeState
// ---------------------------------------------------------------------------

describe("rebuildRuntimeState", () => {
  function baseRuntime(
    overrides: Partial<RuntimeState> = {},
  ): RuntimeState {
    return {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
      pendingIds: [],
      ...overrides,
    };
  }

  it("切换 filter 时，'加进 pool 但还没展示过' 的题被清掉", () => {
    const questions = [
      makeQuestion("a", "single"),
      makeQuestion("b", "single"),
      makeQuestion("c", "judgment"),
    ];
    // 全部都是 lastSelectedRound = -50（初始值），还没展示过
    const state = baseRuntime({
      activePool: [
        createActivePoolItem("a", 25),
        createActivePoolItem("b", 25),
        createActivePoolItem("c", 25),
      ],
      filterType: "all",
    });
    const rebuilt = rebuildRuntimeState(questions, state, "single");
    // 三个都是未展示过的：rebuild 全清掉
    expect(rebuilt.activePool).toEqual([]);
  });

  it("'已展示过' 的题（lastSelectedRound !== initial）留下", () => {
    const questions = [
      makeQuestion("a", "single"),
      makeQuestion("b", "single"),
    ];
    const initialRound = -25 * 2;
    const shownItem = {
      ...createActivePoolItem("a", 25),
      lastSelectedRound: 3, // 不等于 initial，表示已展示
    };
    const notShown = createActivePoolItem("b", 25); // lastSelectedRound = -50
    const state = baseRuntime({
      activePool: [shownItem, notShown],
      filterType: "all",
    });
    const rebuilt = rebuildRuntimeState(questions, state, "single");
    expect(rebuilt.activePool.map((i) => i.id)).toEqual(["a"]);
    // 没展示的 b 不会留下
    expect(rebuilt.activePool[0].lastSelectedRound).not.toBe(initialRound);
  });

  it("切换后的 pendingIds 反映新 filter", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
      makeQuestion("c", "single"),
    ];
    const state = baseRuntime({
      activePool: [],
      filterType: "all",
    });
    const rebuilt = rebuildRuntimeState(questions, state, "single");
    expect(rebuilt.filterType).toBe("single");
    expect(rebuilt.pendingIds).toEqual(["b", "c"]);
  });

  it("展示过的题不在 filter 范围内 → 也会被 buildRuntimeState 清掉", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
    ];
    const shownJudgment = {
      ...createActivePoolItem("a", 25),
      lastSelectedRound: 3, // 已展示
    };
    const state = baseRuntime({
      activePool: [shownJudgment],
      filterType: "all",
    });
    const rebuilt = rebuildRuntimeState(questions, state, "single");
    // 即使展示过，但 a 是 judgment 不在 single filter 里，被 buildRuntimeState 清掉
    expect(rebuilt.activePool).toEqual([]);
  });

  it("保留 masteredIds / currentRound / settings", () => {
    const questions = [makeQuestion("a", "single"), makeQuestion("b", "single")];
    const settings = {
      ...createDefaultSettings(),
      autoNextOnCorrect: true,
      activePoolSize: 30,
    };
    const state = baseRuntime({
      masteredIds: ["x", "y"],
      currentRound: 17,
      settings,
    });
    const rebuilt = rebuildRuntimeState(questions, state, "single");
    expect(rebuilt.masteredIds).toEqual(["x", "y"]);
    expect(rebuilt.currentRound).toBe(17);
    expect(rebuilt.settings.autoNextOnCorrect).toBe(true);
    expect(rebuilt.settings.activePoolSize).toBe(30);
  });

  it("用自定义 activePoolSize 计算 initialRound", () => {
    const questions = [
      makeQuestion("a", "single"),
      makeQuestion("b", "single"),
    ];
    const customPoolSize = 10;
    const settings = {
      ...createDefaultSettings(),
      activePoolSize: customPoolSize,
    };
    // 用 customPoolSize 的 initialRound 创建未展示的项
    const notShown = createActivePoolItem("a", customPoolSize); // lastSelectedRound = -20
    const shownItem = {
      ...createActivePoolItem("b", customPoolSize),
      lastSelectedRound: 5,
    };
    const state = baseRuntime({
      activePool: [notShown, shownItem],
      settings,
      filterType: "all",
    });
    const rebuilt = rebuildRuntimeState(questions, state, "single");
    // notShown (a) 应被清掉，shownItem (b) 保留
    expect(rebuilt.activePool.map((i) => i.id)).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------------------
// createResetRuntimeState
// ---------------------------------------------------------------------------

describe("createResetRuntimeState", () => {
  it("保留 storage 里之前的 filterType 和 settings", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
    ];
    const settings = {
      ...createDefaultSettings(),
      autoNextOnCorrect: true,
      activePoolSize: 40,
    };
    saveState(HASH, {
      masteredIds: ["a"],
      activePool: [createActivePoolItem("b", 25)],
      currentRound: 9,
      filterType: "single",
      settings,
      pendingIds: [],
    });
    const reset = createResetRuntimeState(questions, HASH);
    expect(reset.filterType).toBe("single");
    expect(reset.settings.autoNextOnCorrect).toBe(true);
    expect(reset.settings.activePoolSize).toBe(40);
  });

  it("其他字段（masteredIds / activePool / currentRound）重置", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    saveState(HASH, {
      masteredIds: ["a", "b"],
      activePool: [createActivePoolItem("a", 25)],
      currentRound: 99,
      filterType: "all",
      settings: createDefaultSettings(),
      pendingIds: [],
    });
    const reset = createResetRuntimeState(questions, HASH);
    expect(reset.masteredIds).toEqual([]);
    expect(reset.activePool).toEqual([]);
    expect(reset.currentRound).toBe(0);
  });

  it("移除 localStorage 中该 bank 的 state key", () => {
    const questions = [makeQuestion("a")];
    saveState(HASH, {
      masteredIds: ["a"],
      activePool: [],
      currentRound: 5,
      filterType: "all",
      settings: createDefaultSettings(),
      pendingIds: [],
    });
    expect(localStorage.getItem(STORAGE_PREFIX_STATE + HASH)).not.toBeNull();
    createResetRuntimeState(questions, HASH);
    expect(localStorage.getItem(STORAGE_PREFIX_STATE + HASH)).toBeNull();
  });

  it("pendingIds 重置后涵盖所有题（filter=all、无 mastered、无 active）", () => {
    const questions = [
      makeQuestion("a"),
      makeQuestion("b"),
      makeQuestion("c"),
    ];
    const reset = createResetRuntimeState(questions, HASH);
    expect(reset.pendingIds).toEqual(["a", "b", "c"]);
  });

  it("前次 filterType 不再可用 → 被 normalize 到 'all'", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
    ];
    // 保存 filterType=blank，但题库里没有 blank
    saveState(HASH, {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "blank",
      settings: createDefaultSettings(),
      pendingIds: [],
    });
    const reset = createResetRuntimeState(questions, HASH);
    expect(reset.filterType).toBe("all");
  });

  it("前次 settings 越界 → 被 sanitize", () => {
    const questions = [makeQuestion("a")];
    const stored = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: {
        autoNextOnCorrect: true,
        activePoolSize: 9999,
        correctStreakToMaster: 0,
        correctStreakAfterMistake: 999,
        selectionMode: "random",
      },
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const reset = createResetRuntimeState(questions, HASH);
    expect(reset.settings.activePoolSize).toBe(100);
    expect(reset.settings.correctStreakToMaster).toBe(1);
    expect(reset.settings.correctStreakAfterMistake).toBe(20);
    // autoNextOnCorrect 保留
    expect(reset.settings.autoNextOnCorrect).toBe(true);
  });
});
