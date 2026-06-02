import answerCorrectUrl from "../../assets/sounds/answer-correct.webm";
import answerWrongUrl from "../../assets/sounds/answer-wrong.webm";
import successUrl from "../../assets/sounds/success.webm";
import type { RuntimeState } from "../types";
import type { SoundPlayer } from "./types";
import { SOUND_ENABLED_BY_DEFAULT } from "../config";

type SoundName = "answer-correct" | "answer-wrong" | "success";
type Toast = (
  title: string,
  description?: string,
  variant?: "default" | "success" | "destructive",
) => void;

const SOUND_URLS: Record<SoundName, string> = {
  "answer-correct": answerCorrectUrl,
  "answer-wrong": answerWrongUrl,
  success: successUrl,
};

export function createSoundPlayer(): SoundPlayer {
  const audio = new Map<SoundName, HTMLAudioElement>();

  function getAudio(name: SoundName): HTMLAudioElement {
    let element = audio.get(name);
    if (!element) {
      element = new Audio(SOUND_URLS[name]);
      element.preload = "auto";
      element.volume = 0.65;
      audio.set(name, element);
    }
    return element;
  }

  return {
    playAnswer(isCorrect) {
      play(isCorrect ? "answer-correct" : "answer-wrong");
    },
    playSuccess() {
      play("success");
    },
  };

  function play(name: SoundName): void {
    const element = getAudio(name);
    element.currentTime = 0;
    void element.play().catch(() => {
      // Browsers can still reject playback until a user gesture unlocks audio.
    });
  }
}

export function maybePlayAnswerSound(
  state: RuntimeState,
  player: SoundPlayer,
  isCorrect: boolean,
): void {
  if (state.settings.soundEnabled === true) {
    player.playAnswer(isCorrect);
  }
}

export function maybePlaySuccessSound(
  state: RuntimeState,
  player: SoundPlayer,
): void {
  if (state.settings.soundEnabled === true) {
    player.playSuccess();
  }
}

export function initializeSoundPreference(state: RuntimeState): void {
  state.settings.soundEnabled ??= SOUND_ENABLED_BY_DEFAULT;
}

export function setSoundEnabledPreference(
  state: RuntimeState,
  next: boolean,
  save: () => void,
  toast: Toast,
  player: SoundPlayer,
): void {
  if (state.settings.soundEnabled === next) return;
  state.settings.soundEnabled = next;
  save();
  if (next) player.playSuccess();
  toast(next ? "音效已开启" : "音效已关闭");
}
