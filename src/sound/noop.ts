import type { RuntimeState } from "../types";
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

export function initializeSoundPreference(): void {}

export function sanitizeSoundSettings(): object {
  return {};
}

export function setSoundEnabledPreference(
  state: RuntimeState,
  next: boolean,
  save: () => void,
): void {
  if (state.settings.soundEnabled === next) return;
  state.settings.soundEnabled = next;
  save();
}
