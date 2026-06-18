import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { flushSync } from "svelte";
import {
  QuizSession,
  type QuizSessionDeps,
} from "../src/quiz/session/QuizSession.svelte";
import type { Bank } from "../src/source/types";
import type { Question, QuestionType } from "../src/types";
import {
  saveState,
  loadStoredState,
  createActivePoolItem,
  createDefaultSettings,
} from "../src/store";
import { STORAGE_KEY_DEFAULT_SETTINGS } from "../src/config";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HASH = "test_session_hash";

function q(
  id: string,
  type: QuestionType,
  answer: Question["answer"],
  options?: { text: string }[],
): Question {
  return { id, type, question: `q-${id}`, answer, options };
}

function makeBank(questions?: Question[]): Bank {
  return {
    hash: HASH,
    name: "test bank",
    questions:
      questions ??
      [
        q("judgment_1", "judgment", true),
        q("judgment_2", "judgment", false),
        q("single_1", "single", [0], [{ text: "A" }, { text: "B" }]),
        q("blank_1", "blank", "hello"),
      ],
  };
}

function makeDeps() {
  const flash = vi.fn();
  const toast = vi.fn();
  return {
    deps: { flash, toast } as QuizSessionDeps,
    flash,
    toast,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 构造 & initialize
// ---------------------------------------------------------------------------

describe("QuizSession 构造", () => {
  it("constructor 从 localStorage 加载默认 state", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    expect(session.appState.masteredIds).toEqual([]);
    expect(session.appState.activePool).toEqual([]);
    expect(session.appState.ui.progressFocused).toBe(false);
    expect(session.appState.ui.showPool).toBe(false);
    expect(session.currentQuestion).toBeNull();
  });

  it("constructor 从 localStorage 加载已有 state", () => {
    saveState(HASH, {
      masteredIds: ["judgment_1"],
      activePool: [],
      currentRound: 7,
      filterType: "single",
      settings: createDefaultSettings(),
      ui: { progressFocused: true, showPool: true },
      pendingIds: [],
    });
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    expect(session.appState.masteredIds).toEqual(["judgment_1"]);
    expect(session.appState.currentRound).toBe(7);
    expect(session.appState.filterType).toBe("single");
    expect(session.appState.ui.progressFocused).toBe(true);
    expect(session.appState.ui.showPool).toBe(true);
  });

  it("filterOptions 在构造时计算一次", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    expect(session.filterOptions.length).toBeGreaterThan(0);
  });

  it("initialize() 后 activePool 被填充、currentQuestion 非空", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.initialize();
    expect(session.appState.activePool.length).toBeGreaterThan(0);
    expect(session.currentQuestion).not.toBeNull();
    const currentItem = session.appState.activePool.find(
      (item) => item.id === session.currentQuestion?.id,
    );
    expect(currentItem?.hasBeenShown).toBe(true);
    expect(
      session.appState.activePool.some(
        (item) => item.id !== session.currentQuestion?.id && !item.hasBeenShown,
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

describe("submit", () => {
  function bootstrap(answer: Question["answer"], type: QuestionType = "judgment") {
    const { deps, flash, toast } = makeDeps();
    const questions = [q("only_q", type, answer)];
    const session = new QuizSession(makeBank(questions), deps);
    session.initialize();
    return { session, flash, toast };
  }

  it("答对：showResult/isCorrect=true, flash(true)", () => {
    const { session, flash } = bootstrap(true);
    // judgment 题：button 0 = "正确"，button 1 = "错误"
    // answer=true → 正确按钮 (selectedAnswers=[0])
    session.selectedAnswers = [0];
    session.submit();
    expect(session.showResult).toBe(true);
    expect(session.isCorrect).toBe(true);
    expect(flash).toHaveBeenCalledWith(true);
  });

  it("答错：isCorrect=false, flash(false), hasEverMistaken 被打上", () => {
    const { session, flash } = bootstrap(true);
    session.selectedAnswers = [1]; // 选 "错误"
    session.submit();
    expect(session.isCorrect).toBe(false);
    expect(flash).toHaveBeenCalledWith(false);
    const item = session.appState.activePool.find((i) => i.id === "only_q");
    expect(item?.hasEverMistaken).toBe(true);
  });

  it("currentQuestion 为 null 时 submit 不生效", () => {
    const { deps, flash } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    // 未 initialize → currentQuestion=null
    session.submit();
    expect(session.showResult).toBe(false);
    expect(flash).not.toHaveBeenCalled();
  });

  it("autoNextOnCorrect=true 且答对 → 自动 selectNext", () => {
    const { deps } = makeDeps();
    const questions = [
      q("a", "judgment", true),
      q("b", "judgment", true),
    ];
    const session = new QuizSession(makeBank(questions), deps);
    session.appState.settings.autoNextOnCorrect = true;
    session.initialize();
    const firstId = session.currentQuestion!.id;
    session.selectedAnswers = [0]; // judgment answer=true 的正确按钮
    session.submit();
    // 自动跳过后，新一题不再是上一题
    expect(session.showResult).toBe(false);
    expect(session.currentQuestion?.id).not.toBe(firstId);
  });
});

// ---------------------------------------------------------------------------
// treatLastAnswerAsCorrect
// ---------------------------------------------------------------------------

describe("treatLastAnswerAsCorrect", () => {
  it("rewind 到 submit 前状态再以 correct=true 重跑", () => {
    const { deps, flash } = makeDeps();
    const questions = [q("only_q", "judgment", true)];
    const session = new QuizSession(makeBank(questions), deps);
    session.initialize();
    session.selectedAnswers = [1]; // 答错（选 "错误"）
    session.submit();

    expect(session.isCorrect).toBe(false);
    const itemAfterWrong = session.appState.activePool.find((i) => i.id === "only_q");
    expect(itemAfterWrong?.hasEverMistaken).toBe(true);

    // 当作正确
    session.treatLastAnswerAsCorrect();
    expect(session.isCorrect).toBe(true);
    // rewind 后再走一次 correct=true，hasEverMistaken 不应该被这次 typo 打上
    const itemAfterRewind = session.appState.activePool.find((i) => i.id === "only_q");
    expect(itemAfterRewind?.hasEverMistaken).toBe(false);
    expect(itemAfterRewind?.consecutiveCorrect).toBe(1);
    expect(flash).toHaveBeenLastCalledWith(true);
  });

  it("没有 preSubmitState 时 no-op", () => {
    const { deps, flash } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.initialize();
    session.treatLastAnswerAsCorrect();
    // flash 不应该被调用
    expect(flash).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// markCurrentAsMastered
// ---------------------------------------------------------------------------

describe("markCurrentAsMastered", () => {
  it("当前题进 masteredIds、出 activePool，切下一题", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.initialize();
    const targetId = session.currentQuestion!.id;
    session.markCurrentAsMastered();
    expect(session.appState.masteredIds).toContain(targetId);
    expect(
      session.appState.activePool.find((i) => i.id === targetId),
    ).toBeUndefined();
  });
});

describe("markAsMastered（任一池项）", () => {
  it("掌握非当前题：进 masteredIds、出 activePool，不切下一题", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.initialize();
    const currentId = session.currentQuestion!.id;
    // 找一道池内非当前的题
    const other = session.appState.activePool.find((i) => i.id !== currentId);
    if (!other) throw new Error("fixture 池中应有非当前题");

    session.markAsMastered(other.id);
    expect(session.appState.masteredIds).toContain(other.id);
    expect(
      session.appState.activePool.find((i) => i.id === other.id),
    ).toBeUndefined();
    // currentQuestion 不变（不掌握当前题就不切下一题）
    expect(session.currentQuestion?.id).toBe(currentId);
  });

  it("掌握当前题：会自动切下一题", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.initialize();
    const before = session.currentQuestion!.id;
    session.markAsMastered(before);
    expect(session.appState.masteredIds).toContain(before);
    // 题库总共 4 道，掌握 1 道还有 3 道可选
    expect(session.currentQuestion?.id).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// setFilter
// ---------------------------------------------------------------------------

describe("setFilter", () => {
  it("filterType 切换后 appState.filterType 更新且 selectNext", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.appState.settings.selectionMode = "sequential";

    const accepted = session.setFilter("single");

    expect(accepted).toBe(true);
    expect(session.appState.filterType).toBe("single");
    expect(session.currentQuestion?.type).toBe("single");
  });

  it("filterType 相同时 no-op", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.initialize();
    const before = session.currentQuestion;
    session.setFilter("all");
    expect(session.currentQuestion).toBe(before); // 不变
  });

  it("切换会排除已展示活动题时，进入待确认且不改 filterType", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.appState = {
      ...session.appState,
      filterType: "all",
      activePool: [
        { ...createActivePoolItem("single_1"), hasBeenShown: true },
      ],
      pendingIds: [],
    };

    const accepted = session.setFilter("blank");

    expect(accepted).toBe(false);
    expect(session.pendingFilterType).toBe("blank");
    expect(session.appState.filterType).toBe("all");
  });

  it("取消待确认筛选切换时不改变状态", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.appState = {
      ...session.appState,
      filterType: "all",
      activePool: [
        { ...createActivePoolItem("single_1"), hasBeenShown: true },
      ],
      pendingIds: [],
    };

    session.setFilter("blank");
    session.cancelPendingFilterChange();

    expect(session.pendingFilterType).toBeNull();
    expect(session.appState.filterType).toBe("all");
    expect(session.appState.activePool.map((item) => item.id)).toEqual([
      "single_1",
    ]);
  });

  it("确认保留当前题目：保留已展示题，未展示题按新 filter 重新入池", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(
      makeBank([
        q("single_1", "single", [0], [{ text: "A" }]),
        q("blank_1", "blank", "x"),
        q("blank_2", "blank", "y"),
        q("judgment_1", "judgment", true),
      ]),
      deps,
    );
    session.appState = {
      ...session.appState,
      filterType: "all",
      settings: {
        ...session.appState.settings,
        activePoolSize: 5,
        selectionMode: "sequential",
      },
      activePool: [
        { ...createActivePoolItem("single_1"), hasBeenShown: true },
        createActivePoolItem("judgment_1"),
      ],
      pendingIds: [],
    };

    session.setFilter("blank");
    session.confirmPendingFilterChange("keep-shown");

    expect(session.pendingFilterType).toBeNull();
    expect(session.appState.filterType).toBe("blank");
    expect(session.appState.activePool.map((item) => item.id)).toEqual([
      "single_1",
      "blank_1",
      "blank_2",
    ]);
    expect(
      session.appState.activePool.some((item) => item.id === "judgment_1"),
    ).toBe(false);
  });

  it("确认清空活动题池：只按新 filter 重新补池", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.appState = {
      ...session.appState,
      filterType: "all",
      settings: {
        ...session.appState.settings,
        activePoolSize: 5,
        selectionMode: "sequential",
      },
      activePool: [
        { ...createActivePoolItem("single_1"), hasBeenShown: true },
        { ...createActivePoolItem("judgment_1"), hasBeenShown: true },
      ],
      pendingIds: [],
    };

    session.setFilter("blank");
    session.confirmPendingFilterChange("clear-active-pool");

    expect(session.pendingFilterType).toBeNull();
    expect(session.appState.filterType).toBe("blank");
    expect(session.appState.activePool.map((item) => item.id)).toEqual([
      "blank_1",
    ]);
    expect(session.currentQuestion?.type).toBe("blank");
  });
});

// ---------------------------------------------------------------------------
// reset
// ---------------------------------------------------------------------------

describe("reset", () => {
  it("masteredIds / activePool 清空，filterType + settings 保留", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.initialize();
    session.markCurrentAsMastered();
    expect(session.appState.masteredIds.length).toBeGreaterThan(0);
    if (!session.setFilter("single")) {
      session.confirmPendingFilterChange("clear-active-pool");
    }
    session.appState.settings.autoNextOnCorrect = true;
    session.handlePreferenceChange(); // 把设置持久化

    session.reset();
    expect(session.appState.masteredIds).toEqual([]);
    expect(session.appState.filterType).toBe("single"); // 保留
    expect(session.appState.settings.autoNextOnCorrect).toBe(true); // 保留
  });
});

// ---------------------------------------------------------------------------
// togglePool / toggleProgressFocus
// ---------------------------------------------------------------------------

describe("UI 偏好 toggle", () => {
  it("togglePool 翻转 ui.showPool 并持久化", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    expect(session.appState.ui.showPool).toBe(false);
    session.togglePool();
    expect(session.appState.ui.showPool).toBe(true);
    // 验证持久化
    expect(loadStoredState(HASH).ui.showPool).toBe(true);
  });

  it("toggleProgressFocus 仅在 stats.learning > 0 时生效", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    // 未 initialize，activePool 为空 → stats.learning === 0
    session.toggleProgressFocus();
    expect(session.appState.ui.progressFocused).toBe(false);
    // initialize 后 activePool 有题
    session.initialize();
    session.toggleProgressFocus();
    expect(session.appState.ui.progressFocused).toBe(true);
  });

  it("toggleAutoNext 触发 toast 通知", () => {
    const { deps, toast } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.toggleAutoNext();
    expect(session.appState.settings.autoNextOnCorrect).toBe(true);
    expect(toast).toHaveBeenCalled();
  });

  it("默认情况下，设置变更不会写入持久化默认设置", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);

    session.toggleAutoNext();

    expect(localStorage.getItem(STORAGE_KEY_DEFAULT_SETTINGS)).toBeNull();
  });

  it("启用持久化默认设置时，设置变更会同步写入默认设置", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps, {
      persistDefaultSettings: true,
    });

    session.toggleAutoNext();

    expect(
      JSON.parse(localStorage.getItem(STORAGE_KEY_DEFAULT_SETTINGS)!),
    ).toMatchObject({
      autoNextOnCorrect: true,
    });
  });

  it("启用持久化默认设置时，新题库会继承默认设置", () => {
    localStorage.setItem(
      STORAGE_KEY_DEFAULT_SETTINGS,
      JSON.stringify({
        ...createDefaultSettings(),
        autoNextOnCorrect: true,
        activePoolSize: 30,
      }),
    );
    const { deps } = makeDeps();

    const session = new QuizSession(makeBank(), deps, {
      persistDefaultSettings: true,
    });

    expect(session.appState.settings.autoNextOnCorrect).toBe(true);
    expect(session.appState.settings.activePoolSize).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// 复制当前题目
// ---------------------------------------------------------------------------

describe("复制当前题目", () => {
  it("copyCurrentQuestion 写入当前题目文本", async () => {
    const { deps } = makeDeps();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const session = new QuizSession(
      makeBank([q("only_q", "judgment", true)]),
      deps,
    );
    session.initialize();
    expect(session.copyQuestionStatus).toBe("idle");
    const result = await session.copyCurrentQuestion();

    expect(result).toBe("copied");
    expect(session.copyQuestionStatus).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("判断题：\nq-only_q");
  });

  it("copyCurrentQuestion 快捷键触发时用 toast 反馈", async () => {
    const { deps, toast } = makeDeps();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const session = new QuizSession(
      makeBank([q("only_q", "judgment", true)]),
      deps,
    );
    session.initialize();
    const result = await session.copyCurrentQuestion({ announce: true });

    expect(result).toBe("copied");
    expect(session.copyQuestionStatus).toBe("copied");
    expect(toast).toHaveBeenCalledWith(
      "题目已复制到剪贴板",
      expect.any(String),
      "success",
    );
  });

  it("copyCurrentQuestion 无当前题时不写剪贴板", async () => {
    const { deps } = makeDeps();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const session = new QuizSession(makeBank(), deps);
    const result = await session.copyCurrentQuestion();

    expect(result).toBe("unavailable");
    expect(session.copyQuestionStatus).toBe("idle");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copyCurrentQuestion 失败时更新复制状态", async () => {
    const { deps } = makeDeps();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const session = new QuizSession(
      makeBank([q("only_q", "judgment", true)]),
      deps,
    );
    session.initialize();
    const result = await session.copyCurrentQuestion();

    expect(result).toBe("error");
    expect(session.copyQuestionStatus).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// 导入导出
// ---------------------------------------------------------------------------

describe("导出 / 导入", () => {
  it("exportProgress 成功后 exportStatus → copied，toast 调用", async () => {
    const { deps, toast } = makeDeps();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText, readText: vi.fn() },
      configurable: true,
    });

    const session = new QuizSession(makeBank(), deps);
    await session.exportProgress();
    expect(session.exportStatus).toBe("copied");
    expect(writeText).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      "进度已复制到剪贴板",
      expect.any(String),
      "success",
    );
  });

  it("exportProgress 失败 → exportStatus error，toast 报错", async () => {
    const { deps, toast } = makeDeps();
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(global.navigator, "clipboard", {
      value: { writeText, readText: vi.fn() },
      configurable: true,
    });

    const session = new QuizSession(makeBank(), deps);
    await session.exportProgress();
    expect(session.exportStatus).toBe("error");
    expect(toast).toHaveBeenCalledWith(
      "导出失败",
      expect.any(String),
      "destructive",
    );
  });

  it("startImport 失败 → toast 报错，importConfirmText 不变", async () => {
    const { deps, toast } = makeDeps();
    Object.defineProperty(global.navigator, "clipboard", {
      value: { readText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    const session = new QuizSession(makeBank(), deps);
    await session.startImport();
    expect(toast).toHaveBeenCalledWith(
      "无法导入",
      expect.any(String),
      "destructive",
    );
    expect(session.importConfirmText).toBeNull();
  });

  it("cancelImport 清空 importConfirmText", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.importConfirmText = "blah";
    session.cancelImport();
    expect(session.importConfirmText).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// derived 可读
// ---------------------------------------------------------------------------

describe("derived 字段", () => {
  it("stats / allMastered 可读", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.initialize();
    expect(session.stats.total).toBe(4);
    expect(session.allMastered).toBe(false);
  });

  it("currentTypeDef / currentPoolItem / requiredStreak 在 currentQuestion 设置后非空", () => {
    const { deps } = makeDeps();
    const session = new QuizSession(makeBank(), deps);
    session.initialize();
    expect(session.currentTypeDef).not.toBeNull();
    expect(session.currentPoolItem).toBeDefined();
    expect(session.requiredStreak).toBeGreaterThan(0);
  });
});
