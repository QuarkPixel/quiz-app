import { SOUND_ENABLED_BY_DEFAULT } from "../config";
import type { RuntimeState, UserSettings } from "../types";
import type { SoundPlayer } from "./types";

export function createSoundPlayer(): SoundPlayer {
  return {
    preload() {},
    playAnswer() {},
    playSuccess() {},
  };
}

export function maybePlayAnswerSound(): void {}

export function maybePlaySuccessSound(): void {}

export function initializeSoundPreference(state: RuntimeState): void {
  state.settings.soundEnabled ??= SOUND_ENABLED_BY_DEFAULT;
}

export function sanitizeSoundSettings(
  settings: UserSettings,
): Pick<UserSettings, "soundEnabled"> {
  return {
    soundEnabled:
      typeof settings.soundEnabled === "boolean"
        ? settings.soundEnabled
        : SOUND_ENABLED_BY_DEFAULT,
  };
}

export function setSoundEnabledPreference(): void {}
