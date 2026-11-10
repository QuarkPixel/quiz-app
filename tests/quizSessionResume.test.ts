/**
 * 刷题模式的「屏上会话」：刷新 / 换设备之后要回到同一道题、同一页。
 *
 * 覆盖四件事：
 *   1. 题干页恢复（含选项顺序原样还原）；
 *   2. 判分页恢复（对错、作答、选项顺序）——但「视作正确」不可用；
 *   3. 那道题已经不在池子 / 题库里 → 正常出题，不留一条死记录；
 *   4. 题库改过（选项数量对不上）→ 重新打乱，而不是给一屏空选项。
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QuizSession } from "../src/quiz/session/QuizSession.svelte";
import type { QuizBank } from "../src/source/types";
import type { Question, QuestionType, StoredState } from "../src/types";
import {
  createActivePoolItem,
  createDefaultSettings,
  saveState,
} from "../src/store";
import { globalSettingsStore } from "../src/features/globalSettings.svelte";

const HASH = "quiz_session_resume_hash";

function q(
  id: string,
  type: QuestionType,
  answer: Question["answer"],
  options?: { text: string }[],
): Question {
  return { id, type, question: `q-${id}`, answer, options };
}

function makeBank(): QuizBank {
  return {
    hash: HASH,
    name: "resume bank",
    mode: "quiz",
    questions: [
      q("judgment_1", "judgment", true),
      q("single_1", "single", [0], [{ text: "A" }, { text: "B" }, { text: "C" }]),
      q("blank_1", "blank", "hello"),
    ],
  };
}

function makeDeps() {
  return {
    flash: vi.fn(),
    toast: vi.fn(),
    sound: { preload: vi.fn(), playAnswer: vi.fn(), playSuccess: vi.fn() },
  };
}

function emptyState(): StoredState {
  return {
    masteredIds: [],
    masteredMistakes: {},
    activePool: [],
    currentRound: 0,
    filterType: "all",
    settings: createDefaultSettings(),
    ui: { progressFocused: false, showPool: false },
  };
}

function seed(state: Partial<StoredState>): void {
  saveState(HASH, { ...emptyState(), ...state });
}

function open(): QuizSession {
  const session = new QuizSession(makeBank(), makeDeps());
  session.initialize();
  return session;
}

beforeEach(() => {
  localStorage.clear();
  globalSettingsStore.reload();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("刷题模式：刷新后回到同一道题", () => {
  it("题干页：回到同一道题、同一套选项顺序", () => {
    seed({
      activePool: [createActivePoolItem("single_1", 1)],
      quizSession: {
        currentId: "single_1",
        phase: "asking",
        selectedAnswers: [],
        blankAnswerInputs: [],
        optionOrder: [2, 0, 1],
        rev: 1,
      },
    });

    const session = open();
    expect(session.currentQuestion?.id).toBe("single_1");
    expect(session.showResult).toBe(false);
    expect(session.shuffledOptions.map((opt) => opt.originalIndex)).toEqual([
      2, 0, 1,
    ]);
    // 恢复出来的题干页照常能答
    expect(session.canTreatAsCorrect).toBe(false);
  });

  it("判分页：对错、作答、选项顺序都还在；但「视作正确」不可用", () => {
    seed({
      activePool: [createActivePoolItem("single_1", 1)],
      quizSession: {
        currentId: "single_1",
        phase: "judged",
        correct: false,
        selectedAnswers: [1],
        blankAnswerInputs: [],
        optionOrder: [1, 2, 0],
        rev: 2,
      },
    });

    const session = open();
    expect(session.currentQuestion?.id).toBe("single_1");
    expect(session.showResult).toBe(true);
    expect(session.isCorrect).toBe(false);
    expect(session.selectedAnswers).toEqual([1]);
    expect(session.shuffledOptions.map((opt) => opt.originalIndex)).toEqual([
      1, 2, 0,
    ]);
    // 判分前快照不落盘 → 反悔入口不出现（而不是点了没反应）
    expect(session.canTreatAsCorrect).toBe(false);
    expect(() => session.treatLastAnswerAsCorrect()).not.toThrow();
    expect(session.isCorrect).toBe(false);
  });

  it("判分后点下一题：正常出下一道，会话记录跟着换", () => {
    seed({
      activePool: [createActivePoolItem("single_1", 1)],
      quizSession: {
        currentId: "single_1",
        phase: "judged",
        correct: true,
        selectedAnswers: [0],
        blankAnswerInputs: [],
        optionOrder: [0, 1, 2],
        lastAskedId: "single_1",
        rev: 2,
      },
    });

    const session = open();
    session.advanceQuestionFlow();
    expect(session.currentQuestion).not.toBeNull();
    expect(session.showResult).toBe(false);
    const stored = JSON.parse(
      localStorage.getItem(`quiz_app_state_${HASH}`) ?? "{}",
    ) as StoredState;
    expect(stored.quizSession?.phase).toBe("asking");
    expect(stored.quizSession?.currentId).toBe(session.currentQuestion?.id);
  });
});

describe("刷题模式：会话失效时正常出题", () => {
  it("那道题已经不在池子里（被掌握了）→ 不恢复，重新出题", () => {
    seed({
      // `single_1` 已经掌握：既不在池子里，也不会被 `fillActivePool` 补回来
      masteredIds: ["single_1"],
      masteredMistakes: { single_1: false },
      activePool: [createActivePoolItem("judgment_1", 1)],
      quizSession: {
        currentId: "single_1",
        phase: "asking",
        selectedAnswers: [],
        blankAnswerInputs: [],
        optionOrder: [0, 1, 2],
        rev: 1,
      },
    });

    const session = open();
    expect(session.currentQuestion).not.toBeNull();
    expect(session.currentQuestion?.id).not.toBe("single_1");
  });

  it("题库改过（选项数量对不上）→ 重新打乱，不给一屏空选项", () => {
    seed({
      activePool: [createActivePoolItem("single_1", 1)],
      quizSession: {
        currentId: "single_1",
        phase: "asking",
        selectedAnswers: [],
        blankAnswerInputs: [],
        // 题目有 3 个选项，这里只存了 2 个——题库被改过
        optionOrder: [0, 1],
        rev: 1,
      },
    });

    const session = open();
    expect(session.currentQuestion?.id).toBe("single_1");
    expect(session.shuffledOptions).toHaveLength(3);
    expect(
      session.shuffledOptions.map((opt) => opt.originalIndex).sort(),
    ).toEqual([0, 1, 2]);
  });

  it("空题库：不留下指向不存在的会话", () => {
    const bank: QuizBank = { hash: HASH, name: "empty", mode: "quiz", questions: [] };
    const session = new QuizSession(bank, makeDeps());
    session.initialize();
    expect(session.currentQuestion).toBeNull();
    const stored = JSON.parse(
      localStorage.getItem(`quiz_app_state_${HASH}`) ?? "{}",
    ) as StoredState;
    expect(stored.quizSession).toBeUndefined();
  });
});
