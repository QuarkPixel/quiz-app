export interface SoundPlayer {
  playAnswer(isCorrect: boolean): void;
  playSuccess(): void;
}
