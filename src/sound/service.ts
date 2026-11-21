/**
 * 音效服务：全应用共享一个 uisfx 播放器的薄封装。
 *
 * 这一层只做四件事，业务代码不需要知道 Web Audio 的存在：
 *   1. **延迟创建**播放器（模块加载 / SSR / 测试环境都不碰 AudioContext）；
 *   2. **手势解锁**：在第一个 pointerdown / keydown / click 上 `unlock()`，
 *      解锁之前的 cue 一律**丢弃**，不排队（避免把过期反馈补播出来）；
 *   3. 把全局开关 / 音量同步给播放器（关掉时先 `stopAll`，静音立刻生效）；
 *   4. 把语义事件翻译成 cue（映射表在 `cues.ts`）。
 *
 * 为什么不在每次 `play` 时都 `unlock()`：`unlock()` 是异步的，放在异步流程
 * 之后调用已经脱离用户手势，Safari 不会认。手势监听装在 window 的捕获阶段，
 * 比业务 handler 先跑，所以同一次点击里的 `play()` 已经可以出声。
 *
 * iOS 上还有一个坑（就是「切后台回来之后一直没声音」）：页面进后台 / 来电 /
 * 锁屏时系统会把 AudioContext 打断，它不会自己回到 running，而 uisfx 的
 * `play()` 根本不检查上下文状态——声音就这么静默失败了。所以回到前台时要
 * **把解锁状态作废**，让下一次手势重新 `unlock()`（`resume()` 必须在用户
 * 手势里调用才被 WebKit 接受）。
 */

import {
  createUISFX,
  type UISFXOptions,
  type UISFXPlayer,
} from "uisfx";

import {
  SOUND_VOLUME_DEFAULT,
  SOUND_VOLUME_MAX,
  SOUND_VOLUME_MIN,
} from "@/config";
import { SOUND_CUES, SOUND_PACK } from "./cues";
import type {
  SoundGestureTarget,
  SoundPlayOptions,
  SoundPreferences,
  SoundService,
} from "./types";

/**
 * 不落第二份偏好。
 *
 * 开关与音量已经存在 general 配置里（`GlobalSettings`）；uisfx 自带的
 * localStorage 只是它的默认机制，这里用空存储把它关掉，免得两处各存一份、
 * 一台设备上出现两个不同的音量。
 */
const NO_PERSISTENCE = {
  getItem: () => null,
  setItem: () => {},
};

/** 触发解锁的事件：覆盖鼠标、键盘、触摸与程序化 click。 */
const GESTURE_EVENTS = ["pointerdown", "keydown", "click"] as const;

type NavigatorWithAudioSession = Navigator & {
  audioSession?: { type: string };
};

export interface CreateSoundServiceOptions {
  /** 每次播放 / 同步偏好时读一次（返回全局设置里的两项）。 */
  getPreferences: () => SoundPreferences;
  /** 测试注入用；默认就是 uisfx 的 `createUISFX`。 */
  createPlayer?: (options: UISFXOptions) => UISFXPlayer;
}

export function createSoundService(
  options: CreateSoundServiceOptions,
): SoundService {
  const createPlayer = options.createPlayer ?? createUISFX;

  let player: UISFXPlayer | null = null;
  /** 出现过真实手势（解锁尝试可能还没 resolve）。 */
  let gestureSeen = false;
  /** `unlock()` 已经成功；之后不再重复尝试。 */
  let unlocked = false;
  let disposed = false;
  let detachGesture: (() => void) | null = null;

  function readPreferences(): SoundPreferences {
    const raw = options.getPreferences();
    return {
      soundEnabled: raw.soundEnabled === true,
      soundVolume: clampVolume(raw.soundVolume),
    };
  }

  function ensurePlayer(): UISFXPlayer {
    if (player !== null) return player;
    const prefs = readPreferences();
    player = createPlayer({
      pack: SOUND_PACK,
      volume: prefs.soundVolume,
      enabled: prefs.soundEnabled,
      preferences: { key: "quiz-app:sound", storage: NO_PERSISTENCE },
    });
    return player;
  }

  /** 把当前偏好压到播放器上（只在真的变了时调 setter，避免无谓的增益斜坡）。 */
  function syncPlayer(target: UISFXPlayer, prefs: SoundPreferences): void {
    if (!prefs.soundEnabled && target.isEnabled()) target.stopAll();
    if (target.isEnabled() !== prefs.soundEnabled) {
      target.setEnabled(prefs.soundEnabled);
    }
    if (target.getVolume() !== prefs.soundVolume) {
      target.setVolume(prefs.soundVolume);
    }
  }

  /**
   * 在用户手势里（或回到前台后顺手）尝试解锁。
   *
   * 失败时 `unlocked` 保持 false，下一次手势会再试——iOS 打断之后往往要
   * 试上第二次才真的恢复。
   */
  function attemptUnlock(): void {
    if (disposed) return;
    preferAmbientAudioSession();
    try {
      void ensurePlayer()
        .unlock()
        .then((ok) => {
          if (ok) unlocked = true;
        })
        .catch(() => {
          // 解锁失败就保持监听：下一次手势再试一次。
        });
    } catch {
      // 没有 Web Audio 的环境（旧浏览器 / 测试）直接当静音。
    }
  }

  /**
   * 页面重新可见：作废解锁状态。
   *
   * 只作废、不在这里 `resume()` 也能修好（下一次点击会重建），但回到前台
   * 就先试一次：有的实现回到前台就允许恢复，用户什么都不用点。
   * 播放器还没创建过就别试——那会平白造一个 AudioContext。
   */
  function rearmUnlock(): void {
    if (disposed) return;
    unlocked = false;
    if (player !== null) attemptUnlock();
  }

  const service: SoundService = {
    attachUnlockGesture(target: SoundGestureTarget = window) {
      if (disposed) return () => {};
      if (detachGesture !== null) return detachGesture;

      const onGesture = (): void => {
        gestureSeen = true;
        if (unlocked || disposed) return;
        attemptUnlock();
      };

      for (const type of GESTURE_EVENTS) {
        target.addEventListener(type, onGesture, {
          capture: true,
          passive: true,
        });
      }

      // 回到前台的两个入口：`visibilitychange` 在 document 上（iOS 切后台），
      // `pageshow` 在 window 上（bfcache 恢复时不一定有 visibility 变化）。
      const doc = typeof document === "undefined" ? null : document;
      const win = typeof window === "undefined" ? null : window;
      const onVisibilityChange = (): void => {
        if (doc !== null && doc.visibilityState !== "visible") return;
        rearmUnlock();
      };
      const onPageShow = (): void => rearmUnlock();

      doc?.addEventListener("visibilitychange", onVisibilityChange);
      win?.addEventListener("pageshow", onPageShow);

      const detach = (): void => {
        if (detachGesture !== detach) return;
        for (const type of GESTURE_EVENTS) {
          target.removeEventListener(type, onGesture, { capture: true });
        }
        doc?.removeEventListener("visibilitychange", onVisibilityChange);
        win?.removeEventListener("pageshow", onPageShow);
        detachGesture = null;
      };
      detachGesture = detach;
      return detach;
    },

    play(event, options?: SoundPlayOptions) {
      if (disposed || !gestureSeen) return false;
      const prefs = readPreferences();
      if (!prefs.soundEnabled) return false;

      const target = ensurePlayer();
      syncPlayer(target, prefs);
      const handle = target.play(SOUND_CUES[event], options);
      // `play` 在开关关着 / 没有 AudioContext 时返回 null——这不是错误，
      // 只是这一声没发出去。
      return handle !== null;
    },

    applyPreferences(next) {
      if (disposed) return;
      const prefs: SoundPreferences = {
        soundEnabled: next.soundEnabled === true,
        soundVolume: clampVolume(next.soundVolume),
      };
      if (player !== null) syncPlayer(player, prefs);
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      detachGesture?.();
      const target = player;
      player = null;
      if (target !== null) await target.destroy();
    },
  };

  return service;
}

function clampVolume(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return SOUND_VOLUME_DEFAULT;
  }
  return Math.min(SOUND_VOLUME_MAX, Math.max(SOUND_VOLUME_MIN, value));
}

/**
 * iOS Safari 的音频会话：让系统知道这些是「环境音」，不会压低用户正在听的
 * 音乐，也不受静音拨键之外的特殊对待。旧实现里就有这一条，搬进服务层，
 * 所有 cue 自动共享。
 */
function preferAmbientAudioSession(): void {
  if (typeof navigator === "undefined") return;
  const audioSession = (navigator as NavigatorWithAudioSession).audioSession;
  if (!audioSession) return;
  try {
    audioSession.type = "ambient";
  } catch {
    // 只读或不支持的实现不该影响音效本身。
  }
}
