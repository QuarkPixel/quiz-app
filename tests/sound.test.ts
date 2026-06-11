import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createSoundPlayer,
  setSoundEnabledPreference,
} from "../src/sound/library";
import { createDefaultSettings, createDefaultUiPreferences } from "../src/store";
import type { RuntimeState } from "../src/types";

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

function makeState(soundEnabled = false): RuntimeState {
  return {
    masteredIds: [],
    activePool: [],
    pendingIds: [],
    currentRound: 0,
    filterType: "all",
    settings: {
      ...createDefaultSettings(),
      soundEnabled,
    },
    ui: createDefaultUiPreferences(),
  };
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

describe("setSoundEnabledPreference", () => {
  it("开启音效时先预载再播放提示音", () => {
    const events: string[] = [];
    const state = makeState(false);
    const save = vi.fn();
    const toast = vi.fn();
    const player = {
      preload: vi.fn(() => events.push("preload")),
      playSuccess: vi.fn(() => events.push("playSuccess")),
      playAnswer: vi.fn(),
    };

    setSoundEnabledPreference(state, true, save, toast, player);

    expect(state.settings.soundEnabled).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["preload", "playSuccess"]);
    expect(toast).toHaveBeenCalledWith("音效已开启");
  });
});
