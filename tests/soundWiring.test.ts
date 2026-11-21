import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appSound } from "../src/sound";
import { QuizSession } from "../src/quiz/session/QuizSession.svelte";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import { globalSettingsStore } from "../src/features/globalSettings.svelte";
import type { MemoryBank, QuizBank } from "../src/source/types";

/**
 * 「业务事件 → 语义音效」的接线测试。
 *
 * 声音本身（开关、手势、音量、播放器生命周期）由 `sound.test.ts` 守；
 * 这里只确认各条业务路径**在正确的时机**叫了 `appSound.play(正确的事件)`：
 * 判分在状态落定之后、标熟只在新掌握时、会话的开始 / 结束各一声。
 *
 * 用 spy 替换单例的 `play`，不会创建 AudioContext。
 */

const QUIZ_BANK: QuizBank = {
  hash: "sound_wiring_quiz",
  name: "接线题库",
  mode: "quiz",
  questions: [{ id: "q1", type: "judgment", question: "判断题", answer: true }],
};

const MEMORY_BANK: MemoryBank = {
  hash: "sound_wiring_memory",
  name: "接线记忆题库",
  mode: "memory",
  questions: [{ id: "m1", type: "memory", question: "题", answer: "答" }],
};

function quizSession(): QuizSession {
  const session = new QuizSession(QUIZ_BANK, {
    flash: () => {},
    toast: () => {},
  });
  session.initialize();
  return session;
}

let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  globalSettingsStore.reload();
  play = vi.spyOn(appSound, "play").mockReturnValue(false);
});

afterEach(() => {
  play.mockRestore();
  localStorage.clear();
});

describe("刷题模式", () => {
  it("答对 / 答错分别响 answer-correct / answer-wrong", () => {
    const correct = quizSession();
    correct.selectedAnswers = [0];
    correct.submit();
    expect(play).toHaveBeenCalledWith("answer-correct");

    play.mockClear();
    // 上面那次 submit 会把「屏上会话」写进 localStorage；换一道错题前先清干净，
    // 否则新会话会恢复成判分后的状态，submit 直接空操作。
    localStorage.clear();
    globalSettingsStore.reload();
    const wrong = quizSession();
    wrong.selectedAnswers = [1];
    wrong.submit();
    expect(play).toHaveBeenCalledWith("answer-wrong");
  });

  it("视作正确按「答对」处理", () => {
    const session = quizSession();
    session.selectedAnswers = [1];
    session.submit();
    play.mockClear();

    session.treatLastAnswerAsCorrect();
    expect(play).toHaveBeenCalledWith("answer-correct");
  });

  it("标熟响 question-mastered；重复标同一道不再响", () => {
    const session = quizSession();
    session.markCurrentAsMastered();
    expect(play).toHaveBeenCalledWith("question-mastered");

    play.mockClear();
    session.markAsMastered("q1");
    expect(play).not.toHaveBeenCalledWith("question-mastered");
  });

  it("重置当前题库进度响 progress-reset", () => {
    const session = quizSession();
    session.reset();
    expect(play).toHaveBeenCalledWith("progress-reset");
  });

  it("活动池展开 / 收起分别响 drag-start / drop", () => {
    const session = quizSession();
    const initiallyOpen = session.appState.ui.showPool;

    session.togglePool();
    expect(play).toHaveBeenLastCalledWith(
      initiallyOpen ? "pool-collapse" : "pool-expand",
    );

    session.togglePool();
    expect(play).toHaveBeenLastCalledWith(
      initiallyOpen ? "pool-expand" : "pool-collapse",
    );
  });

  it("抽屉的 setPoolOpen 同状态不重复响，变状态才响", () => {
    const session = quizSession();
    const before = session.appState.ui.showPool;

    play.mockClear();
    session.setPoolOpen(before);
    expect(play, "同状态设定是幂等的，不该出声").not.toHaveBeenCalled();

    session.setPoolOpen(!before);
    expect(play).toHaveBeenLastCalledWith(
      before ? "pool-collapse" : "pool-expand",
    );
  });
});

describe("记忆模式", () => {
  it("进入学习 / 退出会话各一声", () => {
    const session = new MemorySession(MEMORY_BANK, {
      flash: () => {},
      toast: () => {},
    });

    session.startLearning();
    expect(session.run).toBe("learning");
    expect(play).toHaveBeenCalledWith("session-start");

    play.mockClear();
    session.exitSession();
    expect(session.run).toBe("idle");
    expect(play).toHaveBeenCalledWith("session-end");
  });

  it("没有可学的卡时不开轮，也不响", () => {
    const session = new MemorySession(
      { ...MEMORY_BANK, questions: [] },
      { flash: () => {}, toast: () => {} },
    );

    session.startLearning();
    expect(session.run).toBe("idle");
    expect(play).not.toHaveBeenCalledWith("session-start");
  });
});
