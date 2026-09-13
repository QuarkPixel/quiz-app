import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSoundPlayer,
  maybePlayAnswerSound,
  maybePlaySuccessSound,
  setSoundEnabledPreference,
} from "../src/sound";
import { createDefaultGlobalSettings } from "../src/globalSettings";

class MockAudio {
  static instances: MockAudio[] = [];

  preload = "";
  volume = 1;
  currentTime = 0;
  load = vi.fn();
  play = vi.fn(() => Promise.resolve());

  constructor(readonly src = "") {
    MockAudio.instances.push(this);
  }
}

describe("createSoundPlayer", () => {
  beforeEach(() => {
    MockAudio.instances = [];
    vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, "audioSession");
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("创建时预载全部音效", () => {
    const audioSession = { type: "auto" };
    Object.defineProperty(navigator, "audioSession", {
      value: audioSession,
      configurable: true,
    });

    const player = createSoundPlayer();

    expect(MockAudio.instances).toHaveLength(3);
    for (const instance of MockAudio.instances) {
      expect(instance.preload).toBe("auto");
      expect(instance.volume).toBe(0.65);
      expect(instance.load).toHaveBeenCalledTimes(1);
    }
    expect(audioSession.type).toBe("ambient");

    player.preload();
    for (const instance of MockAudio.instances) {
      expect(instance.load).toHaveBeenCalledTimes(2);
    }
  });
});

describe("maybePlay* 依据全局设置决定是否播放", () => {
  it("soundEnabled=false → 不播放", () => {
    const settings = { ...createDefaultGlobalSettings(), soundEnabled: false };
    const player = {
      preload: vi.fn(),
      playAnswer: vi.fn(),
      playSuccess: vi.fn(),
    };

    maybePlayAnswerSound(settings, player, true);
    maybePlaySuccessSound(settings, player);

    expect(player.playAnswer).not.toHaveBeenCalled();
    expect(player.playSuccess).not.toHaveBeenCalled();
  });

  it("soundEnabled=true → 播放", () => {
    const settings = { ...createDefaultGlobalSettings(), soundEnabled: true };
    const player = {
      preload: vi.fn(),
      playAnswer: vi.fn(),
      playSuccess: vi.fn(),
    };

    maybePlayAnswerSound(settings, player, false);
    maybePlaySuccessSound(settings, player);

    expect(player.playAnswer).toHaveBeenCalledWith(false);
    expect(player.playSuccess).toHaveBeenCalledTimes(1);
  });
});

describe("setSoundEnabledPreference", () => {
  it("开启音效时先预载再播放提示音", () => {
    const events: string[] = [];
    const settings = createDefaultGlobalSettings();
    const save = vi.fn();
    const toast = vi.fn();
    const player = {
      preload: vi.fn(() => events.push("preload")),
      playSuccess: vi.fn(() => events.push("playSuccess")),
      playAnswer: vi.fn(),
    };

    setSoundEnabledPreference(settings, true, save, toast, player);

    expect(settings.soundEnabled).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["preload", "playSuccess"]);
    expect(toast).toHaveBeenCalledWith("音效已开启");
  });

  it("值未变化时不做任何事", () => {
    const settings = { ...createDefaultGlobalSettings(), soundEnabled: true };
    const save = vi.fn();
    const toast = vi.fn();
    const player = {
      preload: vi.fn(),
      playSuccess: vi.fn(),
      playAnswer: vi.fn(),
    };

    setSoundEnabledPreference(settings, true, save, toast, player);

    expect(save).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
