/**
 * 应用级音效单例。
 *
 * 全应用**只有这一个**播放器：会话、页头同步指示点、侧边栏、设置面板都从这里
 * 取。以前 QuizView / MemoryView / AppShell / GlobalSettings 各 new 一个
 * `HTMLAudioElement` 表，同一份声音在四个地方各持一份；现在统一到 uisfx 的
 * 一个 Web Audio 图。
 *
 * 模块加载时就装上「第一次手势解锁」的监听（浏览器里才装）：漏掉这一步，
 * Safari 里所有声音都会静默失败。测试 / SSR 里没有 window，自然不会执行。
 */

import { globalSettingsStore } from "@/features/globalSettings.svelte";
import { createSoundService } from "./service";

export const appSound = createSoundService({
  getPreferences: () => globalSettingsStore.value,
});

if (typeof window !== "undefined") {
  appSound.attachUnlockGesture();
  // HMR 换模块时把 AudioContext 关掉：否则每次热更新都会留下一个悬挂的上下文。
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      void appSound.dispose();
    });
  }
}
