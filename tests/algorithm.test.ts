import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getStats,
  fillActivePool,
  selectNextFromPool,
  processAnswer,
  applyAnswer,
  getRequiredStreak,
} from "../src/algorithm";
import { computeLearningSegments } from "../src/features/quiz/learningProgress";
import {
  debug,
  installDebugConsoleCommands,
  setDebugModeEnabled,
} from "../src/debug";
import {
  createActivePoolItem,
  createDefaultSettings,
  createDefaultUiPreferences,
} from "../src/store";
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
  const defaultState: RuntimeState = {
    masteredIds: [],
    masteredMistakes: {},
    activePool: [],
    pendingIds: [],
    currentRound: 0,
    filterType: "all",
    settings: makeSettings(),
    ui: createDefaultUiPreferences(),
  };

  return {
    ...defaultState,
    ...overrides,
    settings: overrides.settings ?? defaultState.settings,
    ui: overrides.ui ?? defaultState.ui,
  };
}

function poolItem(
  id: string,
  patch: Partial<ActivePoolItem> = {},
): ActivePoolItem {
  return { ...createActivePoolItem(id), ...patch };
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

  it("筛选指定题型时排除不匹配的 mastered，learning 统计整个活动池", () => {
    const questions = [
      makeQuestion("a", "judgment", true),
      makeQuestion("b", "single", [0]),
      makeQuestion("c", "single", [1]),
      makeQuestion("d", "blank", "x"),
    ];
    const state = makeState({
      filterType: "single",
      masteredIds: ["a", "b"],
      activePool: [poolItem("c"), poolItem("d")],
      pendingIds: [],
    });

    const stats = getStats(questions, state);
    expect(stats.total).toBe(3); // 2 道 single + 1 道 carry-over blank
    expect(stats.mastered).toBe(1); // 只有 b 属于当前筛选
    expect(stats.learning).toBe(2); // c 和 carry-over 的 d 都仍在学习中
  });

  it("筛选外 mastered 不会变成 carry-over total", () => {
    const questions = [
      makeQuestion("a", "judgment", true),
      makeQuestion("b", "single", [0]),
      makeQuestion("c", "single", [1]),
    ];
    const state = makeState({
      filterType: "single",
      masteredIds: ["a", "b"],
      activePool: [poolItem("c")],
      pendingIds: [],
    });

    const stats = getStats(questions, state);
    expect(stats).toMatchObject({
      total: 2,
      mastered: 1,
      learning: 1,
    });
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
  it("sequential 模式按 pendingIds 正序入池", () => {
    const state = makeState({
      pendingIds: ["a", "b", "c", "d"],
      activePool: [],
      settings: makeSettings({ activePoolSize: 2, selectionMode: "sequential" }),
    });

    const result = fillActivePool(state);
    expect(result.activePool.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.pendingIds).toEqual(["c", "d"]);
  });

  it("sequential 模式非空池补题时仍按 pendingIds 正序追加", () => {
    const state = makeState({
      pendingIds: ["b", "c", "d"],
      activePool: [poolItem("a")],
      settings: makeSettings({ activePoolSize: 3, selectionMode: "sequential" }),
    });

    const result = fillActivePool(state);
    expect(result.activePool.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(result.pendingIds).toEqual(["d"]);
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
      hasBeenShown: false,
      lastSelectedRound: 42,
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

    installDebugConsoleCommands();

    const quizDebug = window.quizDebug;
    if (!quizDebug) throw new Error("quizDebug was not installed");

    expect(quizDebug).toBe(debug);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("OFF"),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );

    expect(quizDebug()).toBe(false);
    expect(quizDebug(true)).toBe(true);
    expect(quizDebug()).toBe(true);
    expect(quizDebug(false)).toBe(false);
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

  it("sequential 模式只影响入池，活动池内仍按加权随机选题", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const questions = [makeQuestion("a"), makeQuestion("b"), makeQuestion("c")];
    const state = makeState({
      currentRound: 10,
      activePool: [
        poolItem("a", { lastSelectedRound: -10 }),
        poolItem("b", { lastSelectedRound: 10 }),
        poolItem("c", { lastSelectedRound: -10 }),
      ],
      settings: makeSettings({ selectionMode: "sequential" }),
    });

    const next = selectNextFromPool(questions, state, "a");
    expect(next?.id).toBe("c");
  });

  it("池中只剩 currentQuestionId 时回到该题（兜底）", () => {
    const questions = [makeQuestion("a"), makeQuestion("b")];
    const state = makeState({
      activePool: [poolItem("a")],
      settings: makeSettings({ selectionMode: "sequential" }),
    });
    expect(selectNextFromPool(questions, state, "a")?.id).toBe("a");
  });

  it("活动池加权抽题：零权重题不会因为 Math.random=0 被选中", () => {
    // currentRound=10, length=2, item a lastSelectedRound=10 → cooldown 内，weight 0
    // item b lastSelectedRound=-10 → roundsSince 超过 length，weight 封顶为 1
    vi.spyOn(Math, "random").mockReturnValue(0);
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

  it("活动池加权抽题：权重在 x=m 时封顶，并使用二次曲线压低中段题", () => {
    // length=3：cooldown=0.6m=1.8，cap=m=3。
    // b 的 t=(2-1.8)/(3-1.8)=1/6，weight≈0.028；c 的 weight=1。
    // b 的累计概率约为 0.027，所以 random=0.03 应越过 b 选 c。
    vi.spyOn(Math, "random").mockReturnValue(0.03);
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

  it("活动池加权抽题跳过 currentQuestionId", () => {
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

  it("活动池加权抽题：Math.random=0.999 时倾向选最后一个累计到的", () => {
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

  it("单一 level → 保留完整 level 列表，非零段占 100%", () => {
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
    expect(segments.map((seg) => seg.level)).toEqual([1, 2, 3, 4]);
    expect(segments.map((seg) => seg.widthPercent)).toEqual([0, 0, 100, 0]);
    // 颜色返回字符串
    expect(typeof segments[2].color).toBe("string");
    expect(segments[2].color).toMatch(/^color-mix\(in oklch,/);
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
    expect(segments.map((seg) => seg.level)).toEqual([1, 2, 3]);
    // 升序：level 1 (1 题), level 2 (2 题), level 3 (1 题)
    expect(segments[0].widthPercent).toBe(25); // 1/4
    expect(segments[1].widthPercent).toBe(50); // 2/4
    expect(segments[2].widthPercent).toBe(25); // 1/4
  });

  it("carry-over 活动题即使不属于当前 filter 也计入学习分段", () => {
    const questions = [
      makeQuestion("a", "single", [0]),
      makeQuestion("b", "judgment", true),
    ];
    const state = makeState({
      filterType: "single",
      activePool: [poolItem("a"), poolItem("b", { consecutiveCorrect: 1 })],
    });
    const segments = computeLearningSegments(questions, state);
    expect(segments.map((seg) => seg.widthPercent)).toEqual([0, 50, 50, 0]);
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
    expect(segments[0].color).toMatch(/^color-mix\(in oklch,/);
  });
});
