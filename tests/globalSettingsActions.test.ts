import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applySoundEnabledPreference,
  setSoundVolumePreference,
  toggleAutoNextPreference,
  toggleSoundPreference,
} from "../src/features/globalSettingsActions";
import { GlobalSettingsStore } from "../src/features/globalSettings.svelte";
import { QuizSession } from "../src/quiz/session/QuizSession.svelte";
import { MemorySession } from "../src/features/memory/MemorySession.svelte";
import { STORAGE_KEY_GENERAL, SOUND_VOLUME_DEFAULT } from "../src/config";
import type { QuizBank, MemoryBank } from "../src/source/types";
import type { SoundService } from "../src/sound/types";

/**
 * 全局偏好开关（音效 / 音量 / 答对自动下一题）的统一实现。
 *
 * 这几个开关在 `GlobalSettings` 面板上，也要能被答题界面的快捷键按到。
 * 以前 `QuizSession`、`MemorySession`、`GlobalSettings.svelte` 各写了一遍，
 * 文案与副作用慢慢就不一样了 —— 记忆模式甚至连 ⌘S / ⌘N 都没接上。
 * 所以这里守三件事：
 *   1. 开关本身的**可观察结果**（落盘 + 提示文案 + 试听）；
 *   2. 关闭时**先同步偏好再提示**，且不再试听；
 *   3. **两个 session 走的是同一份实现**（同样的提示、同样的落盘结果）。
 */

function makeSound() {
  return {
    attachUnlockGesture: vi.fn(() => () => {}),
    play: vi.fn(() => true),
    applyPreferences: vi.fn(),
    dispose: vi.fn(async () => {}),
  } as unknown as SoundService & {
    play: ReturnType<typeof vi.fn>;
    applyPreferences: ReturnType<typeof vi.fn>;
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
  it("打开：落盘 + 同步偏好 + 试听一声 + 提示「音效已开启」", () => {
    const store = freshStore();
    const sound = makeSound();
    const toast = vi.fn();

    toggleSoundPreference(store, toast, sound);

    expect(store.value.soundEnabled).toBe(true);
    expect(persistedSettings().soundEnabled, "没写回 general 配置").toBe(true);
    expect(sound.applyPreferences).toHaveBeenCalledWith({
      soundEnabled: true,
      soundVolume: SOUND_VOLUME_DEFAULT,
      autoSubmitOnSelection: true,
      autoNextOnCorrect: false,
    });
    expect(sound.play).toHaveBeenCalledWith("sound-enabled");
    expect(
      sound.applyPreferences.mock.invocationCallOrder[0],
      "先让播放器跟上开关，再试听",
    ).toBeLessThan(sound.play.mock.invocationCallOrder[0]!);
    expect(toast).toHaveBeenCalledWith("音效已开启");
  });

  it("关闭：落盘 + 同步偏好，不再试听", () => {
    const store = freshStore();
    store.update({ soundEnabled: true });
    const sound = makeSound();
    const toast = vi.fn();

    toggleSoundPreference(store, toast, sound);

    expect(store.value.soundEnabled).toBe(false);
    expect(persistedSettings().soundEnabled).toBe(false);
    expect(sound.applyPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ soundEnabled: false }),
    );
    expect(sound.play).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("音效已关闭");
  });

  it("设成当前值：不动盘、不提示（幂等）", () => {
    const store = freshStore();
    const sound = makeSound();
    const toast = vi.fn();
    const before = localStorage.getItem(STORAGE_KEY_GENERAL);

    applySoundEnabledPreference(store, store.value.soundEnabled, toast, sound);

    expect(toast).not.toHaveBeenCalled();
    expect(sound.play).not.toHaveBeenCalled();
    expect(sound.applyPreferences).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY_GENERAL)).toBe(before);
  });
});

describe("音效音量", () => {
  it("落盘 + 同步到播放器", () => {
    const store = freshStore();
    const sound = makeSound();

    setSoundVolumePreference(store, 0.35, sound);

    expect(store.value.soundVolume).toBe(0.35);
    expect(persistedSettings().soundVolume).toBe(0.35);
    expect(sound.applyPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ soundVolume: 0.35 }),
    );
    expect(sound.play).toHaveBeenCalledWith("volume-changed", {
      cooldownMs: 45,
      retrigger: "restart",
    });
  });

  it("越界值被钳到 0–1，并保留两位小数", () => {
    const store = freshStore();
    const sound = makeSound();

    setSoundVolumePreference(store, 4, sound);
    expect(store.value.soundVolume).toBe(1);

    setSoundVolumePreference(store, -1, sound);
    expect(store.value.soundVolume).toBe(0);

    setSoundVolumePreference(store, 0.333, sound);
    expect(store.value.soundVolume).toBe(0.33);
  });

  it("拖到 0：静音，不再试听", () => {
    const store = freshStore();
    const sound = makeSound();

    setSoundVolumePreference(store, 0, sound);

    expect(store.value.soundVolume).toBe(0);
    expect(sound.applyPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ soundVolume: 0 }),
    );
    expect(sound.play).not.toHaveBeenCalled();
  });
});

describe("答对自动下一题", () => {
  it("翻转开关并给出对应的说明文案", () => {
    const store = freshStore();
    const sound = makeSound();
    const toast = vi.fn();

    toggleAutoNextPreference(store, toast, sound);
    expect(store.value.autoNextOnCorrect).toBe(true);
    expect(persistedSettings().autoNextOnCorrect).toBe(true);
    expect(sound.play).toHaveBeenLastCalledWith("setting-toggle-on");
    expect(toast).toHaveBeenLastCalledWith(
      "答对自动下一题已开启",
      "答对后自动进入下一题。",
    );

    toggleAutoNextPreference(store, toast, sound);
    expect(store.value.autoNextOnCorrect).toBe(false);
    expect(sound.play).toHaveBeenLastCalledWith("setting-toggle-off");
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
      { flash: () => {}, toast: quizToast },
      freshStore(),
    );

    const memoryToast = vi.fn();
    const memory = new MemorySession(
      MEMORY_BANK,
      { flash: () => {}, toast: memoryToast },
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
