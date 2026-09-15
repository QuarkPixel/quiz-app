import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySoundEnabledPreference,
  toggleAutoNextPreference,
  toggleSoundPreference,
} from "../src/features/globalSettingsActions";
import { GlobalSettingsStore } from "../src/features/globalSettings.svelte";
import { QuizSession } from "../src/quiz/session/QuizSession.svelte";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import { STORAGE_KEY_GENERAL } from "../src/config";
import type { QuizBank, MemoryBank } from "../src/source/types";
import type { SoundPlayer } from "../src/sound/types";

/**
 * 全局偏好开关（音效 / 答对自动下一题）的统一实现。
 *
 * 这两个开关在 `GlobalSettings` 面板上，也要能被答题界面的快捷键按到。
 * 以前 `QuizSession`、`MemorySession`、`GlobalSettings.svelte` 各写了一遍，
 * 文案与副作用慢慢就不一样了 —— 记忆模式甚至连 ⌘S / ⌘N 都没接上。
 * 所以这里守两件事：
 *   1. 开关本身的**可观察结果**（落盘 + 提示文案 + 试听）；
 *   2. **两个 session 走的是同一份实现**（同样的提示、同样的落盘结果）。
 */

function makePlayer() {
  return {
    preload: vi.fn(),
    playSuccess: vi.fn(),
    playAnswer: vi.fn(),
    play: vi.fn(),
  } as unknown as SoundPlayer & {
    preload: ReturnType<typeof vi.fn>;
    playSuccess: ReturnType<typeof vi.fn>;
  };
}

function persistedSettings(): Record<string, unknown> {
  const raw = localStorage.getItem(STORAGE_KEY_GENERAL);
  return JSON.parse(raw ?? "{}").globalSettings ?? {};
}

/** 每次都用全新 store：它是从 localStorage 读初值的，别让上一个用例的盘影响它 */
function freshStore(): GlobalSettingsStore {
  return new GlobalSettingsStore();
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("音效开关", () => {
  it("打开：落盘 + 试听一声 + 提示「音效已开启」", () => {
    const store = freshStore();
    const player = makePlayer();
    const toast = vi.fn();

    toggleSoundPreference(store, toast, player);

    expect(store.value.soundEnabled).toBe(true);
    expect(persistedSettings().soundEnabled, "没写回 general 配置").toBe(true);
    expect(player.preload).toHaveBeenCalledOnce();
    expect(player.playSuccess).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith("音效已开启");
  });

  it("关闭：落盘 + 不再试听", () => {
    const store = freshStore();
    store.update({ soundEnabled: true });
    const player = makePlayer();
    const toast = vi.fn();

    toggleSoundPreference(store, toast, player);

    expect(store.value.soundEnabled).toBe(false);
    expect(persistedSettings().soundEnabled).toBe(false);
    expect(player.playSuccess).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("音效已关闭");
  });

  it("设成当前值：不动盘、不提示（幂等）", () => {
    const store = freshStore();
    const player = makePlayer();
    const toast = vi.fn();
    const before = localStorage.getItem(STORAGE_KEY_GENERAL);

    applySoundEnabledPreference(store, store.value.soundEnabled, toast, player);

    expect(toast).not.toHaveBeenCalled();
    expect(player.playSuccess).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY_GENERAL)).toBe(before);
  });
});

describe("答对自动下一题", () => {
  it("翻转开关并给出对应的说明文案", () => {
    const store = freshStore();
    const toast = vi.fn();

    toggleAutoNextPreference(store, toast);
    expect(store.value.autoNextOnCorrect).toBe(true);
    expect(persistedSettings().autoNextOnCorrect).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(
      "答对自动下一题已开启",
      "答对后自动进入下一题。",
    );

    toggleAutoNextPreference(store, toast);
    expect(store.value.autoNextOnCorrect).toBe(false);
    expect(toast).toHaveBeenLastCalledWith(
      "答对自动下一题已关闭",
      "答对后停留在结果页（按空格继续）。",
    );
  });
});

describe("两个模式共用同一份实现", () => {
  const QUIZ_BANK: QuizBank = {
    hash: "quiz_prefs",
    name: "刷题题库",
    mode: "quiz",
    questions: [
      { id: "j1", type: "judgment", question: "判断题", answer: true },
    ],
  };
  const MEMORY_BANK: MemoryBank = {
    hash: "memory_prefs",
    name: "记忆题库",
    mode: "memory",
    questions: [{ id: "m1", type: "memory", question: "题", answer: "答" }],
  };

  it("⌘S / ⌘N 在记忆模式与刷题模式产生逐字相同的提示与落盘结果", () => {
    // 都传全新的 store：默认那个是**内存里的单例**，清 localStorage 也带不走它，
    // 否则第二个 session 会从「上一个用例刚改过的值」出发，断言变成看顺序
    const quizToast = vi.fn();
    const quiz = new QuizSession(
      QUIZ_BANK,
      { flash: () => {}, toast: quizToast, sound: makePlayer() },
      freshStore(),
    );

    const memoryToast = vi.fn();
    const memory = new MemorySession(
      MEMORY_BANK,
      { flash: () => {}, toast: memoryToast, sound: makePlayer() },
      freshStore(),
    );

    quiz.toggleSound();
    quiz.toggleAutoNext();
    const afterQuiz = { ...persistedSettings() };

    localStorage.clear();
    memory.toggleSound();
    memory.toggleAutoNext();

    expect(memoryToast.mock.calls, "记忆模式的提示与刷题模式不一致").toEqual(
      quizToast.mock.calls,
    );
    expect(persistedSettings()).toEqual(afterQuiz);

    // 各自的全局设置视图也跟着变（UI 上那颗开关的选中态）
    expect(quiz.globalSettings.soundEnabled).toBe(true);
    expect(quiz.globalSettings.autoNextOnCorrect).toBe(true);
    expect(memory.globalSettings.soundEnabled).toBe(true);
    expect(memory.globalSettings.autoNextOnCorrect).toBe(true);
  });
});
