/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEV: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*?raw" {
  const content: string;
  export default content;
}

declare module "*.css";

declare module "*.webm" {
  const src: string;
  export default src;
}

declare const __QUIZ_MODE__: "bundled" | "library";
declare const __QUESTIONS_HASH__: string | null;

declare module "$bundled-bank" {
  const questions: import("./src/types").Question[];
  export default questions;
}

declare module "$app-root" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}

declare module "$quiz-source" {
  const SourceImpl: new () => import("./src/source/types").QuizSource;
  export { SourceImpl };
}

declare module "$sound" {
  export { createSoundPlayer } from "./src/sound/library";
  export {
    initializeSoundPreference,
    maybePlayAnswerSound,
    maybePlaySuccessSound,
    sanitizeSoundSettings,
    setSoundEnabledPreference,
  } from "./src/sound/library";
}

declare module "$sound-settings" {
  import type { Component } from "svelte";
  const component: Component;
  export default component;
}
