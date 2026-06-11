export interface SoundPlayer {
  preload(): void;
  playAnswer(isCorrect: boolean): void;
  playSuccess(): void;
}
