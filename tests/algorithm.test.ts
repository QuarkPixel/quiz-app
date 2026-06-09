import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getStats,
  fillActivePool,
  selectNextFromPool,
  processAnswer,
  applyAnswer,
  getRequiredStreak,
  computeLearningSegments,
} from "../src/algorithm";
import {
  debug,
  installDebugConsoleCommands,
  setDebugModeEnabled,
} from "../src/debug";
import { createActivePoolItem, createDefaultSettings } from "../src/store";
import type {
  Question,
  RuntimeState,
  ActivePoolItem,
  QuestionType,
  UserSettings,
} from "../src/types";

// ---------------------------------------------------------------------------
// Fixture 构造
// ---------------------------------------------------------------------------

function makeQuestion(
  id: string,
  type: QuestionType = "judgment",
  answer: Question["answer"] = true,
): Question {
  return {
    id,
    type,
    question: `q-${id}`,
    answer,
  };
}

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
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
  activePoolSize = 25,
): ActivePoolItem {
  return { ...createActivePoolItem(id, activePoolSize), ...patch };
}

afterEach(() => {
  setDebugModeEnabled(false);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------

describe("getStats", () => {
  it("filterType=all 时统计全部题目", () => {
    const questions = [
      makeQuestion("a", "judgment", true),
      makeQuestion("b", "single", [0]),
      makeQuestion("c", "judgment", false),
    ];
    const state = makeState({
      masteredIds: ["a"],
      activePool: [poolItem("b")],
      pendingIds: ["c"],
    });

    expect(getStats(questions, state)).toEqual({
      mastered: 1,
      learning: 1,
      pending: 1,
      total: 3,
    });
  });

  it("筛选指定题型时排除不匹配的 mastered；activePool 假定已被 buildRuntimeState 清洗", () => {
    // getStats 不再防御性 filter activePool —— 假定调用方传入的 state 是
    // buildRuntimeState 的产物，pool 已按 filterType 清洗过。
    const questions = [
      makeQuestion("a", "judgment", true),
      makeQuestion("b", "single", [0]),
      makeQuestion("c", "single", [1]),
    ];
    const state = makeState({
      filterType: "single",
      masteredIds: ["a", "b"], // a 是判断题，mastered 仍按 filterType 过滤
      activePool: [poolItem("c")], // 假设已被 buildRuntimeState 清洗
      pendingIds: [],
    });

    const stats = getStats(questions, state);
    expect(stats.total).toBe(2); // single 共两道
    expect(stats.mastered).toBe(1); // 只有 b
    expect(stats.learning).toBe(1); // 只有 c
  });

  it("空 pool 和空 mastered 时返回 0", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({ pendingIds: ["a", "b"] });

    expect(getStats(questions, state)).toEqual({
      mastered: 0,
      learning: 0,
      pending: 2,
      total: 2,
    });
  });

  it("空题库时 total=0", () => {
    expect(getStats([], makeState())).toEqual({
      mastered: 0,
      learning: 0,
      pending: 0,
      total: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// fillActivePool
// ---------------------------------------------------------------------------

describe("fillActivePool", () => {
  it("sequential 模式按 pendingIds 顺序选", () => {
    const state = makeState({
      pendingIds: ["a", "b", "c", "d"],
      activePool: [],
      settings: makeSettings({ activePoolSize: 2, selectionMode: "sequential" }),
    });

    const result = fillActivePool(state);
    expect(result.activePool.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.pendingIds).toEqual(["c", "d"]);
  });

  it("random 模式不超 targetSize", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const state = makeState({
      pendingIds: ["a", "b", "c", "d", "e"],
      activePool: [],
      settings: makeSettings({ activePoolSize: 3, selectionMode: "random" }),
    });

    const result = fillActivePool(state);
    expect(result.activePool).toHaveLength(3);
    expect(result.pendingIds).toHaveLength(2);
  });

  it("pendingIds 耗尽时停止填充", () => {
    const state = makeState({
      pendingIds: ["a"],
      activePool: [],
      settings: makeSettings({ activePoolSize: 5, selectionMode: "sequential" }),
    });

    const result = fillActivePool(state);
    expect(result.activePool).toHaveLength(1);
    expect(result.pendingIds).toEqual([]);
  });

  it("activePool 已满时不再补充", () => {
    const state = makeState({
      pendingIds: ["b", "c"],
      activePool: [poolItem("a"), poolItem("b")],
      settings: makeSettings({ activePoolSize: 2, selectionMode: "sequential" }),
    });
    const result = fillActivePool(state);
    expect(result.activePool.map((i) => i.id)).toEqual(["a", "b"]);
    expect(result.pendingIds).toEqual(["b", "c"]);
  });

  it("新加入的池项使用 createActivePoolItem 的默认值", () => {
    const state = makeState({
      pendingIds: ["a"],
      activePool: [],
      currentRound: 42,
      settings: makeSettings({ activePoolSize: 5, selectionMode: "sequential" }),
    });
    const result = fillActivePool(state);
    expect(result.activePool[0]).toMatchObject({
      id: "a",
      consecutiveCorrect: 0,
      hasEverMistaken: false,
      lastSelectedRound: 32,
    });
  });
});

// ---------------------------------------------------------------------------
// 全局调试命令
// ---------------------------------------------------------------------------

describe("debug console command", () => {
  it("安装浏览器控制台命令并提示开启方式", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    setDebugModeEnabled(false);
    delete window.debug;

    installDebugConsoleCommands();

    expect(window.quizDebug).toBe(debug);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("OFF"),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );

    expect(window.quizDebug?.()).toBe(false);
    expect(window.quizDebug?.(true)).toBe(true);
    expect(window.quizDebug?.()).toBe(true);
    expect(window.quizDebug?.(false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectNextFromPool
// ---------------------------------------------------------------------------

describe("selectNextFromPool", () => {
  it("空 pool 返回 null", () => {
    const questions = [makeQuestion("a")];
    const state = makeState({ activePool: [] });
    expect(selectNextFromPool(questions, state)).toBeNull();
  });

  it("sequential 模式按题库原顺序选下一题", () => {
    const questions = [makeQuestion("a"), makeQuestion("b"), makeQuestion("c")];
    const state = makeState({
      activePool: [poolItem("c"), poolItem("a"), poolItem("b")],
      settings: makeSettings({ selectionMode: "sequential" }),
    });

    // currentQuestionId 为 "a"，下一题应该是 "b"（题库顺序中 a 之后）
    const next = selectNextFromPool(questions, state, "a");
    expect(next?.id).toBe("b");
  });

  it("sequential 模式无 currentQuestionId 时返回题库顺序最靠前的", () => {
    const questions = [makeQuestion("a"), makeQuestion("b"), makeQuestion("c")];
    const state = makeState({
      activePool: [poolItem("c"), poolItem("b")],
      settings: makeSettings({ selectionMode: "sequential" }),
    });
    expect(selectNextFromPool(questions, state)?.id).toBe("b");
  });

  it("sequential 模式池中只剩 currentQuestionId 时回到该题（兜底）", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      activePool: [poolItem("a")],
      settings: makeSettings({ selectionMode: "sequential" }),
    });
    expect(selectNextFromPool(questions, state, "a")?.id).toBe("a");
  });

  it("random 模式池中只剩 currentQuestionId 时回到该题（兜底）", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      activePool: [poolItem("a")],
      settings: makeSettings({ selectionMode: "random" }),
    });
    expect(selectNextFromPool(questions, state, "a")?.id).toBe("a");
  });

  it("random 模式：刚选过的题权重接近 0（与上一轮 lastSelectedRound 同步时跳过）", () => {
    // currentRound=10, length=2, item a lastSelectedRound=10 → cooldown 内，weight 0
    // item b lastSelectedRound=-10 → roundsSince 超过 length，weight 封顶为 1
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      currentRound: 10,
      activePool: [
        poolItem("a", { lastSelectedRound: 10 }), // 刚选过，权重 0
        poolItem("b", { lastSelectedRound: -10 }), // 新加入，权重大
      ],
      settings: makeSettings({ selectionMode: "random" }),
    });
    // 只有 b 有非零权重，无论 random 值多少都选 b
    const next = selectNextFromPool(questions, state);
    expect(next?.id).toBe("b");
  });

  it("random 模式：权重在 x=m 时封顶，并使用二次曲线压低中段题", () => {
    // length=3：cooldown=m/3=1，cap=m=3。
    // b 的 t=(2-1)/(3-1)=0.5，weight=0.25；c 的 weight=1。
    // b 的累计概率为 0.25/(0.25+1)=0.2，所以 random=0.21 应越过 b 选 c。
    vi.spyOn(Math, "random").mockReturnValue(0.21);
    const questions = [makeQuestion("a"), makeQuestion("b"), makeQuestion("c")];
    const state = makeState({
      currentRound: 10,
      activePool: [
        poolItem("a", { lastSelectedRound: 9 }),
        poolItem("b", { lastSelectedRound: 8 }),
        poolItem("c", { lastSelectedRound: 7 }),
      ],
      settings: makeSettings({ selectionMode: "random" }),
    });

    const next = selectNextFromPool(questions, state);
    expect(next?.id).toBe("c");
  });

  it("random 模式跳过 currentQuestionId", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      currentRound: 100,
      activePool: [
        poolItem("a", { lastSelectedRound: -10 }),
        poolItem("b", { lastSelectedRound: -10 }),
      ],
      settings: makeSettings({ selectionMode: "random" }),
    });
    const next = selectNextFromPool(questions, state, "a");
    expect(next?.id).toBe("b");
  });

  it("random 模式：Math.random=0.999 时倾向选最后一个累计到的", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const questions = [makeQuestion("a"), makeQuestion("b"), makeQuestion("c")];
    const state = makeState({
      currentRound: 100,
      activePool: [
        poolItem("a", { lastSelectedRound: -10 }),
        poolItem("b", { lastSelectedRound: -10 }),
        poolItem("c", { lastSelectedRound: -10 }),
      ],
      settings: makeSettings({ selectionMode: "random" }),
    });
    const next = selectNextFromPool(questions, state);
    expect(next?.id).toBe("c");
  });

  it("random 模式在全局调试关闭时不输出权重分布日志", () => {
    const group = vi
      .spyOn(console, "groupCollapsed")
      .mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const groupEnd = vi
      .spyOn(console, "groupEnd")
      .mockImplementation(() => undefined);

    setDebugModeEnabled(false);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const questions = [makeQuestion("a"), makeQuestion("b"), makeQuestion("c")];
    const state = makeState({
      currentRound: 100,
      activePool: [
        poolItem("a", { lastSelectedRound: -10 }),
        poolItem("b", { lastSelectedRound: -10 }),
        poolItem("c", { lastSelectedRound: -10 }),
      ],
      settings: makeSettings({ selectionMode: "random" }),
    });

    selectNextFromPool(questions, state);

    expect(group).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(groupEnd).not.toHaveBeenCalled();
  });

  it("random 模式开启后输出权重分布日志", () => {
    const group = vi
      .spyOn(console, "groupCollapsed")
      .mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const groupEnd = vi
      .spyOn(console, "groupEnd")
      .mockImplementation(() => undefined);

    setDebugModeEnabled(true);
    vi.spyOn(Math, "random").mockReturnValue(0);
    const questions = [makeQuestion("a"), makeQuestion("b"), makeQuestion("c")];
    const state = makeState({
      currentRound: 100,
      activePool: [
        poolItem("a", { lastSelectedRound: -10 }),
        poolItem("b", { lastSelectedRound: -10 }),
        poolItem("c", { lastSelectedRound: -10 }),
      ],
      settings: makeSettings({ selectionMode: "random" }),
    });

    selectNextFromPool(questions, state);

    expect(group).toHaveBeenCalledWith(
      "%cWeight Distribution %c(Round: %s)",
      "font-weight: bold;",
      "font-weight: normal; color: gray;",
      100,
    );
    expect(log).toHaveBeenCalled();
    expect(groupEnd).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// processAnswer
// ---------------------------------------------------------------------------

describe("processAnswer", () => {
  it("答对时 consecutiveCorrect +1，currentRound +1", () => {
    const state = makeState({
      activePool: [poolItem("a", { consecutiveCorrect: 0 })],
      currentRound: 0,
      settings: makeSettings({
        correctStreakToMaster: 3,
        correctStreakAfterMistake: 4,
      }),
    });
    const next = processAnswer(state, "a", true);
    expect(next.currentRound).toBe(1);
    expect(next.activePool[0].consecutiveCorrect).toBe(1);
    expect(next.activePool[0].lastSelectedRound).toBe(1);
    expect(next.masteredIds).toEqual([]);
  });

  it("达到 correctStreakToMaster 阈值（未错过）→ 进 mastered，从池移除", () => {
    const state = makeState({
      activePool: [
        poolItem("a", { consecutiveCorrect: 2, hasEverMistaken: false }),
      ],
      settings: makeSettings({
        correctStreakToMaster: 3,
        correctStreakAfterMistake: 4,
      }),
    });
    const next = processAnswer(state, "a", true);
    expect(next.activePool).toHaveLength(0);
    expect(next.masteredIds).toEqual(["a"]);
  });

  it("曾错过时按 correctStreakAfterMistake 判断", () => {
    const state = makeState({
      activePool: [
        poolItem("a", { consecutiveCorrect: 2, hasEverMistaken: true }),
      ],
      settings: makeSettings({
        correctStreakToMaster: 3,
        correctStreakAfterMistake: 4,
      }),
    });
    // 还差一次（streak=3 < 4），不掌握
    const next = processAnswer(state, "a", true);
    expect(next.activePool).toHaveLength(1);
    expect(next.activePool[0].consecutiveCorrect).toBe(3);
    expect(next.masteredIds).toEqual([]);

    // 再答对一次到 4，达到 mistake 阈值，掌握
    const next2 = processAnswer(next, "a", true);
    expect(next2.activePool).toHaveLength(0);
    expect(next2.masteredIds).toEqual(["a"]);
  });

  it("答错时 consecutiveCorrect 清零、hasEverMistaken=true", () => {
    const state = makeState({
      activePool: [
        poolItem("a", { consecutiveCorrect: 2, hasEverMistaken: false }),
      ],
    });
    const next = processAnswer(state, "a", false);
    expect(next.activePool[0].consecutiveCorrect).toBe(0);
    expect(next.activePool[0].hasEverMistaken).toBe(true);
    expect(next.currentRound).toBe(1);
    expect(next.masteredIds).toEqual([]);
  });

  it("题目不在池中时仅 currentRound +1，状态不变", () => {
    const state = makeState({
      activePool: [poolItem("a")],
      currentRound: 5,
    });
    const next = processAnswer(state, "nonexistent", true);
    expect(next.currentRound).toBe(6);
    expect(next.activePool[0].consecutiveCorrect).toBe(0);
    expect(next.masteredIds).toEqual([]);
  });

  it("不影响 pendingIds", () => {
    const state = makeState({
      activePool: [poolItem("a")],
      pendingIds: ["b", "c"],
    });
    const next = processAnswer(state, "a", true);
    expect(next.pendingIds).toEqual(["b", "c"]);
  });
});

// ---------------------------------------------------------------------------
// applyAnswer（processAnswer + fillActivePool 的原子化封装）
// ---------------------------------------------------------------------------

describe("applyAnswer", () => {
  it("答对未达 streak：和 processAnswer 行为一致（pool 不变化）", () => {
    const state = makeState({
      activePool: [poolItem("a"), poolItem("b")],
      pendingIds: ["c", "d"],
      settings: makeSettings({
        activePoolSize: 5,
        correctStreakToMaster: 3,
        selectionMode: "sequential",
      }),
    });
    const next = applyAnswer(state, "a", true);
    expect(next.activePool.map((i) => i.id)).toEqual(["a", "b", "c", "d"]); // a 留 + pendingIds 补
    expect(next.pendingIds).toEqual([]);
    const a = next.activePool.find((i) => i.id === "a")!;
    expect(a.consecutiveCorrect).toBe(1);
    expect(next.currentRound).toBe(state.currentRound + 1);
  });

  it("答对达到 streak：题进 mastered，pool 立即补一个 pending", () => {
    const state = makeState({
      activePool: [
        poolItem("a", { consecutiveCorrect: 2 }),
        poolItem("b"),
      ],
      pendingIds: ["c"],
      settings: makeSettings({
        activePoolSize: 2,
        correctStreakToMaster: 3,
        selectionMode: "sequential",
      }),
    });
    const next = applyAnswer(state, "a", true);
    expect(next.masteredIds).toContain("a");
    expect(next.activePool.map((i) => i.id)).toEqual(["b", "c"]); // a 移除，c 补入
    expect(next.pendingIds).toEqual([]);
  });

  it("答错：consecutiveCorrect 清零，hasEverMistaken 置 true，pool 长度不变", () => {
    const state = makeState({
      activePool: [poolItem("a", { consecutiveCorrect: 2 })],
      pendingIds: ["b"],
      settings: makeSettings({ activePoolSize: 1 }), // 池已满，fillActivePool 不补
    });
    const next = applyAnswer(state, "a", false);
    expect(next.activePool).toHaveLength(1);
    const a = next.activePool[0];
    expect(a.consecutiveCorrect).toBe(0);
    expect(a.hasEverMistaken).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getRequiredStreak
// ---------------------------------------------------------------------------

describe("getRequiredStreak", () => {
  const state = makeState({
    settings: makeSettings({
      correctStreakToMaster: 3,
      correctStreakAfterMistake: 5,
    }),
  });

  it("未错过 → correctStreakToMaster", () => {
    expect(getRequiredStreak(poolItem("a"), state)).toBe(3);
  });

  it("曾错过 → correctStreakAfterMistake", () => {
    expect(
      getRequiredStreak(poolItem("a", { hasEverMistaken: true }), state),
    ).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeLearningSegments
// ---------------------------------------------------------------------------

describe("computeLearningSegments", () => {
  it("空 pool 返回空数组", () => {
    expect(computeLearningSegments([], makeState())).toEqual([]);
  });

  it("单一 level → 单段、占 100%", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      activePool: [
        poolItem("a", { consecutiveCorrect: 0 }),
        poolItem("b", { consecutiveCorrect: 0 }),
      ],
      settings: makeSettings({
        correctStreakToMaster: 3,
        correctStreakAfterMistake: 4,
      }),
    });
    const segments = computeLearningSegments(questions, state);
    expect(segments).toHaveLength(1);
    expect(segments[0].widthPercent).toBe(100);
    // 颜色返回字符串
    expect(typeof segments[0].color).toBe("string");
    expect(segments[0].color).toMatch(/^oklch\(/);
  });

  it("多个 level 时按 level 升序排列，各段宽度按数量分配", () => {
    const questions = [
      makeQuestion("a"),
      makeQuestion("b"),
      makeQuestion("c"),
      makeQuestion("d"),
    ];
    const state = makeState({
      activePool: [
        // level = 3 - 0 = 3
        poolItem("a", { consecutiveCorrect: 0 }),
        // level = 3 - 1 = 2
        poolItem("b", { consecutiveCorrect: 1 }),
        // level = 3 - 2 = 1
        poolItem("c", { consecutiveCorrect: 2 }),
        // level = 3 - 1 = 2（与 b 同组）
        poolItem("d", { consecutiveCorrect: 1 }),
      ],
      settings: makeSettings({
        correctStreakToMaster: 3,
        correctStreakAfterMistake: 3,
      }),
    });
    const segments = computeLearningSegments(questions, state);
    expect(segments).toHaveLength(3);
    // 升序：level 1 (1 题), level 2 (2 题), level 3 (1 题)
    expect(segments[0].widthPercent).toBe(25); // 1/4
    expect(segments[1].widthPercent).toBe(50); // 2/4
    expect(segments[2].widthPercent).toBe(25); // 1/4
  });

  it("受 filterType 影响：池中存在不匹配题型项时被排除", () => {
    const questions = [
      makeQuestion("a", "single", [0]),
      makeQuestion("b", "judgment", true),
    ];
    const state = makeState({
      filterType: "single",
      activePool: [poolItem("a"), poolItem("b")],
    });
    const segments = computeLearningSegments(questions, state);
    // 只有 a 计入
    expect(segments).toHaveLength(1);
    expect(segments[0].widthPercent).toBe(100);
  });

  it("maxLevel=1 时所有题共享中点色", () => {
    const questions = [makeQuestion("a")];
    const state = makeState({
      activePool: [poolItem("a", { consecutiveCorrect: 0 })],
      settings: makeSettings({
        correctStreakToMaster: 1,
        correctStreakAfterMistake: 1,
      }),
    });
    const segments = computeLearningSegments(questions, state);
    expect(segments).toHaveLength(1);
    // 不出错即可
    expect(segments[0].color).toMatch(/^oklch\(/);
  });
});
