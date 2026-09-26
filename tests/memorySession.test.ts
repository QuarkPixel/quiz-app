import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushSync } from "svelte";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import {
  addDays,
  advanceReview,
  createLearningProgress,
  createReviewProgress,
  cumulativeIntervalDays,
  isDue,
  memoryIntervalDays,
  overdueDays,
  resetReview,
  reviewProgress,
  startOfDay,
  stateOf,
  studyDay,
} from "../src/features/memory/algorithm";
import {
  createDefaultMemorySettings,
  sanitizeMemorySettings,
} from "../src/features/memory/settings";
import { normalizeMemoryProgress } from "../src/features/memory/normalize";
import { MEMORY_ANSWER_CODE } from "../src/quiz/types/memory/logic";
import { loadStoredState, saveState } from "../src/store";
import { exportProgress } from "../src/features/importExport";
import { readProgressFromClipboard } from "../src/features/quiz/progressActions";
import {
  GlobalSettingsStore,
  globalSettingsStore,
} from "../src/features/globalSettings.svelte";
import { devNow } from "../src/features/memory/devClock";
import type { MemoryBank } from "../src/source/types";
import type {
  MemoryProgressMap,
  MemoryQuestion,
  StoredState,
} from "../src/types";

// startImport 走剪贴板：用一个可改写的假实现，测试里塞进导出的进度串
const clipboard = vi.hoisted(() => ({ text: "" }));
vi.mock("clipboard-polyfill", () => ({
  writeText: vi.fn(async (text: string) => {
    clipboard.text = text;
  }),
  readText: vi.fn(async () => clipboard.text),
}));

const BASE_TIME = new Date(2025, 0, 1, 10, 30, 0).getTime();
const DAY = 86_400_000;

function mq(id: string): MemoryQuestion {
  return { id, type: "memory", question: `题-${id}`, answer: `答-${id}` };
}

function makeBank(ids: string[], hash = "memory_test_hash"): MemoryBank {
  return { hash, name: "记忆题库", mode: "memory", questions: ids.map(mq) };
}

function emptyState(): StoredState {
  return {
    masteredIds: [],
    masteredMistakes: {},
    activePool: [],
    currentRound: 0,
    filterType: "all",
    settings: {
      activePoolSize: 25,
      correctStreakToMaster: 3,
      correctStreakAfterMistake: 4,
      selectionMode: "random",
      notifyNewQuestionInPool: false,
    },
    ui: { progressFocused: false, showPool: false },
  };
}

/** 新建一个 session；now 固定成给定时间。 */
function makeSession(
  ids: string[],
  options: {
    now?: number;
    hash?: string;
    now2?: () => number;
    toast?: (title: string, description?: string, variant?: string) => void;
    /** 注入一份独立的全局设置；不传就用内存单例（多数用例的默认） */
    store?: GlobalSettingsStore;
  } = {},
): MemorySession {
  const fixedNow = options.now ?? BASE_TIME;
  return new MemorySession(
    makeBank(ids, options.hash),
    {
      flash: () => {},
      toast: options.toast ?? (() => {}),
      sound: { play: () => {} } as never,
    },
    options.store ?? globalSettingsStore,
    { now: options.now2 ?? (() => fixedNow) },
  );
}

/** 走一道卡：自评（1=知道 / 0=忘记）+ 提交 + 下一题。 */
function answer(session: MemorySession, knows: boolean): void {
  answerKind(session, knows ? "know" : "forget");
}

/** 走一道卡：三选自评（知道 / 模糊 / 忘记）+ 提交 + 下一题。 */
function answerKind(session: MemorySession, kind: "know" | "fuzzy" | "forget"): void {
  session.selectedAnswers = [MEMORY_ANSWER_CODE[kind]];
  session.submit();
  flushSync();
  session.advanceQuestionFlow();
  flushSync();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// 1. 算法：间隔曲线
// ---------------------------------------------------------------------------

describe("记忆模式：间隔曲线", () => {
  it("按 1 / 2 / 4 / 8 / 16… 翻倍，并在 365 天封顶", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(memoryIntervalDays)).toEqual([
      1, 2, 4, 8, 16, 32, 64,
    ]);
    expect(memoryIntervalDays(10)).toBe(365);
    expect(memoryIntervalDays(0)).toBe(1);
  });

  it("掌握阈值对应一条固定天数表", () => {
    expect(cumulativeIntervalDays(1)).toBe(1);
    expect(cumulativeIntervalDays(7)).toBe(127);
  });

  it("日期推进按本地自然日计算", () => {
    const jan1 = startOfDay(new Date(2025, 0, 1, 23, 59).getTime());
    expect(new Date(addDays(jan1, 31)).getDate()).toBe(1);
    expect(new Date(addDays(jan1, 32)).getMonth()).toBe(1);
  });

  it("一天从凌晨 5 点开始：5 点前算前一天，5 点后算次日", () => {
    const jan10 = startOfDay(new Date(2025, 0, 10, 12, 0).getTime());
    // 凌晨 4:59 还是 1 月 9 日
    expect(studyDay(jan10 + 4 * 3600_000 + 59 * 60_000)).toBe(
      addDays(jan10, -1),
    );
    // 早上 5:00 起算 1 月 10 日
    expect(studyDay(jan10 + 5 * 3600_000)).toBe(jan10);
    expect(studyDay(jan10 + 23 * 3600_000)).toBe(jan10);
  });

  it("到期判断也按凌晨 5 点换日", () => {
    // nextDue = 1 月 10 日（日期锚点）
    const item = {
      ...createReviewProgress(BASE_TIME),
      nextDue: startOfDay(new Date(2025, 0, 10, 12, 0).getTime()),
    };
    const jan10 = startOfDay(new Date(2025, 0, 10, 12, 0).getTime());

    // 1 月 10 日凌晨 3 点：还算 1 月 9 日 → 没到期
    expect(isDue(item, jan10 + 3 * 3600_000)).toBe(false);
    expect(overdueDays(item, jan10 + 3 * 3600_000)).toBe(0);
    // 1 月 10 日早上 6 点：到期
    expect(isDue(item, jan10 + 6 * 3600_000)).toBe(true);
    expect(overdueDays(item, jan10 + 6 * 3600_000)).toBe(0);
    // 1 月 11 日凌晨 3 点：还算 1 月 10 日 → 逾期 0 天
    expect(overdueDays(item, jan10 + 24 * 3600_000 + 3 * 3600_000)).toBe(0);
    // 1 月 11 日早上 6 点：逾期 1 天
    expect(overdueDays(item, jan10 + 24 * 3600_000 + 6 * 3600_000)).toBe(1);
  });

  it("凌晨 2 点学出来的卡：那还算「昨天」，所以凌晨 5 点就到期", () => {
    const jan10 = startOfDay(new Date(2025, 0, 10, 12, 0).getTime());
    // 1 月 11 日凌晨 2 点（学习日仍是 1 月 10 日）
    const lateNight = jan10 + 24 * 3600_000 + 2 * 3600_000;
    const item = createReviewProgress(lateNight);
    // 「明天」= 1 月 11 日这个学习日，它从凌晨 5 点开始
    expect(item.nextDue).toBe(jan10 + 24 * 3600_000);
    expect(isDue(item, lateNight)).toBe(false);
    expect(isDue(item, jan10 + 24 * 3600_000 + 5 * 3600_000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. 算法：状态流转
// ---------------------------------------------------------------------------

describe("记忆模式：状态流转", () => {
  it("新学出来的题进入复习中，第 1 次复习安排在明天", () => {
    const progress = createReviewProgress(BASE_TIME);
    expect(progress.state).toBe("reviewing");
    expect(progress.level).toBe(1);
    expect(progress.nextDue).toBe(addDays(startOfDay(BASE_TIME), 1));
    expect(stateOf(progress)).toBe("reviewing");
  });

  it("答对推进一级；走完阈值后变成已掌握", () => {
    let progress = createReviewProgress(BASE_TIME);
    for (let level = 1; level <= 6; level++) {
      progress = advanceReview(progress, 7, BASE_TIME);
      expect(progress.level).toBe(level + 1);
    }
    progress = advanceReview(progress, 7, BASE_TIME);
    expect(progress.state).toBe("mastered");
    expect(progress.nextDue).toBe(0);
  });

  it("答错归零：留在复习中，从第 1 级（1 天）重来", () => {
    let progress = advanceReview(createReviewProgress(BASE_TIME), 7, BASE_TIME);
    const failed = resetReview(progress, BASE_TIME);
    expect(failed.state).toBe("reviewing");
    expect(failed.level).toBe(1);
    expect(failed.lapses).toBe(1);
  });

  it("未到期不算 due，逾期天数可算", () => {
    const progress = createReviewProgress(BASE_TIME);
    expect(isDue(progress, BASE_TIME)).toBe(false);
    expect(isDue(progress, BASE_TIME + DAY)).toBe(true);
    expect(overdueDays(progress, BASE_TIME + 3 * DAY)).toBe(2);
  });

  it("复习进度越接近阈值越接近 1", () => {
    expect(reviewProgress(createReviewProgress(BASE_TIME), 7)).toBe(0);
    expect(
      reviewProgress({ ...createReviewProgress(BASE_TIME), level: 5 }, 7),
    ).toBeCloseTo(4 / 7);
  });
});

// ---------------------------------------------------------------------------
// 3. 学习流
// ---------------------------------------------------------------------------

describe("记忆模式：学习流", () => {
  it("连续答对 3 次后进入复习中，本轮不再出现", () => {
    const session = makeSession(["a", "b"]);
    session.startLearning();
    expect(session.run).toBe("learning");

    // 每道卡要连续答对 3 次；队列顺序由算法决定（答对后出队、答错后回队尾），
    // 这里只驱动到本轮结束，再断言每道卡都毕业了。
    let guard = 0;
    while (session.run === "learning" && session.currentQuestion) {
      expect(guard++).toBeLessThan(20);
      answer(session, true);
    }

    expect(session.progress.a.state).toBe("reviewing");
    expect(session.progress.b.state).toBe("reviewing");
    expect(session.progress.a.nextDue).toBe(addDays(startOfDay(BASE_TIME), 1));
  });

  it("中途点「忘记」清零连对，本题在本轮稍后再来", () => {
    const session = makeSession(["a"]);
    session.startLearning();
    answer(session, true);
    answer(session, true);
    expect(session.progress.a.streak).toBe(2);

    session.selectedAnswers = [0];
    session.submit();
    flushSync();
    expect(session.showResult).toBe(true);
    expect(session.isCorrect).toBe(false);
    expect(session.progress.a.streak).toBe(0);

    session.advanceQuestionFlow();
    flushSync();
    // 本轮只有这一道，排到队尾后立刻又是它
    expect(session.run).toBe("learning");
    expect(session.currentQuestion?.id).toBe("a");
    expect(session.progress.a.streak).toBe(0);
  });

  it("答「知道」后发现记错了：点「答错记错」改判成答错", () => {
    const session = makeSession(["a"]);
    session.startLearning();
    session.selectedAnswers = [1];
    session.submit();
    flushSync();
    expect(session.isCorrect).toBe(true);
    expect(session.progress.a.streak).toBe(1);

    session.markAsWrong();
    flushSync();
    expect(session.isCorrect).toBe(false);
    expect(session.progress.a.streak).toBe(0);
    expect(session.currentStreak).toBe(0);
  });

  it("答「忘记」后没有反悔入口（isCorrect 已是 false）", () => {
    const session = makeSession(["a"]);
    session.startLearning();
    session.selectedAnswers = [0];
    session.submit();
    flushSync();
    expect(session.isCorrect).toBe(false);
    // 再点「答错记错」是空操作（session 里有 isCorrect 守卫）
    session.markAsWrong();
    flushSync();
    expect(session.isCorrect).toBe(false);
    // 学习流的「忘记」也计入累计答错次数（lapses 的口径就是「累计答错」）
    expect(session.progress.a.lapses).toBe(1);
    expect(session.progress.a.streak).toBe(0);
  });

  it("lapses 统计学习流的「忘记」，毕业进入复习时不清零", () => {
    const session = makeSession(["a"]);
    session.startLearning();

    answer(session, false);
    expect(session.progress.a.lapses).toBe(1);

    // 连对到门槛毕业：阶梯从 1 开始，但 lapses 要留着
    let guard = 0;
    while (
      session.progress.a?.state !== "reviewing" &&
      session.run === "learning" &&
      guard++ < 10
    ) {
      answer(session, true);
    }
    expect(session.progress.a.state).toBe("reviewing");
    expect(session.progress.a.level).toBe(1);
    expect(session.progress.a.lapses).toBe(1);
  });

  it("活动池按「顺序」挑入池，池内出题随机", () => {
    const session = makeSession(["a", "b", "c", "d", "e", "f"]);
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();

    // 顺序 = 取题库最前面的 5 道入池
    expect(session.appState.activePool.map((i) => i.id).sort()).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
    // 池内出题随机：第一道不保证是 a，但一定是池里的题
    expect(["a", "b", "c", "d", "e"]).toContain(session.currentQuestion?.id);
  });

  it("每掌握一题就补一题进活动池；凑够一轮目标就结束本轮", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const session = makeSession(ids);
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 3 });
    session.startLearning();

    // 一道卡要连对 3 次才毕业；每道卡出现时都答「知道」
    const graduated = new Set<string>();
    let guard = 0;
    while (session.run === "learning" && session.currentQuestion) {
      expect(guard++).toBeLessThan(60);
      const id = session.currentQuestion.id;
      session.selectedAnswers = [1];
      session.submit();
      flushSync();
      if (session.progress[id]?.state === "reviewing") graduated.add(id);
      session.advanceQuestionFlow();
      flushSync();
      // 池子始终维持本轮目标数量（掌握一题补一题）
      if (session.run === "learning") {
        expect(session.appState.activePool.length).toBe(3);
      }
    }

    // 本轮掌握 3 题就结束（roundTarget = 3），计数归零
    expect(session.run).toBe("idle");
    expect(graduated.size).toBe(3);
    expect(session.roundMastered).toBe(0);
  });

  it("没有新题时给出提示、不进入答题流", () => {
    const hash = "memory_empty_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: createReviewProgress(BASE_TIME) },
        settings: createDefaultMemorySettings(),
      },
    });
    const session = makeSession(["a"], { hash });
    session.startLearning();
    expect(session.run).toBe("idle");
    expect(session.newCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3b. 每轮限定题数（lockRoundPool）
// ---------------------------------------------------------------------------

describe("记忆模式：每轮限定题数", () => {
  /** 开一轮「每轮限定题数」的学习轮（顺序模式，挑哪几道因此是可预期的）。 */
  function startLocked(
    ids: string[],
    target: number,
    options: { hash?: string; toast?: (t: string, d?: string) => void } = {},
  ): MemorySession {
    const session = makeSession(ids, options);
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: target, lockRoundPool: true });
    session.startLearning();
    return session;
  }

  it("开轮时挑一批（数量 = 目标每轮学习数）就定死，学会一道也不补新题", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const session = startLocked(ids, 3);

    // 顺序模式：这一批 = 题库最前面的 3 道
    const starters = session.appState.activePool.map((i) => i.id).sort();
    expect(starters).toEqual(["a", "b", "c"]);
    expect([...session.appState.roundPoolIds!].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);

    // 每道卡要连对 3 次才毕业；学会一道池子就少一道，绝不补新的进来
    const everInPool = new Set(starters);
    const poolSizes: number[] = [];
    let guard = 0;
    while (session.run === "learning" && session.currentQuestion) {
      expect(guard++, "本轮该在有限次内结束").toBeLessThan(200);
      answer(session, true);
      poolSizes.push(session.appState.activePool.length);
      for (const item of session.appState.activePool) everInPool.add(item.id);
    }

    expect(session.run).toBe("idle");
    // 池子一路只减不增，最后空掉（对照关掉开关那一条：那边始终是满的）
    expect(poolSizes).toEqual([3, 3, 3, 3, 3, 3, 2, 1, 0]);
    // 全程只有这一批里那 3 道进过池子——没有 d / e / f 混进来
    expect([...everInPool].sort()).toEqual(["a", "b", "c"]);
    expect(session.appState.activePool).toEqual([]);
    expect(session.appState.roundPoolIds).toEqual([]);
    // 学满目标：正常收尾（不是「没有更多新卡片了」）
    expect(session.newCount).toBeGreaterThan(0);
  });

  it("对照：关掉开关时同一份题库会一路补新题进来，而且池子始终是满的", () => {
    // 题库给足：一轮要掌握 8 道、每道得连对 3 次，池子又始终是满的，
    // 卡不够会因为「没候选」掉到 7 道（那条规矩在「每掌握一题就补一题」里已钉过）
    const ids = Array.from({ length: 26 }, (_, i) =>
      String.fromCharCode(97 + i),
    );
    const session = makeSession(ids);
    session.updateBankSettings({ selectionMode: "sequential" });
    // 目标给大一点，让本轮长到足以出现「补进来的新卡」（目标 3 时一轮只有
    // 9 次出题，补位的那两道还没轮到就结束了）
    session.updateMemorySettings({ roundTarget: 8 });
    session.startLearning();

    expect(session.appState.activePool.map((i) => i.id).sort()).toEqual([
      "a", "b", "c", "d", "e", "f", "g", "h",
    ]);

    // 池子始终维持本轮目标数量（掌握一题补一题）
    const everInPool = new Set(session.appState.activePool.map((i) => i.id));
    let guard = 0;
    while (session.run === "learning" && session.currentQuestion) {
      expect(guard++).toBeLessThan(400);
      answer(session, true);
      for (const item of session.appState.activePool) everInPool.add(item.id);
      // 只在真的还在这一轮里时查池子：最后一下会直接收尾，
      // 收尾时池子是要被清掉的（见 `endRoundPool`）
      if (session.run === "learning") {
        expect(session.appState.activePool.length).toBe(8);
      }
    }

    expect(session.run).toBe("idle");
    // 学会一道补一道：这一轮里进过池子的卡**比开轮那 8 道多**——
    // 「这次只刷这几道」开关关掉时就是这个行为（开着时全程只有那 8 道）
    expect(everInPool.size).toBeGreaterThan(8);
  });

  it("这一批里有卡没学出来：搁下这一轮后，下一轮重新挑（不复用上一轮那几道）", () => {
    const toasts: { title: string; description?: string }[] = [];
    const ids = ["a", "b", "c", "d", "e", "f"];
    const session = startLocked(ids, 3, {
      hash: "memory_locked_stuck_hash",
      toast: (title, description) => toasts.push({ title, description }),
    });
    expect(session.appState.activePool.map((i) => i.id).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);

    // a、b 学会；c 一直答错（连对永远清零）→ 池子里只剩它一道
    let guard = 0;
    while (session.roundMastered < 2 && session.run === "learning") {
      expect(guard++).toBeLessThan(200);
      const id = session.currentQuestion!.id;
      answer(session, id !== "c");
    }
    expect(session.appState.activePool.map((i) => i.id)).toEqual(["c"]);

    // 卡住的那道不会自己消失：搁下这一轮（「结束本轮」）
    session.endRound();
    expect(session.run).toBe("idle");
    expect(session.roundMastered).toBe(0);
    expect(session.appState.roundPoolIds).toEqual([]);
    // 没学满就结束，不该报成功
    expect(toasts.some((t) => t.title === "本轮学习完成")).toBe(false);

    // 再开一轮：重新挑一批，还是满的 3 道
    session.startLearning();
    expect(session.run).toBe("learning");
    expect(session.appState.activePool.length).toBe(3);
    expect(session.appState.roundPoolIds?.length).toBe(3);
  });

  it("学到一半退出再进来：池子不重新灌满（这道卡不会被顶掉）", () => {
    const hash = "memory_locked_resume_hash";
    const ids = ["a", "b", "c", "d", "e", "f"];
    const session = startLocked(ids, 3, { hash });

    // 学出一道，池子从 3 道变 2 道
    let guard = 0;
    while (session.roundMastered === 0 && session.run === "learning") {
      expect(guard++).toBeLessThan(40);
      answer(session, true);
    }
    expect(session.roundMastered).toBe(1);
    expect(session.appState.activePool.length).toBe(2);
    session.exitSession();

    // 重新载入（等价于刷新页面）：这一批从盘上读回来，池子仍是 2 道、不补新题
    const reloaded = makeSession(ids, { hash });
    reloaded.startLearning();
    expect(reloaded.run).toBe("learning");
    expect(reloaded.appState.activePool.length).toBe(2);
    expect(reloaded.roundMastered).toBe(1);
    expect([...reloaded.appState.roundPoolIds!].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("这一批落盘：保存后读得回来，关掉开关也不动已经开着的那一轮", () => {
    const hash = "memory_locked_persist_hash";
    const session = startLocked(["a", "b", "c", "d", "e", "f"], 3, { hash });
    expect([...loadStoredState(hash).roundPoolIds!].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);

    // 中途关掉开关：设置落盘，但这一轮这一批还在（这一轮照旧按这一批走）
    session.updateMemorySettings({ lockRoundPool: false });
    expect(loadStoredState(hash).memory?.settings.lockRoundPool).toBe(false);
    expect([...loadStoredState(hash).roundPoolIds!].sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("旧进度净化：没写过这个字段就是关，只认真正的 true", () => {
    expect(
      sanitizeMemorySettings({ graduateLevel: 5 }).lockRoundPool,
    ).toBe(false);
    expect(
      sanitizeMemorySettings({ graduateLevel: 5, lockRoundPool: "yes" })
        .lockRoundPool,
    ).toBe(false);
    expect(
      sanitizeMemorySettings({ graduateLevel: 5, lockRoundPool: true })
        .lockRoundPool,
    ).toBe(true);
  });

  it("导入进度后本轮计数与这一批一起归零（备份里不带「本轮」状态）", async () => {
    const hash = "memory_locked_import_hash";
    const session = startLocked(["a", "b", "c", "d", "e", "f"], 3, { hash });
    expect(session.appState.roundPoolIds?.length).toBe(3);

    // 走真实路径：导出写进假剪贴板（mock 的 writeText 会存下来），再导入回来
    const ids = ["a", "b", "c", "d", "e", "f"];
    await session.exportProgress();
    await session.startImport();
    await session.commitImport();

    expect(session.roundMastered).toBe(0);
    expect(session.roundGoal).toBe(0);
    // 下一轮开轮时才重新挑，导入后不该留着上一轮那份
    expect(session.appState.roundPoolIds).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. 复习流
// ---------------------------------------------------------------------------

describe("记忆模式：复习流", () => {
  it("答对一次即过：推进间隔", () => {
    const hash = "memory_review_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: createReviewProgress(BASE_TIME) },
        settings: createDefaultMemorySettings(),
      },
    });

    // 「今天」= 次日 06:00（一天从凌晨 5 点开始算，所以 00:01 还算前一天）
    const now = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;
    const session = makeSession(["a"], { hash, now });
    expect(session.dueCount).toBe(1);

    session.startReview();
    expect(session.run).toBe("reviewing");
    answer(session, true);

    expect(session.progress.a.level).toBe(2);
    expect(session.progress.a.nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 1 + 2),
    );
  });

  it("复习答错：阶梯归零、本轮要连对 N 次才算复习完", () => {
    const hash = "memory_fail_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: { ...createReviewProgress(BASE_TIME), level: 4 } },
        settings: createDefaultMemorySettings(),
      },
    });

    // 「今天」= 次日 06:00（一天从凌晨 5 点开始算，所以 00:01 还算前一天）
    const now = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;
    const session = makeSession(["a"], { hash, now });
    session.startReview();
    expect(session.progress.a.level).toBe(4);

    // 答错：掌握阶梯归零（明天从 1 天重来），本轮目标变成 N=3
    answer(session, false);
    expect(session.progress.a.level).toBe(1);
    expect(session.progress.a.lapses).toBe(1);
    expect(session.progress.a.nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 2),
    );
    expect(session.run).toBe("reviewing");
    expect(session.requiredStreak).toBe(3);

    // 连对 2 次还没完成，卡片继续出现
    answer(session, true);
    expect(session.progress.a.streak).toBe(1);
    expect(session.run).toBe("reviewing");
    answer(session, true);
    expect(session.progress.a.streak).toBe(2);
    expect(session.run).toBe("reviewing");

    // 第 3 次连对 = 本轮复习完成；但本轮失败过，所以**不推进掌握阶梯**：
    // 阶梯停在第 1 级，下次复习仍然是「明天」（BASE_TIME + 2 天）
    answer(session, true);
    expect(session.run).toBe("idle");
    expect(session.progress.a.level).toBe(1);
    expect(session.progress.a.nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 2),
    );
  });

  it("复习答错：第二天就到期（不是两天），阶梯停在第 1 级", () => {
    const hash = "memory_fail_interval_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: createReviewProgress(BASE_TIME) }, // level 1，今天（BASE+1）到期
        settings: createDefaultMemorySettings(),
      },
    });

    // 「今天」= 次日 06:00（一天从凌晨 5 点开始算，所以 00:01 还算前一天）
    const now = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;
    const session = makeSession(["a"], { hash, now });
    session.startReview();

    // 答错：阶梯归零 + 明天到期
    session.selectedAnswers = [0];
    session.submit();
    flushSync();
    expect(session.progress.a.level).toBe(1);
    expect(session.progress.a.nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 2),
    );

    // 本轮再连对 3 次「复习完成」——但本轮失败过，阶梯不许被推进
    session.advanceQuestionFlow();
    flushSync();
    for (let i = 0; i < 3; i++) answer(session, true);

    expect(session.run).toBe("idle");
    expect(session.progress.a.level).toBe(1);
    expect(session.progress.a.streak).toBe(0);
    // 关键断言：下次复习是「明天」（BASE+2），而不是被推成 BASE+3
    expect(session.progress.a.nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 2),
    );
  });

  it("复习答错后连对完成本轮：进度条把这道算成已复习", () => {
    const hash = "memory_fail_progress_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {
          a: createReviewProgress(BASE_TIME),
          b: createReviewProgress(BASE_TIME),
        },
        settings: createDefaultMemorySettings(),
      },
    });

    // 「今天」= 次日 06:00（一天从凌晨 5 点开始算，所以 00:01 还算前一天）
    const now = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;
    const session = makeSession(["a", "b"], { hash, now });
    session.startReview();
    expect(session.reviewTotal).toBe(2);

    // 第一道答错 → 应当立即记为「今天已处理」
    session.selectedAnswers = [0];
    session.submit();
    flushSync();
    const failedId = session.currentQuestion!.id;
    expect(session.reviewDoneCount).toBe(1);
    session.advanceQuestionFlow();
    flushSync();
    // 答错的卡在本轮还会再出现，直到连对 N 次
    while (session.run === "reviewing" && session.currentQuestion) {
      answer(session, true);
    }
    expect(session.reviewDoneCount).toBeGreaterThanOrEqual(1);
    expect(session.progress[failedId].nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 2),
    );
  });

  it("复习中途再答错：连对清零，重新需要连对 N 次", () => {
    const hash = "memory_fail_again_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: createReviewProgress(BASE_TIME) },
        settings: createDefaultMemorySettings(),
      },
    });
    // 「今天」= 次日 06:00（一天从凌晨 5 点开始算，所以 00:01 还算前一天）
    const now = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;
    const session = makeSession(["a"], { hash, now });
    session.startReview();

    answer(session, false);
    answer(session, true);
    answer(session, true);
    expect(session.progress.a.streak).toBe(2);

    // 第 3 次答错 → 连对清零，重新从 0 开始数
    answer(session, false);
    expect(session.progress.a.streak).toBe(0);
    expect(session.progress.a.level).toBe(1);

    for (let i = 0; i < 3; i++) {
      expect(session.run).toBe("reviewing");
      answer(session, true);
    }
    expect(session.run).toBe("idle");
    // 本轮失败过 → 阶梯停在第 1 级（明天重来），不再往上推
    expect(session.progress.a.level).toBe(1);
    expect(session.progress.a.nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 2),
    );
  });

  it("到期题全部进入本轮，顺序随机（不再按逾期排序）", () => {
    const hash = "memory_order_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {
          a: { ...createReviewProgress(BASE_TIME), nextDue: addDays(BASE_TIME, -1) },
          b: { ...createReviewProgress(BASE_TIME), nextDue: addDays(BASE_TIME, -9) },
          c: { ...createReviewProgress(BASE_TIME), nextDue: addDays(BASE_TIME, -4) },
        },
        settings: createDefaultMemorySettings(),
      },
    });

    const session = makeSession(["a", "b", "c"], { hash, now: BASE_TIME });
    session.startReview();

    const seen: string[] = [];
    while (session.run === "reviewing" && session.currentQuestion) {
      seen.push(session.currentQuestion.id);
      answer(session, true);
    }
    // 三道都复习到了，顺序不做断言（本轮内部随机）
    expect([...seen].sort()).toEqual(["a", "b", "c"]);
  });

  it("没有到期的题时不进入答题流", () => {
    const session = makeSession(["a"]);
    session.startReview();
    expect(session.run).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// 5. 持久化
// ---------------------------------------------------------------------------

describe("记忆模式：持久化", () => {
  it("进度写进同一个 quiz_app_state_<hash> 键，刷新后可读回", () => {
    const hash = "memory_persist_hash";
    const session = makeSession(["a", "b"], { hash });
    session.startLearning();
    const answeredId = session.currentQuestion!.id;
    answer(session, true);

    const stored = loadStoredState(hash);
    expect(stored.memory?.progress[answeredId]?.state).toBe("learning");
    expect(stored.memory?.progress[answeredId]?.streak).toBe(1);

    const reloaded = makeSession(["a", "b"], { hash });
    expect(reloaded.progress[answeredId]?.streak).toBe(1);
    expect(reloaded.newCount).toBe(1);
  });

  it("重置进度会清空记忆段但保留设置", () => {
    const hash = "memory_reset_hash";
    const session = makeSession(["a"], { hash });
    session.updateMemorySettings({ roundTarget: 7 });
    session.startLearning();
    answer(session, true);

    session.reset();
    expect(session.progress).toEqual({});
    expect(session.memorySettings.roundTarget).toBe(7);
  });

  it("「时间修改」加一天后，session.now 与到期判断都跟着走", () => {
    const hash = "memory_dev_clock_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: createReviewProgress(BASE_TIME) },
        settings: createDefaultMemorySettings(),
      },
    });

    // 不传 options.now：走生产路径（每次现算 Date.now + 调试偏移）
    const session = new MemorySession(
      makeBank(["a"], hash),
      { flash: () => {}, toast: () => {}, sound: {} as never },
      globalSettingsStore,
    );
    const before = session.now;
    session.debugAddDay();
    expect(session.debugDayOffset).toBe(1);
    // 加一天之后 now 立刻往后走一天，不需要重建会话
    expect(session.now - before).toBeGreaterThanOrEqual(86_400_000 - 1000);

    // 回到第 0 天：now 退回原处
    session.debugResetDays();
    expect(session.now - before).toBeLessThan(1000);
  });

  it("学到一半退出：本轮进度与活动池都能续上", () => {
    const hash = "memory_resume_hash";
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();

    // 练会一道卡（它要在本轮里连对 3 次，中间会穿插别的卡）
    const masteredId = session.currentQuestion!.id;
    let guard = 0;
    while (
      session.progress[masteredId]?.state !== "reviewing" &&
      session.run === "learning" &&
      guard++ < 30
    ) {
      answer(session, true);
    }
    expect(session.progress[masteredId].state).toBe("reviewing");
    expect(session.roundMastered).toBe(1);

    const poolBefore = session.appState.activePool.map((i) => i.id);
    expect(poolBefore).toHaveLength(5);

    // 中途退出
    session.exitSession();

    const resumed = makeSession(ids, { hash });
    expect(resumed.roundMastered).toBe(1);
    expect(resumed.appState.activePool.map((i) => i.id).sort()).toEqual(
      [...poolBefore].sort(),
    );

    // 再点「学习新的题目」接着这一轮继续，不重新开始
    resumed.startLearning();
    expect(resumed.run).toBe("learning");
    expect(resumed.roundMastered).toBe(1);
    expect(resumed.appState.activePool.length).toBe(5);
  });

  it("学到一半但一道都没掌握就退出：下次接着这一轮继续，不重挑题", () => {
    const hash = "memory_resume_zero_hash";
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();

    // 只答对一次（连对 1 / 3，离学会还远，本轮已掌握 0 道）
    const partialId = session.currentQuestion!.id;
    answer(session, true);
    expect(session.roundMastered).toBe(0);
    expect(session.progress[partialId].streak).toBe(1);

    const poolBefore = session.appState.activePool.map((i) => i.id);
    session.exitSession();

    const resumed = makeSession(ids, { hash });
    expect(resumed.roundMastered).toBe(0);
    expect(resumed.hasOngoingRound).toBe(true);
    expect(resumed.appState.activePool.map((i) => i.id).sort()).toEqual(
      [...poolBefore].sort(),
    );

    // 续轮：还是那一池题，连对次数也接着数
    resumed.startLearning();
    expect(resumed.run).toBe("learning");
    expect(resumed.roundGoal).toBe(5);
    expect(resumed.appState.activePool.map((i) => i.id).sort()).toEqual(
      [...poolBefore].sort(),
    );
    expect(
      resumed.appState.activePool.find((i) => i.id === partialId)
        ?.consecutiveCorrect,
    ).toBe(1);
    expect(resumed.progress[partialId].streak).toBe(1);
  });

  it("学到一半的卡掉在池子外（旧版半轮被重置）：还能被收回池子接着学", () => {
    const hash = "memory_orphan_hash";
    const ids = ["a", "b", "c", "d", "e", "f"];
    saveState(hash, {
      ...emptyState(),
      activePool: [],
      roundMastered: 0,
      roundGoal: 0,
      memory: {
        progress: { a: createLearningProgress(2) },
        settings: createDefaultMemorySettings(),
      },
    });

    const session = makeSession(ids, { hash });
    // 有 learning 进度的卡既不是「未学习」也不能永远学不到，要算成「还有得学」
    expect(session.newCount).toBe(5);
    expect(session.learnableCount).toBe(6);

    // 用「顺序」挑入池，好让断言确定（随机模式下这道孤儿卡可能这一批没被抽中）
    session.updateBankSettings({ selectionMode: "sequential" });
    session.startLearning();
    expect(session.run).toBe("learning");
    const item = session.appState.activePool.find((i) => i.id === "a");
    expect(item).toBeDefined();
    // 连对次数接着之前的 2 次数，不从 0 开始
    expect(item?.consecutiveCorrect).toBe(2);

    // 再答对一次就够 3 次 → 学出来
    let guard = 0;
    while (
      session.progress.a?.state !== "reviewing" &&
      session.run === "learning" &&
      guard++ < 40
    ) {
      answer(session, true);
    }
    expect(session.progress.a.state).toBe("reviewing");
  });

  it("复习留下的到期队列不会被当成学习池", () => {
    const hash = "memory_review_queue_hash";
    const ids = ["a", "b", "c", "d", "e"];
    saveState(hash, {
      ...emptyState(),
      // 上一轮学到一半（已掌握 2 道），中途去复习了一趟：
      // activePool 里现在是到期队列，不是学习池
      activePool: [
        {
          id: "a",
          consecutiveCorrect: 0,
          hasEverMistaken: false,
          hasBeenShown: false,
          lastSelectedRound: 0,
        },
        {
          id: "b",
          consecutiveCorrect: 0,
          hasEverMistaken: false,
          hasBeenShown: false,
          lastSelectedRound: 0,
        },
      ],
      roundMastered: 2,
      roundGoal: 5,
      memory: {
        progress: {
          a: createReviewProgress(BASE_TIME),
          b: createReviewProgress(BASE_TIME),
        },
        settings: createDefaultMemorySettings(),
      },
    });

    const session = makeSession(ids, { hash });
    expect(session.hasOngoingRound).toBe(false);

    session.startLearning();
    expect(session.run).toBe("learning");
    // 到期队列里的卡不进这一轮
    expect(session.appState.activePool.some((i) => i.id === "a")).toBe(false);
    expect(session.appState.activePool.some((i) => i.id === "b")).toBe(false);
    // 池子虽然被复习顶掉过，但这一轮的计数还在，接着数
    expect(session.roundMastered).toBe(2);
    expect(session.roundGoal).toBe(5);
  });

  it("学到一半去复习：学习池的成员与顺序都原样保住（含中途刷新）", () => {
    const hash = "memory_pool_stash_hash";
    const ids = ["z", "a", "b", "c", "d", "e", "f", "g", "h"];
    saveState(hash, {
      ...emptyState(),
      memory: {
        // z 今天到期，其余都还没学过
        progress: {
          z: {
            ...createReviewProgress(BASE_TIME),
            nextDue: startOfDay(BASE_TIME),
          },
        },
        settings: createDefaultMemorySettings(),
      },
    });

    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();
    // 顺序挑题 → 池子正好是题库里前 5 道没学过的卡（不含 z）
    const poolBefore = session.appState.activePool.map((i) => i.id);
    expect(poolBefore).toEqual(["a", "b", "c", "d", "e"]);
    // 答对一次（一道都没掌握），池子里留下连对进度
    answer(session, true);
    session.exitSession();
    expect(session.appState.activePool.map((i) => i.id)).toEqual(poolBefore);

    // 去复习：activePool 被换成到期队列，学习池原样挪进 learningPool
    session.startReview();
    expect(session.appState.activePool.map((i) => i.id)).toEqual(["z"]);
    expect(session.appState.learningPool?.map((i) => i.id)).toEqual(poolBefore);

    // 复习到一半刷新页面：复习队列和学习池都在盘上
    const resumed = makeSession(ids, { hash });
    expect(resumed.appState.learningPool?.map((i) => i.id)).toEqual(poolBefore);

    // 回来学习 → 池子与去复习之前一模一样，顺序也没变
    resumed.startLearning();
    expect(resumed.run).toBe("learning");
    expect(resumed.appState.activePool.map((i) => i.id)).toEqual(poolBefore);
    expect(resumed.appState.learningPool).toBeUndefined();
  });

  it("复习到一半退出：已复习的题当天不再出现，剩下的还能继续复习", () => {
    const hash = "memory_review_resume_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {
          a: createReviewProgress(BASE_TIME),
          b: createReviewProgress(BASE_TIME),
          c: createReviewProgress(BASE_TIME),
        },
        settings: createDefaultMemorySettings(),
      },
    });

    // 「今天」= 次日 06:00（一天从凌晨 5 点开始算，所以 00:01 还算前一天）
    const now = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;
    const session = makeSession(["a", "b", "c"], { hash, now });
    session.startReview();
    expect(session.reviewTotal).toBe(3);

    // 只复习一题就退出
    answer(session, true);
    expect(session.reviewDoneCount).toBe(1);
    session.exitSession();

    // 再进来：剩下的 2 题仍在到期列表里，已过的那题不会重复出现
    const resumed = makeSession(["a", "b", "c"], { hash, now });
    expect(resumed.dueCount).toBe(2);
    resumed.startReview();
    expect(resumed.reviewTotal).toBe(2);
    expect(resumed.currentQuestion).toBeTruthy();
  });

  it("重置进度会把调试用的时间偏移一起清零", () => {
    const hash = "memory_reset_clock_hash";
    const session = makeSession(["a"], { hash });
    session.debugAddDay();
    session.debugAddDay();
    expect(session.debugDayOffset).toBe(2);

    session.reset();
    expect(session.debugDayOffset).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. 本轮状态：计数归零、答错后的连对要求、落盘时机
// ---------------------------------------------------------------------------

describe("记忆模式：本轮计数与重置 / 导入", () => {
  it("重置进度会把本轮计数一起清零（否则下一轮会带着旧计数提前结束）", () => {
    const hash = "memory_reset_round_hash";
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();

    // 先在本轮里掌握一道
    const firstId = session.currentQuestion!.id;
    let guard = 0;
    while (
      session.progress[firstId]?.state !== "reviewing" &&
      session.run === "learning" &&
      guard++ < 40
    ) {
      answer(session, true);
    }
    expect(session.roundMastered).toBe(1);
    expect(session.roundGoal).toBe(5);
    expect(loadStoredState(hash).roundMastered).toBe(1);

    session.reset();

    // 内存与盘上的本轮计数都要归零
    expect(session.roundMastered).toBe(0);
    expect(session.roundGoal).toBe(0);
    expect(loadStoredState(hash).roundMastered).toBe(0);
    expect(loadStoredState(hash).roundGoal).toBe(0);

    // 新的一轮从 0 开始，进度条不会显示上一次的 1/5
    session.startLearning();
    expect(session.run).toBe("learning");
    expect(session.roundMastered).toBe(0);
    expect(session.roundGoal).toBe(5);
    expect(session.roundCompletedCount).toBe(0);
  });

  it("导入进度后本轮计数归零（备份里不带「本轮」状态）", async () => {
    const hash = "memory_import_round_hash";
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];

    // 造一份备份：a 已经进入复习中
    clipboard.text = await exportProgress(
      {
        ...emptyState(),
        memory: {
          progress: { a: createReviewProgress(BASE_TIME) },
          settings: createDefaultMemorySettings(),
        },
      },
      hash,
      ids.map(mq),
    );

    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();
    const firstId = session.currentQuestion!.id;
    let guard = 0;
    while (
      session.progress[firstId]?.state !== "reviewing" &&
      session.run === "learning" &&
      guard++ < 40
    ) {
      answer(session, true);
    }
    expect(session.roundMastered).toBe(1);

    // 导入是两步：startImport 只负责读剪贴板并挂起确认，commitImport 才落盘
    await session.startImport();
    expect(session.importConfirmText).not.toBeNull();
    await session.commitImport();

    expect(session.progress.a?.state).toBe("reviewing");
    expect(session.roundMastered).toBe(0);
    expect(session.roundGoal).toBe(0);
    expect(loadStoredState(hash).roundMastered).toBe(0);
    expect(loadStoredState(hash).roundGoal).toBe(0);

    // 再开一轮也是从 0 开始
    session.startLearning();
    expect(session.roundMastered).toBe(0);
    expect(session.roundGoal).toBe(5);
  });
});

describe("记忆模式：答错后的「重新连对」跨会话", () => {
  /** 「今天」= BASE_TIME 的次日 06:00（一天从凌晨 5 点开始算） */
  const dayAfterBase = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;

  function saveDueCard(hash: string, ids: string[]): void {
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: Object.fromEntries(
          ids.map((id) => [id, createReviewProgress(BASE_TIME)]),
        ),
        settings: createDefaultMemorySettings(),
      },
    });
  }

  it("答错后退出再进来：这道卡仍在本轮，必须补完连对 N 次", () => {
    const hash = "memory_retry_resume_hash";
    saveDueCard(hash, ["a"]);

    const session = makeSession(["a"], { hash, now: dayAfterBase });
    session.startReview();
    answer(session, false);

    // 待办同时落盘：这一步退出后不会丢
    expect(session.progress.a.level).toBe(1);
    expect(session.progress.a.nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 2),
    );
    const stored = loadStoredState(hash);
    expect(stored.memory?.retry?.day).toBe(studyDay(dayAfterBase));
    expect(stored.memory?.retry?.targets.a).toBe(3);

    answer(session, true);
    expect(session.progress.a.streak).toBe(1);
    session.exitSession();

    // 重新进来：卡片已经不在「到期」里，但今天还没补完
    const resumed = makeSession(["a"], { hash, now: dayAfterBase });
    expect(resumed.dueCount).toBe(0);
    expect(resumed.pendingRetryCount).toBe(1);
    expect(resumed.reviewableCount).toBe(1);

    resumed.startReview();
    expect(resumed.run).toBe("reviewing");
    expect(resumed.reviewTotal).toBe(1);
    expect(resumed.requiredStreak).toBe(3);

    // 轮内连对不跨会话，从 0 重新数
    answer(resumed, true);
    expect(resumed.progress.a.streak).toBe(1);
    expect(resumed.run).toBe("reviewing");
    answer(resumed, true);
    expect(resumed.run).toBe("reviewing");
    answer(resumed, true);
    expect(resumed.run).toBe("idle");

    // 本轮失败过 → 阶梯不推进，仍是明天 1 天后再来
    expect(resumed.progress.a.level).toBe(1);
    expect(resumed.progress.a.nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 2),
    );
    // 待办清空，明天不会再被拉回本轮
    expect(loadStoredState(hash).memory?.retry).toBeUndefined();
  });

  it("跨到下一个学习日后作废：卡片按「到期」处理，答对一次即过", () => {
    const hash = "memory_retry_expired_hash";
    saveDueCard(hash, ["a"]);

    const first = makeSession(["a"], { hash, now: dayAfterBase });
    first.startReview();
    answer(first, false);
    expect(loadStoredState(hash).memory?.retry?.targets.a).toBe(3);
    first.exitSession();

    // 第二天：卡片今天到期，昨天的「连对 3 次」要求已经作废
    const nextDay = addDays(startOfDay(BASE_TIME), 2) + 6 * 60 * 60_000;
    const second = makeSession(["a"], { hash, now: nextDay });
    expect(second.dueCount).toBe(1);
    expect(second.pendingRetryCount).toBe(0);

    second.startReview();
    expect(second.requiredStreak).toBe(1);
    answer(second, true);
    expect(second.run).toBe("idle");
    // 本轮没失败过 → 正常推进一级
    expect(second.progress.a.level).toBe(2);
  });

  it("答错后重新进来又答错：连对重新从 0 数，待办覆盖为 N", () => {
    const hash = "memory_retry_again_hash";
    saveDueCard(hash, ["a"]);

    const session = makeSession(["a"], { hash, now: dayAfterBase });
    session.startReview();
    answer(session, false);
    session.exitSession();

    const resumed = makeSession(["a"], { hash, now: dayAfterBase });
    resumed.startReview();
    answer(resumed, true);
    expect(resumed.progress.a.streak).toBe(1);

    answer(resumed, false);
    expect(resumed.progress.a.streak).toBe(0);
    expect(resumed.requiredStreak).toBe(3);
    expect(loadStoredState(hash).memory?.retry?.targets.a).toBe(3);
  });
});

describe("记忆模式：本轮收尾", () => {
  it("题库比本轮目标少：不谎报成功，并记下「今天已经学习完」", () => {
    const hash = "memory_exhausted_round_hash";
    const toasts: { title: string; variant?: string }[] = [];
    const session = makeSession(["a", "b"], {
      hash,
      toast: (title, _description, variant) => toasts.push({ title, variant }),
    });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();

    let guard = 0;
    while (
      session.run === "learning" &&
      session.currentQuestion &&
      guard++ < 40
    ) {
      answer(session, true);
    }

    // 两道都学会了，但离目标 5 道还差得远
    expect(session.run).toBe("idle");
    expect(session.roundMastered).toBe(0);
    expect(session.roundGoal).toBe(0);
    expect(session.newCount).toBe(0);
    // 首页靠它把「学习」按钮降一档颜色（今天学过一轮了），并且要落盘
    expect(session.learnedToday).toBe(true);
    expect(loadStoredState(hash).memory?.learnedDay).toBe(studyDay(BASE_TIME));

    const finish = toasts.find((t) => t.title === "这一轮学完了");
    expect(finish).toBeTruthy();
    expect(finish?.variant).toBeUndefined();
    expect(toasts.some((t) => t.title === "本轮学习完成")).toBe(false);
  });

  it("学满本轮目标：仍然是成功提示", () => {
    const hash = "memory_goal_round_hash";
    const toasts: { title: string; variant?: string }[] = [];
    const session = makeSession(["a", "b", "c", "d", "e"], {
      hash,
      toast: (title, _description, variant) => toasts.push({ title, variant }),
    });
    session.updateMemorySettings({ roundTarget: 2 });
    session.startLearning();

    let guard = 0;
    while (
      session.run === "learning" &&
      session.currentQuestion &&
      guard++ < 40
    ) {
      answer(session, true);
    }

    expect(session.newCount).toBeGreaterThan(0);
    const finish = toasts.find((t) => t.title === "本轮学习完成");
    expect(finish?.variant).toBe("success");
    expect(toasts.some((t) => t.title === "这一轮学完了")).toBe(false);
  });
});

describe("记忆模式：已掌握卡的不变量", () => {
  it("走完阈值：level / streak / nextDue 一起清零", () => {
    const progress = advanceReview(
      { ...createReviewProgress(BASE_TIME), level: 7 },
      7,
      BASE_TIME,
    );
    expect(progress.state).toBe("mastered");
    expect(progress.level).toBe(0);
    expect(progress.streak).toBe(0);
    expect(progress.nextDue).toBe(0);
  });

  it("净化把已掌握卡残留的 level / nextDue 也清掉", () => {
    expect(
      normalizeMemoryProgress({
        state: "mastered",
        level: 7,
        streak: 2,
        nextDue: 123,
        lapses: 4,
      }),
    ).toEqual({ state: "mastered", level: 0, streak: 0, nextDue: 0, lapses: 4 });
  });

  it("离谱的 nextDue（超出 Date 上界）会被净化掉，避免「NaN 天后复习」", () => {
    expect(
      normalizeMemoryProgress({
        state: "reviewing",
        level: 2,
        streak: 0,
        nextDue: 1e30,
        lapses: 0,
      })?.nextDue,
    ).toBe(0);
  });
});

describe("记忆模式：masteredIds 与 progress 同步", () => {
  const mastered = {
    state: "mastered" as const,
    level: 0,
    streak: 0,
    nextDue: 0,
    lapses: 3,
  };

  it("载入时就同步（老数据里 masteredIds 可能是空的）", () => {
    const hash = "memory_mastered_sync_load_hash";
    saveState(hash, {
      ...emptyState(),
      masteredIds: [],
      memory: {
        progress: { a: mastered, b: createReviewProgress(BASE_TIME) },
        settings: createDefaultMemorySettings(),
      },
    });

    const session = makeSession(["a", "b"], { hash });
    expect(session.masteredCount).toBe(1);
    expect(session.appState.masteredIds).toEqual(["a"]);
  });

  it("导入进度后同步，并落盘（导出文件名数它）", async () => {
    const hash = "memory_mastered_sync_import_hash";
    const ids = ["a", "b"];
    clipboard.text = await exportProgress(
      {
        ...emptyState(),
        memory: {
          progress: { a: mastered, b: createReviewProgress(BASE_TIME) },
          settings: createDefaultMemorySettings(),
        },
      },
      hash,
      ids.map(mq),
    );

    const session = makeSession(ids, { hash });
    expect(session.masteredCount).toBe(0);

    // 导入是两步：startImport 只负责读剪贴板并挂起确认，commitImport 才落盘
    await session.startImport();
    expect(session.importConfirmText).not.toBeNull();
    await session.commitImport();

    expect(session.masteredCount).toBe(1);
    expect(session.appState.masteredIds).toEqual(["a"]);
    expect(loadStoredState(hash).masteredIds).toEqual(["a"]);
  });
});

describe("记忆模式：进度变更的落盘时机", () => {
  it("复习答对后「下一题」即落盘：刷新不会退回上一级", () => {
    const hash = "memory_advance_persist_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {
          a: createReviewProgress(BASE_TIME),
          b: createReviewProgress(BASE_TIME),
        },
        settings: createDefaultMemorySettings(),
      },
    });

    const now = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;
    const session = makeSession(["a", "b"], { hash, now });
    session.startReview();
    const answeredId = session.currentQuestion!.id;

    session.selectedAnswers = [1];
    session.submit();
    flushSync();
    // 这里刻意不用 answer()：要断言的就是 advanceQuestionFlow 之后、
    // 还没发生下一次 submit 时盘上的状态。池子里还有另一道，所以本轮不会
    // 结束（结束时的 save 会掩盖这个问题）
    session.advanceQuestionFlow();
    flushSync();
    expect(session.run).toBe("reviewing");

    const stored = loadStoredState(hash);
    expect(stored.memory?.progress[answeredId].level).toBe(2);
    expect(stored.memory?.progress[answeredId].nextDue).toBe(
      addDays(startOfDay(BASE_TIME), 3),
    );
  });

  it("学习轮掌握一道后立即落盘本轮计数", () => {
    const hash = "memory_learning_persist_hash";
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();

    const firstId = session.currentQuestion!.id;
    let guard = 0;
    while (
      session.progress[firstId]?.state !== "reviewing" &&
      session.run === "learning" &&
      guard++ < 40
    ) {
      answer(session, true);
    }

    expect(session.roundMastered).toBe(1);
    expect(loadStoredState(hash).roundMastered).toBe(1);
    expect(loadStoredState(hash).activePool.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 7. 净化
// ---------------------------------------------------------------------------

describe("记忆模式：净化", () => {
  it("合法进度能往返，非法结构被拒绝", () => {
    const raw = {
      state: "reviewing" as const,
      level: 3,
      streak: 0,
      nextDue: 123,
      lapses: 2,
    };
    expect(normalizeMemoryProgress(raw)).toEqual(raw);
    expect(normalizeMemoryProgress(null)).toBeNull();
    expect(
      normalizeMemoryProgress({ state: "learning", streak: 2, nextDue: 999 }),
    ).toEqual({ state: "learning", level: 0, streak: 2, nextDue: 0, lapses: 0 });
  });

  it("设置净化把越界值钳到边界", () => {
    expect(sanitizeMemorySettings({ graduateLevel: -2 })).toMatchObject({
      graduateLevel: 3,
    });
    expect(sanitizeMemorySettings({ graduateLevel: 99 })).toMatchObject({
      graduateLevel: 10,
    });
    expect(sanitizeMemorySettings(undefined)).toEqual(
      createDefaultMemorySettings(),
    );
  });
});

// 保证 MemoryProgressMap 类型被用到（避免 lint 报未使用）
export type _MemoryProgressMap = MemoryProgressMap;

describe("记忆模式：今天是否学过一轮（首页学习按钮的配色依据）", () => {
  it("学完一轮 → learnedToday 为真并落盘；中途退出不算", () => {
    const hash = "memory_learned_day_hash";
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 2 });
    session.startLearning();

    // 学到一半退出：这一轮还没学完，按钮不该降色
    answer(session, true);
    session.exitSession();
    expect(session.learnedToday).toBe(false);
    expect(loadStoredState(hash).memory?.learnedDay).toBeUndefined();

    // 学满这一轮（roundTarget = 2）
    session.startLearning();
    let guard = 0;
    while (
      session.run === "learning" &&
      session.currentQuestion &&
      guard++ < 40
    ) {
      answer(session, true);
    }
    expect(session.roundMastered).toBe(0);
    expect(session.newCount).toBeGreaterThan(0);

    expect(session.learnedToday).toBe(true);
    expect(loadStoredState(hash).memory?.learnedDay).toBe(studyDay(BASE_TIME));
  });

  it("昨天的学习日不算今天（跨过凌晨 5 点自然失效）", () => {
    const hash = "memory_learned_day_stale_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {},
        settings: createDefaultMemorySettings(),
        learnedDay: addDays(studyDay(BASE_TIME), -1),
      },
    });

    const session = makeSession(["a", "b"], { hash });
    expect(session.learnedToday).toBe(false);
  });

  it("改设置 / 复习答对都不会把 learnedDay 抹掉", () => {
    const hash = "memory_learned_day_keep_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        // 今天到期，方便验证「复习一遍也不会把 learnedDay 抹掉」
        progress: {
          a: { ...createReviewProgress(BASE_TIME), nextDue: startOfDay(BASE_TIME) },
        },
        settings: createDefaultMemorySettings(),
        learnedDay: studyDay(BASE_TIME),
      },
    });

    const session = makeSession(["a", "b"], { hash });
    expect(session.learnedToday).toBe(true);

    session.updateMemorySettings({ roundTarget: 7 });
    session.updateBankSettings({ correctStreakToMaster: 4 });
    expect(session.learnedToday).toBe(true);

    session.startReview();
    answer(session, true);
    expect(session.learnedToday).toBe(true);
    expect(loadStoredState(hash).memory?.learnedDay).toBe(studyDay(BASE_TIME));
  });
});

// ---------------------------------------------------------------------------
// 7. 「模糊」：轮内连对不变、复习阶梯退一级
// ---------------------------------------------------------------------------

describe("记忆模式：模糊", () => {
  it("学习流：模糊既不加连对也不清零，够次数前学不出来", () => {
    const session = makeSession(["a"]);
    session.startLearning();

    // 连对 2 次（N = 3）后来一次模糊：次数保持 2
    answerKind(session, "know");
    answerKind(session, "know");
    expect(session.progress.a.streak).toBe(2);

    answerKind(session, "fuzzy");
    expect(session.progress.a.state).toBe("learning");
    expect(session.progress.a.streak).toBe(2);
    expect(session.progress.a.lapses).toBe(0);
    expect(session.run).toBe("learning");

    // 再连对一次才到 3 → 毕业
    answerKind(session, "know");
    expect(session.progress.a.state).toBe("reviewing");
    expect(session.progress.a.level).toBe(1);
  });

  it("学习流：模糊不清零已有的连对（对照「忘记」）", () => {
    const session = makeSession(["a"]);
    session.startLearning();
    answerKind(session, "know");
    expect(session.progress.a.streak).toBe(1);

    answerKind(session, "fuzzy");
    expect(session.progress.a.streak).toBe(1);

    answerKind(session, "forget");
    expect(session.progress.a.streak).toBe(0);
  });

  it("复习流：模糊让阶梯退一级（不清零），并按新阶梯安排下次复习", () => {
    const hash = "memory_fuzzy_level_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {
          a: { ...createReviewProgress(BASE_TIME), level: 4, nextDue: startOfDay(BASE_TIME) },
        },
        settings: createDefaultMemorySettings(),
      },
    });

    const session = makeSession(["a"], { hash, now: BASE_TIME });
    session.startReview();
    answerKind(session, "fuzzy");

    // 4 → 3；下次复习 = 今天 + 2^(3-1) = 4 天
    expect(session.progress.a.state).toBe("reviewing");
    expect(session.progress.a.level).toBe(3);
    expect(session.progress.a.nextDue).toBe(addDays(startOfDay(BASE_TIME), 4));
    // 模糊不算答错（lapses 不动）
    expect(session.progress.a.lapses).toBe(0);
  });

  it("复习流：第 1 级模糊仍停在第 1 级（明天再来）", () => {
    const hash = "memory_fuzzy_level1_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {
          a: { ...createReviewProgress(BASE_TIME), nextDue: startOfDay(BASE_TIME) },
        },
        settings: createDefaultMemorySettings(),
      },
    });

    const session = makeSession(["a"], { hash, now: BASE_TIME });
    session.startReview();
    answerKind(session, "fuzzy");

    expect(session.progress.a.level).toBe(1);
    expect(session.progress.a.nextDue).toBe(addDays(startOfDay(BASE_TIME), 1));
  });

  it("复习流：模糊后本轮要重新连对 N 次，且完成时不再推进阶梯", () => {
    const hash = "memory_fuzzy_round_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {
          a: { ...createReviewProgress(BASE_TIME), level: 4, nextDue: startOfDay(BASE_TIME) },
        },
        settings: createDefaultMemorySettings(),
      },
    });

    const session = makeSession(["a"], { hash, now: BASE_TIME });
    session.startReview();
    answerKind(session, "fuzzy");

    // 本轮目标提到 N=3：连对 2 次还不算复习完
    expect(session.requiredStreak).toBe(3);
    answerKind(session, "know");
    expect(session.progress.a.streak).toBe(1);
    expect(session.run).toBe("reviewing");
    answerKind(session, "know");
    expect(session.progress.a.streak).toBe(2);
    expect(session.run).toBe("reviewing");

    // 第 3 次连对 = 本轮复习完成；本轮降级过 → 阶梯不推进，仍是 level 3
    answerKind(session, "know");
    expect(session.run).toBe("idle");
    expect(session.progress.a.level).toBe(3);
    expect(session.progress.a.nextDue).toBe(addDays(startOfDay(BASE_TIME), 4));
    // 待办也清掉了
    expect(loadStoredState(hash).memory?.retry).toBeUndefined();
  });

  it("复习流：模糊也把这道计入「今日已复习」，并落盘本轮待办", () => {
    const hash = "memory_fuzzy_reviewed_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {
          a: { ...createReviewProgress(BASE_TIME), nextDue: startOfDay(BASE_TIME) },
        },
        settings: createDefaultMemorySettings(),
      },
    });

    const session = makeSession(["a"], { hash, now: BASE_TIME });
    session.startReview();
    answerKind(session, "fuzzy");

    expect(session.reviewDoneCount).toBe(1);
    const stored = loadStoredState(hash);
    expect(stored.memory?.retry?.targets.a).toBe(3);
  });

  it("答案页降级：知道 → 模糊 → 记错了，一步到位不叠加", () => {
    const session = makeSession(["a"]);
    session.startLearning();

    // 答「知道」
    session.selectedAnswers = [MEMORY_ANSWER_CODE.know];
    session.submit();
    flushSync();
    expect(session.answerKind).toBe("know");
    expect(session.progress.a.streak).toBe(1);
    expect(session.isCorrect).toBe(true);

    // 改判成模糊：连对回到提交前的 0，阶梯也不动（学习中本来就没有阶梯）
    session.markAsFuzzy();
    flushSync();
    expect(session.answerKind).toBe("fuzzy");
    expect(session.isCorrect).toBe(true);
    expect(session.progress.a.streak).toBe(0);
    expect(session.progress.a.lapses).toBe(0);

    // 再改判成记错了：只剩忘记的效果
    session.markAsWrong();
    flushSync();
    expect(session.answerKind).toBe("forget");
    expect(session.isCorrect).toBe(false);
    expect(session.progress.a.streak).toBe(0);
    expect(session.progress.a.lapses).toBe(1);
  });

  it("答案页降级：刚毕业的这道改判成模糊后要回到活动池（毕业被撤销）", () => {
    const hash = "memory_fuzzy_undo_graduate_hash";
    const session = makeSession(["a", "b"], { hash });
    session.updateBankSettings({ correctStreakToMaster: 3 });
    session.startLearning();

    const id = session.currentQuestion!.id;
    // 先把这道练到连对 2 次
    let guard = 0;
    while (
      (session.progress[id]?.streak ?? 0) < 2 &&
      session.run === "learning" &&
      guard++ < 30
    ) {
      answerKind(session, "know");
    }
    expect(session.progress[id].streak).toBe(2);
    expect(session.appState.activePool.some((i) => i.id === id)).toBe(true);

    // 下一次「知道」会当场毕业（离开 activePool、进入复习中）
    let guard2 = 0;
    while (session.currentQuestion?.id !== id && guard2++ < 30) {
      answerKind(session, "fuzzy");
    }
    session.selectedAnswers = [MEMORY_ANSWER_CODE.know];
    session.submit();
    flushSync();
    expect(session.progress[id].state).toBe("reviewing");
    expect(session.appState.activePool.some((i) => i.id === id)).toBe(false);

    // 改判成模糊：毕业被撤销，回到活动池继续学，连对退回 2
    session.markAsFuzzy();
    flushSync();
    expect(session.progress[id].state).toBe("learning");
    expect(session.progress[id].streak).toBe(2);
    expect(session.appState.activePool.some((i) => i.id === id)).toBe(true);
  });

  it("答案页降级：答「模糊」后不能再改判成模糊，但能记错了", () => {
    const session = makeSession(["a"]);
    session.startLearning();

    session.selectedAnswers = [MEMORY_ANSWER_CODE.fuzzy];
    session.submit();
    flushSync();
    expect(session.answerKind).toBe("fuzzy");

    session.markAsFuzzy();
    flushSync();
    expect(session.answerKind).toBe("fuzzy");

    session.markAsWrong();
    flushSync();
    expect(session.answerKind).toBe("forget");
    expect(session.progress.a.lapses).toBe(1);
  });
});

describe("答对自动下一题（全局设置）", () => {
  /** 每个用例一份独立 store：默认那个是内存单例，改它会影响别的用例 */
  function storeWith(autoNextOnCorrect: boolean): GlobalSettingsStore {
    const store = new GlobalSettingsStore();
    store.update({ autoNextOnCorrect });
    return store;
  }

  it("开启时自评「知道」直接进入下一题，不再停在答案页", () => {
    const session = makeSession(["a", "b"], {
      store: storeWith(true),
    });
    session.startLearning();
    const first = session.currentQuestion!.id;

    session.selectedAnswers = [MEMORY_ANSWER_CODE.know];
    session.submit();
    flushSync();

    expect(session.currentQuestion!.id, "没有自动进入下一题").not.toBe(first);
    expect(session.showResult, "新题的答案不该是翻开状态").toBe(false);
  });

  it("关闭时（默认）停在答案页，等用户点「下一题」", () => {
    const session = makeSession(["a", "b"], { store: storeWith(false) });
    session.startLearning();
    const first = session.currentQuestion!.id;

    session.selectedAnswers = [MEMORY_ANSWER_CODE.know];
    session.submit();
    flushSync();

    expect(session.showResult).toBe(true);
    expect(session.currentQuestion!.id).toBe(first);
  });

  it("自评「忘记」不算答对，即使开着也不跳", () => {
    const session = makeSession(["a", "b"], { store: storeWith(true) });
    session.startLearning();
    const first = session.currentQuestion!.id;

    session.selectedAnswers = [MEMORY_ANSWER_CODE.forget];
    session.submit();
    flushSync();

    expect(session.showResult).toBe(true);
    expect(session.currentQuestion!.id).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// 总览里的「标熟」与答题区的「结束本轮」：两个都在总览 / 容器那边触发，
// 但状态变迁全在会话层，所以在这里钉住不变量
// ---------------------------------------------------------------------------

/** 今天到期的一张复习卡（`createReviewProgress` 排的是明天，用不了） */
function dueCard(): MemoryProgressMap[string] {
  return { ...createReviewProgress(BASE_TIME), nextDue: startOfDay(BASE_TIME) };
}

describe("记忆模式：总览里「标熟」", () => {
  it("把学习中 / 复习中的卡直接标成已掌握：阶梯清零、lapses 保留、落盘", () => {
    const hash = "memory_master_question_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: {
          a: createLearningProgress(2, 5),
          b: createReviewProgress(BASE_TIME),
        },
        settings: createDefaultMemorySettings(),
      },
    });
    const session = makeSession(["a", "b"], { hash });

    session.masterQuestion("a");

    // 与 advanceReview 走完阶梯的终态同形：level / streak / nextDue 一起清零
    expect(session.progress.a).toEqual({
      state: "mastered",
      level: 0,
      streak: 0,
      nextDue: 0,
      lapses: 5,
    });
    expect(session.masteredCount).toBe(1);
    // masteredIds 是 progress 的投影，标熟后必须跟着同步（导出文件名会数它）
    expect(session.appState.masteredIds).toEqual(["a"]);
    // 落盘：刷新之后仍然是已掌握
    expect(loadStoredState(hash).memory?.progress.a.state).toBe("mastered");
    expect(loadStoredState(hash).masteredIds).toEqual(["a"]);
    // 已掌握是终态：两张卡里一张毕业、剩下那张还在复习
    expect(session.reviewingCount).toBe(1);
    expect(session.learningCount).toBe(0);
  });

  it("标熟的正好是当前这一题：它离开本轮队列，自动出下一题", () => {
    const hash = "memory_master_current_hash";
    const session = makeSession(["a", "b"], { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.startLearning();

    const first = session.currentQuestion!.id;
    const other = first === "a" ? "b" : "a";
    expect(session.appState.activePool.map((item) => item.id).sort()).toEqual([
      "a",
      "b",
    ]);

    session.masterQuestion(first);

    // 当前这一题不该留在屏幕上，也不该再留在活动池里
    expect(session.currentQuestion?.id).toBe(other);
    expect(session.appState.activePool.map((item) => item.id)).toEqual([other]);
    expect(session.run, "标熟当前题不等于结束本轮").toBe("learning");
  });

  it("复习轮里标熟：算作「今日已复习」，进度条的分母不悬着", () => {
    const hash = "memory_master_review_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: dueCard(), b: dueCard() },
        settings: createDefaultMemorySettings(),
      },
    });
    const session = makeSession(["a", "b"], { hash });
    session.startReview();
    expect(session.reviewTotal).toBe(2);

    session.masterQuestion("a");

    // 分母还是 2（这一轮本来要复习两道），已复习里补上被标熟的那一道
    expect(session.reviewTotal).toBe(2);
    expect(session.reviewDoneCount).toBe(1);
    expect(session.appState.activePool.map((item) => item.id)).toEqual(["b"]);
  });

  it("已掌握的卡再标一次是空操作；题库里没有的 id 也不动状态", () => {
    const hash = "memory_master_noop_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: createReviewProgress(BASE_TIME) },
        settings: createDefaultMemorySettings(),
      },
    });
    const session = makeSession(["a"], { hash });
    const before = session.appState;

    session.masterQuestion("a");
    const afterFirst = session.appState;
    session.masterQuestion("a");
    session.masterQuestion("nope");

    expect(afterFirst).toBe(session.appState);
    expect(session.appState).not.toBe(before);
    expect(session.appState.masteredIds).toEqual(["a"]);
  });

  it("「答错后重新连对」的待办跟着一起清掉（它已经毕业了）", () => {
    const hash = "memory_master_retry_hash";
    const dayAfterBase = addDays(startOfDay(BASE_TIME), 1) + 6 * 60 * 60_000;
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: createReviewProgress(BASE_TIME) },
        settings: createDefaultMemorySettings(),
        retry: { day: studyDay(dayAfterBase), targets: { a: 3 } },
      },
    });
    const session = makeSession(["a"], { hash, now: dayAfterBase });
    expect(session.pendingRetryCount).toBe(1);

    session.masterQuestion("a");

    expect(session.pendingRetryCount).toBe(0);
    expect(loadStoredState(hash).memory?.retry).toBeUndefined();
  });
});

describe("记忆模式：结束本轮（本轮作废并退出到首页）", () => {
  it("学习轮：本轮作废、回首页，计数与轮内连对一起清零并落盘", () => {
    const hash = "memory_end_round_hash";
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();

    // 在本轮里答对一次：轮内连对 1，但这张卡还没学会（N = 3）
    const answeredId = session.currentQuestion!.id;
    answer(session, true);
    expect(session.progress[answeredId]?.streak).toBe(1);
    expect(session.appState.activePool).toHaveLength(5);
    expect(session.roundGoal).toBe(5);

    session.endRound();

    // 和「退出本轮」一样回首页（不是留在答题区里重开一轮）
    expect(session.run).toBe("idle");
    expect(session.currentQuestion).toBeNull();
    expect(session.roundMastered).toBe(0);
    expect(session.roundGoal).toBe(0);
    // 池子与轮内连对一起作废：下次点「学习新的题目」是**新的一轮**
    expect(session.appState.activePool).toEqual([]);
    expect(session.hasOngoingRound).toBe(false);
    expect(
      Object.values(session.progress).every((item) => item.streak === 0),
    ).toBe(true);
    // 没学完的一轮不算「今天学过一轮」，首页学习入口该保持高亮
    expect(session.learnedToday).toBe(false);
    // 落盘
    expect(loadStoredState(hash).roundMastered).toBe(0);
    expect(loadStoredState(hash).activePool).toEqual([]);
  });

  it("下次点「学习新的题目」重新挑一批卡（不是接着上一轮）", () => {
    const hash = "memory_end_round_next_hash";
    const ids = ["a", "b", "c", "d", "e", "f"];
    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();

    const answeredId = session.currentQuestion!.id;
    answer(session, true);
    session.endRound();
    session.startLearning();

    expect(session.run).toBe("learning");
    expect(session.roundGoal).toBe(5);
    expect(session.roundCompletedCount).toBe(0);
    expect(session.appState.activePool).toHaveLength(5);
    // 上一轮那张卡的轮内连对不作数，池子里的条目也从 0 开始
    expect(session.progress[answeredId]?.streak).toBe(0);
    expect(
      session.appState.activePool.every(
        (item) => item.consecutiveCorrect === 0,
      ),
    ).toBe(true);
  });

  it("「退出本轮」与「结束本轮」都回首页，区别只在轮次留不留", () => {
    const hash = "memory_exit_vs_end_hash";
    const ids = ["a", "b", "c", "d", "e", "f"];
    const session = makeSession(ids, { hash });
    session.updateBankSettings({ selectionMode: "sequential" });
    session.updateMemorySettings({ roundTarget: 5 });
    session.startLearning();

    const answeredId = session.currentQuestion!.id;
    answer(session, true);
    const poolBefore = session.appState.activePool.map((item) => item.id);

    session.exitSession();
    expect(session.run).toBe("idle");
    // 退出只是回首页：池子与轮内连对都留着，下次接着这一轮
    expect(session.appState.activePool.map((item) => item.id)).toEqual(
      poolBefore,
    );
    expect(session.progress[answeredId]?.streak).toBe(1);
    expect(session.hasOngoingRound).toBe(true);

    session.startLearning();
    expect(session.appState.activePool.map((item) => item.id)).toEqual(
      poolBefore,
    );

    session.endRound();
    expect(session.run).toBe("idle");
    expect(session.appState.activePool).toEqual([]);
    expect(session.hasOngoingRound).toBe(false);
  });

  it("复习轮没有「结束」：调用它什么都不做（复习队列不是「一轮」）", () => {
    const hash = "memory_end_round_review_hash";
    saveState(hash, {
      ...emptyState(),
      memory: {
        progress: { a: dueCard(), b: dueCard() },
        settings: createDefaultMemorySettings(),
      },
    });
    const session = makeSession(["a", "b"], { hash });
    session.startReview();
    const before = session.appState;

    session.endRound();

    expect(session.run).toBe("reviewing");
    expect(session.appState).toBe(before);
    expect(session.currentQuestion).not.toBeNull();
  });

  it("没在答题时（首页）是空操作", () => {
    const session = makeSession(["a", "b"], {
      hash: "memory_restart_idle_hash",
    });
    const before = session.appState;

    session.endRound();

    expect(session.run).toBe("idle");
    expect(session.appState).toBe(before);
  });
});
