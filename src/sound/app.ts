/**
 * 应用级音效单例：一层**懒加载门面**。
 *
 * 为什么要有门面：uisfx（合成器 + 整份配方）有几十 KB，而音效是纯附属能力——
 * 没有它，刷题、记忆、同步全都照常。所以主包里只留这一层路由，引擎等页面
 * load 之后、浏览器空闲时再 `import()`；在那之前的 `play()` 直接丢弃并返回
 * `false`（不排队：补播过期反馈比没声音更糟）。
 *
 * **不要**在这个文件里静态 import `./service`（或 `uisfx`）：那会让整份合成
 * 配方回到主包，懒加载就白做了。业务侧同理，只从 `@/sound` 取 `appSound`。
 */

import { globalSettingsStore } from "@/features/globalSettings.svelte";
import type { SoundPlayer, SoundService } from "./types";

/** 没有 `requestIdleCallback` 时的兜底间隔（老 Safari）。 */
const FALLBACK_LOAD_DELAY_MS = 200;
/** 浏览器一直忙时，最迟多久也要把引擎拉起来。 */
const IDLE_TIMEOUT_MS = 2000;

let engine: SoundService | null = null;
let loading: Promise<void> | null = null;
let disposed = false;
let scheduled = false;

/**
 * 预热 / 加载音效引擎；重复调用共用同一个 Promise，不会拉第二次。
 *
 * 正常由 `scheduleLoad` 在页面 load 之后调用；测试直接用它，免得等真实定时器。
 */
export function preloadSound(): Promise<void> {
  loading ??= (async () => {
    try {
      const { createSoundService } = await import("./service");
      if (disposed) return;
      const service = createSoundService({
        getPreferences: () => globalSettingsStore.value,
      });
      // 手势监听随引擎一起装。加载之前用户点过多少次都没关系：对引擎来说，
      // 加载完成后的下一次点击就是「第一次手势」，那时候再解锁也来得及。
      service.attachUnlockGesture();
      engine = service;
    } catch {
      // chunk 没拉下来（离线 / 代理拦截）：就一直没有声音，别的功能照常。
      // 不重试——下一次手势再发一次请求，通常还是同一个结果。
    }
  })();
  return loading;
}

function scheduleLoad(): void {
  if (scheduled || disposed) return;
  scheduled = true;

  const start = (): void => {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => void preloadSound(), {
        timeout: IDLE_TIMEOUT_MS,
      });
      return;
    }
    setTimeout(() => void preloadSound(), FALLBACK_LOAD_DELAY_MS);
  };

  // 已经加载完（HMR / 测试 / 入口 chunk 本身加载得慢）就不用等 load 事件了
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}

export const appSound: SoundPlayer = {
  play(event, options) {
    return engine?.play(event, options) ?? false;
  },

  applyPreferences(next) {
    // 引擎没加载时不用记：它创建时就用 `getPreferences` 读最新值，
    // 加载期间改的开关 / 音量不会漏。
    engine?.applyPreferences(next);
  },
};

if (typeof window !== "undefined") {
  scheduleLoad();
  // HMR 换模块时把 AudioContext 关掉：否则每次热更新都会留下一个悬挂的上下文。
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      disposed = true;
      const service = engine;
      engine = null;
      if (service !== null) void service.dispose();
    });
  }
}
