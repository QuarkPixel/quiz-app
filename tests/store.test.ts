import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createDefaultSettings,
  createActivePoolItem,
  loadStoredState,
  saveState,
  resetStoredState,
  filterQuestions,
  computePendingIds,
  buildRuntimeState,
  getActivePoolItem,
} from "../src/store";
import {
  ACTIVE_POOL_SIZE,
  CORRECT_STREAK_TO_MASTER,
  CORRECT_STREAK_AFTER_MISTAKE,
  STORAGE_PREFIX_STATE,
} from "../src/config";
import type {
  Question,
  QuestionType,
  RuntimeState,
  StoredState,
  ActivePoolItem,
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
// createDefaultSettings
// ---------------------------------------------------------------------------

describe("createDefaultSettings", () => {
  it("返回的默认值与 config.ts 常量一致", () => {
    const s = createDefaultSettings();
    expect(s.activePoolSize).toBe(ACTIVE_POOL_SIZE);
    expect(s.correctStreakToMaster).toBe(CORRECT_STREAK_TO_MASTER);
    expect(s.correctStreakAfterMistake).toBe(CORRECT_STREAK_AFTER_MISTAKE);
    expect(s.autoNextOnCorrect).toBe(false);
    expect(s.selectionMode).toBe("random");
  });

  it("每次返回独立对象", () => {
    const a = createDefaultSettings();
    const b = createDefaultSettings();
    expect(a).not.toBe(b);
    a.autoNextOnCorrect = true;
    expect(b.autoNextOnCorrect).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createActivePoolItem
// ---------------------------------------------------------------------------

describe("createActivePoolItem", () => {
  it("初始字段符合预期", () => {
    const item = createActivePoolItem("q1");
    expect(item.id).toBe("q1");
    expect(item.consecutiveCorrect).toBe(0);
    expect(item.hasEverMistaken).toBe(false);
    expect(item.hasBeenShown).toBe(false);
    expect(item.lastSelectedRound).toBe(0);
  });

  it("lastSelectedRound 不再与 activePoolSize 联动", () => {
    expect(createActivePoolItem("q1").lastSelectedRound).toBe(0);
  });

  it("lastSelectedRound 以当前轮次为基准", () => {
    expect(createActivePoolItem("q1", 42).lastSelectedRound).toBe(42);
    expect(createActivePoolItem("q1", 3241).lastSelectedRound).toBe(3241);
  });
});

// ---------------------------------------------------------------------------
// loadStoredState
// ---------------------------------------------------------------------------

describe("loadStoredState", () => {
  it("localStorage 为空 → 返回默认状态", () => {
    const state = loadStoredState(HASH);
    expect(state.masteredIds).toEqual([]);
    expect(state.activePool).toEqual([]);
    expect(state.currentRound).toBe(0);
    expect(state.filterType).toBe("all");
    expect(state.settings).toEqual(createDefaultSettings());
    expect(state.ui).toEqual({ progressFocused: false, showPool: false });
  });

  it("ui 段缺失字段 → 用默认值补齐", () => {
    const partial = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
      ui: { progressFocused: true }, // 缺 showPool（模拟老存储）
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(partial));
    const loaded = loadStoredState(HASH);
    expect(loaded.ui.progressFocused).toBe(true);
    expect(loaded.ui.showPool).toBe(false);
  });

  it("ui 段完整 round-trip", () => {
    const stored: StoredState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
      ui: { progressFocused: true, showPool: true },
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const loaded = loadStoredState(HASH);
    expect(loaded.ui).toEqual({ progressFocused: true, showPool: true });
  });

  it("有完整数据 → 解析正确", () => {
    const stored: StoredState = {
      masteredIds: ["a", "b"],
      activePool: [createActivePoolItem("c")],
      currentRound: 7,
      filterType: "single",
      settings: createDefaultSettings(),
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(stored));
    const loaded = loadStoredState(HASH);
    expect(loaded.masteredIds).toEqual(["a", "b"]);
    expect(loaded.activePool).toHaveLength(1);
    expect(loaded.activePool[0].id).toBe("c");
    expect(loaded.currentRound).toBe(7);
    expect(loaded.filterType).toBe("single");
  });

  it("settings 部分字段缺失 → 补默认", () => {
    const partial = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: { autoNextOnCorrect: true }, // 其它字段缺失
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, JSON.stringify(partial));
    const loaded = loadStoredState(HASH);
    expect(loaded.settings.autoNextOnCorrect).toBe(true);
    expect(loaded.settings.activePoolSize).toBe(ACTIVE_POOL_SIZE);
    expect(loaded.settings.correctStreakToMaster).toBe(CORRECT_STREAK_TO_MASTER);
    expect(loaded.settings.correctStreakAfterMistake).toBe(
      CORRECT_STREAK_AFTER_MISTAKE,
    );
    expect(loaded.settings.selectionMode).toBe("random");
  });

  it("损坏 JSON → 不抛错，返回默认状态", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(STORAGE_PREFIX_STATE + HASH, "{not valid json");
    const loaded = loadStoredState(HASH);
    expect(loaded).toEqual({
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
      ui: { progressFocused: false, showPool: false },
    });
  });

  it("不同 hash 互不影响", () => {
    const a: StoredState = {
      masteredIds: ["a"],
      activePool: [],
      currentRound: 1,
      filterType: "all",
      settings: createDefaultSettings(),
    };
    localStorage.setItem(STORAGE_PREFIX_STATE + "h1", JSON.stringify(a));
    expect(loadStoredState("h1").masteredIds).toEqual(["a"]);
    expect(loadStoredState("h2").masteredIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// saveState / round-trip
// ---------------------------------------------------------------------------

describe("saveState", () => {
  it("saveState → loadStoredState round-trip", () => {
    const runtime: RuntimeState = {
      masteredIds: ["a"],
      activePool: [createActivePoolItem("b")],
      currentRound: 3,
      filterType: "blank",
      settings: createDefaultSettings(),
      pendingIds: ["c", "d"],
    };
    saveState(HASH, runtime);
    const loaded = loadStoredState(HASH);
    expect(loaded.masteredIds).toEqual(["a"]);
    expect(loaded.activePool).toHaveLength(1);
    expect(loaded.activePool[0].id).toBe("b");
    expect(loaded.currentRound).toBe(3);
    expect(loaded.filterType).toBe("blank");
  });

  it("不持久化 pendingIds", () => {
    const runtime: RuntimeState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
      pendingIds: ["x", "y", "z"],
    };
    saveState(HASH, runtime);
    const raw = localStorage.getItem(STORAGE_PREFIX_STATE + HASH)!;
    const parsed = JSON.parse(raw);
    expect(parsed).not.toHaveProperty("pendingIds");
  });

  it("写入配额异常仅 warn 不抛错", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    const runtime: RuntimeState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
      pendingIds: [],
    };
    expect(() => saveState(HASH, runtime)).not.toThrow();
    expect(warn).toHaveBeenCalled();
    setItem.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// resetStoredState
// ---------------------------------------------------------------------------

describe("resetStoredState", () => {
  it("移除 localStorage 里的 state key", () => {
    saveState(HASH, {
      masteredIds: ["a"],
      activePool: [],
      currentRound: 5,
      filterType: "all",
      settings: createDefaultSettings(),
      pendingIds: [],
    });
    expect(localStorage.getItem(STORAGE_PREFIX_STATE + HASH)).not.toBeNull();
    resetStoredState(HASH);
    expect(localStorage.getItem(STORAGE_PREFIX_STATE + HASH)).toBeNull();
  });

  it("保留前次的 filterType 和 settings", () => {
    const settings = {
      ...createDefaultSettings(),
      autoNextOnCorrect: true,
      activePoolSize: 30,
    };
    saveState(HASH, {
      masteredIds: ["a", "b"],
      activePool: [createActivePoolItem("c")],
      currentRound: 10,
      filterType: "single",
      settings,
      pendingIds: [],
    });
    const reset = resetStoredState(HASH);
    expect(reset.filterType).toBe("single");
    expect(reset.settings.autoNextOnCorrect).toBe(true);
    expect(reset.settings.activePoolSize).toBe(30);
  });

  it("其他字段重置为默认", () => {
    saveState(HASH, {
      masteredIds: ["a", "b"],
      activePool: [createActivePoolItem("c")],
      currentRound: 10,
      filterType: "single",
      settings: createDefaultSettings(),
      pendingIds: [],
    });
    const reset = resetStoredState(HASH);
    expect(reset.masteredIds).toEqual([]);
    expect(reset.activePool).toEqual([]);
    expect(reset.currentRound).toBe(0);
  });

  it("无前次数据时也能调用 → 返回纯默认状态", () => {
    const reset = resetStoredState(HASH);
    expect(reset.masteredIds).toEqual([]);
    expect(reset.activePool).toEqual([]);
    expect(reset.currentRound).toBe(0);
    expect(reset.filterType).toBe("all");
    expect(reset.settings).toEqual(createDefaultSettings());
  });
});

// ---------------------------------------------------------------------------
// filterQuestions
// ---------------------------------------------------------------------------

describe("filterQuestions", () => {
  const questions: Question[] = [
    makeQuestion("a", "judgment"),
    makeQuestion("b", "single"),
    makeQuestion("c", "multiple"),
    makeQuestion("d", "blank"),
    makeQuestion("e", "single"),
  ];

  it('"all" → 全部', () => {
    expect(filterQuestions(questions, "all")).toEqual(questions);
  });

  it("具体类型 → 仅该类型", () => {
    expect(filterQuestions(questions, "single").map((q) => q.id)).toEqual([
      "b",
      "e",
    ]);
    expect(filterQuestions(questions, "judgment").map((q) => q.id)).toEqual([
      "a",
    ]);
    expect(filterQuestions(questions, "multiple").map((q) => q.id)).toEqual([
      "c",
    ]);
    expect(filterQuestions(questions, "blank").map((q) => q.id)).toEqual(["d"]);
  });

  it("无匹配 → 空数组", () => {
    const onlyJudgment = [makeQuestion("a", "judgment")];
    expect(filterQuestions(onlyJudgment, "single")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// computePendingIds
// ---------------------------------------------------------------------------

describe("computePendingIds", () => {
  it("减去 masteredIds 和 activePool 中的 id", () => {
    const questions = [
      makeQuestion("a"),
      makeQuestion("b"),
      makeQuestion("c"),
      makeQuestion("d"),
    ];
    const state: StoredState = {
      masteredIds: ["a"],
      activePool: [createActivePoolItem("b")],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
    };
    expect(computePendingIds(questions, state)).toEqual(["c", "d"]);
  });

  it("按 filterType 过滤", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
      makeQuestion("c", "single"),
      makeQuestion("d", "blank"),
    ];
    const state: StoredState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "single",
      settings: createDefaultSettings(),
    };
    expect(computePendingIds(questions, state)).toEqual(["b", "c"]);
  });

  it("空题库 → 空 pendingIds", () => {
    const state: StoredState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
    };
    expect(computePendingIds([], state)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeState
// ---------------------------------------------------------------------------

describe("buildRuntimeState", () => {
  it("cleanedActivePool 剔除非 filter 范围内的题", () => {
    const questions = [
      makeQuestion("a", "judgment"),
      makeQuestion("b", "single"),
      makeQuestion("c", "single"),
    ];
    const state: StoredState = {
      masteredIds: [],
      activePool: [
        createActivePoolItem("a"), // judgment，不在 single filter 范围内
        createActivePoolItem("b"),
      ],
      currentRound: 0,
      filterType: "single",
      settings: createDefaultSettings(),
    };
    const runtime = buildRuntimeState(questions, state);
    expect(runtime.activePool.map((i) => i.id)).toEqual(["b"]);
  });

  it("pendingIds 反映 filter 范围、排除 mastered/active", () => {
    const questions = [
      makeQuestion("a", "single"),
      makeQuestion("b", "single"),
      makeQuestion("c", "single"),
      makeQuestion("d", "judgment"),
    ];
    const state: StoredState = {
      masteredIds: ["a"],
      activePool: [createActivePoolItem("b")],
      currentRound: 0,
      filterType: "single",
      settings: createDefaultSettings(),
    };
    const runtime = buildRuntimeState(questions, state);
    expect(runtime.pendingIds).toEqual(["c"]);
  });

  it("filterType=all 时 pendingIds 包含全部非 mastered 非 active 的题", () => {
    const questions = [
      makeQuestion("a"),
      makeQuestion("b"),
      makeQuestion("c"),
    ];
    const state: StoredState = {
      masteredIds: [],
      activePool: [],
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
    };
    const runtime = buildRuntimeState(questions, state);
    expect(runtime.pendingIds).toEqual(["a", "b", "c"]);
  });

  it("保留原 StoredState 的其它字段", () => {
    const questions = [makeQuestion("a")];
    const state: StoredState = {
      masteredIds: ["x"],
      activePool: [],
      currentRound: 42,
      filterType: "all",
      settings: { ...createDefaultSettings(), autoNextOnCorrect: true },
    };
    const runtime = buildRuntimeState(questions, state);
    expect(runtime.currentRound).toBe(42);
    expect(runtime.masteredIds).toEqual(["x"]);
    expect(runtime.settings.autoNextOnCorrect).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getActivePoolItem
// ---------------------------------------------------------------------------

describe("getActivePoolItem", () => {
  function makeRuntime(pool: ActivePoolItem[]): RuntimeState {
    return {
      masteredIds: [],
      activePool: pool,
      currentRound: 0,
      filterType: "all",
      settings: createDefaultSettings(),
      pendingIds: [],
    };
  }

  it("命中 → 返回该项", () => {
    const item = createActivePoolItem("a");
    const state = makeRuntime([item, createActivePoolItem("b")]);
    expect(getActivePoolItem(state, "a")).toBe(item);
  });

  it("未命中 → undefined", () => {
    const state = makeRuntime([createActivePoolItem("a")]);
    expect(getActivePoolItem(state, "z")).toBeUndefined();
  });

  it("空池 → undefined", () => {
    const state = makeRuntime([]);
    expect(getActivePoolItem(state, "a")).toBeUndefined();
  });
});
