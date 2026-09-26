import answerCorrectUrl from "/assets/sounds/answer-correct.webm";
import answerWrongUrl from "/assets/sounds/answer-wrong.webm";
import successUrl from "/assets/sounds/success.webm";
import type { GlobalSettings } from "../types";
import type { SoundPlayer } from "./types";

type SoundName = "answer-correct" | "answer-wrong" | "success";
type Toast = (
  title: string,
  description?: string,
  variant?: "default" | "success" | "destructive",
) => void;

type AudioSessionType =
  | "ambient"
  | "playback"
  | "transient"
  | "transient-solo"
  | "auto";

interface AudioSession {
  type: AudioSessionType;
}

type NavigatorWithAudioSession = Navigator & {
  audioSession?: AudioSession;
};

const SOUND_NAMES: SoundName[] = [
  "answer-correct",
  "answer-wrong",
  "success",
];

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

  const player: SoundPlayer = {
    preload,
    playAnswer(isCorrect) {
      play(isCorrect ? "answer-correct" : "answer-wrong");
    },
    playSuccess() {
      play("success");
    },
  };

  preload();
  return player;

  function preload(): void {
    preferAmbientAudioSession();

    for (const name of SOUND_NAMES) {
      const element = getAudio(name);
      try {
        element.load();
      } catch {
        // Some test/browser environments expose Audio but not load().
      }
    }
  }

  function play(name: SoundName): void {
    preferAmbientAudioSession();
    const element = getAudio(name);
    element.currentTime = 0;
    void element.play().catch(() => {
      // Browsers can still reject playback until a user gesture unlocks audio.
    });
  }
}

function preferAmbientAudioSession(): void {
  if (typeof navigator === "undefined") return;

  const audioSession = (navigator as NavigatorWithAudioSession).audioSession;
  if (!audioSession) return;

  try {
    audioSession.type = "ambient";
  } catch {
    // Unsupported or read-only implementations should not block sound effects.
  }
}

/** 音效开关来自全局设置（GlobalSettings）。 */
export function maybePlayAnswerSound(
  settings: GlobalSettings,
  player: SoundPlayer,
  isCorrect: boolean,
): void {
  if (settings.soundEnabled) {
    player.playAnswer(isCorrect);
  }
}

export function maybePlaySuccessSound(
  settings: GlobalSettings,
  player: SoundPlayer,
): void {
  if (settings.soundEnabled) {
    player.playSuccess();
  }
}

/**
 * 手动同步成功那一下：用**答对题目**的同款音效（云同步指示点的点击回执）。
 *
 * 特意复用 `playAnswer(true)` 而不是 `playSuccess()`：后者是「一轮学完」那种更大
 * 的节点，而同步成功只是一次日常操作的确认，听感上该和答对一题同级。
 */
export function maybePlaySyncSuccessSound(
  settings: GlobalSettings,
  player: SoundPlayer,
): void {
  if (settings.soundEnabled) {
    player.playAnswer(true);
  }
}

/**
 * 切换音效全局偏好。settings 由调用方持有（QuizSession 的 $state），
 * 变更后通过 save() 持久化到 general 配置。
 */
export function setSoundEnabledPreference(
  settings: GlobalSettings,
  next: boolean,
  save: () => void,
  toast: Toast,
  player: SoundPlayer,
): void {
  if (settings.soundEnabled === next) return;
  settings.soundEnabled = next;
  save();
  if (next) {
    player.preload();
    player.playSuccess();
  }
  toast(next ? "音效已开启" : "音效已关闭");
}
