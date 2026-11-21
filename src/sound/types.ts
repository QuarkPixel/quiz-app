/** 音效服务对外的契约（业务代码与测试都只依赖这个接口）。 */

import type { AppSoundEvent } from "./cues";

/** 全局偏好里与声音有关的两项（GlobalSettings 的子集）。 */
export interface SoundPreferences {
  soundEnabled: boolean;
  /** 0–1 线性主音量 */
  soundVolume: number;
}

/**
 * 一个浏览器窗口能听手势的最小接口。
 *
 * 不直接写 `Window`：测试用一个只有这两个方法的假对象就能驱动解锁流程，
 * 不需要真的 DOM。
 */
export interface SoundGestureTarget {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

export interface SoundService {
  /**
   * 在第一个真实手势（pointerdown / keydown / click）上解锁 Web Audio。
   *
   * 幂等：重复调用返回同一个解绑函数。应用里由 `appSound` 在模块加载时装上；
   * 测试可以传一个假 target。
   */
  attachUnlockGesture(target?: SoundGestureTarget): () => void;

  /**
   * 播放一个语义事件。
   *
   * `options` 只给「同一个语义、需要一点播放策略」的场合用（热力图 hover 的
   * 冷却、音量拖动的 restart），业务代码仍然先选事件，不要在这里传 cue 名。
   *
   * 返回是否真的交给了播放器（开关关着、还没出现过手势、cue 被冷却吃掉都算
   * `false`）。异步流程成功 / 失败时用返回值做判断没有意义——它只描述
   * 「这一声有没有发出去」。
   */
  play(event: AppSoundEvent, options?: SoundPlayOptions): boolean;

  /**
   * 把全局偏好同步到播放器。
   *
   * 关闭时先 `stopAll()` 再 `setEnabled(false)`，静音是立刻生效的；
   * 播放器还没创建时只记住值，等第一次播放再应用。
   */
  applyPreferences(next: SoundPreferences): void;

  /** 释放播放器与监听（HMR / 测试收尾）。之后 `play` 一律返回 false。 */
  dispose(): Promise<void>;
}

/**
 * 单次播放的播放策略。字段全部可选，不传就用 cue 自己的默认值。
 *
 * 这是**表达**层，不是语义层：同一个事件在不同上下文可以有不同音量 / 触发
 * 密度，但「该不该响」仍然由事件表和服务开关决定。
 */
export interface SoundPlayOptions {
  /** 播放速率（同时改变音高与时长），1 = 原样；uisfx 会钳到 0.25–4 */
  playbackRate?: number;
  /** 覆盖该 cue 的默认音量（仍受全局主音量影响） */
  volume?: number;
  /** 覆盖内置冷却（毫秒）；热力图 hover / 音量拖动用它限制密度 */
  cooldownMs?: number;
  /** 同一个 cue 连续触发时怎么处理；音量拖动用 `restart` 避免叠音 */
  retrigger?: "restart" | "overlap" | "ignore";
}
