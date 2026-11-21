import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRecipe,
  cueNames,
  getPlaybackMode,
  type PlayingSFX,
  type UISFXPlayer,
} from "uisfx";

import { SOUND_CUES, SOUND_PACK } from "../src/sound/cues";
import { createSoundService } from "../src/sound/service";
import type {
  SoundGestureTarget,
  SoundPreferences,
  SoundService,
} from "../src/sound/types";

/**
 * 音效服务守这几件事：
 *   1. 语义事件表里的每个 cue 都真实存在，而且都是 one-shot（循环不归这里管）；
 *   2. 手势之前不响、也不创建 AudioContext / 播放器；
 *   3. 全应用只有一个播放器，开关 / 音量同步到它；
 *   4. 关闭时先 stopAll 再 setEnabled(false)，静音立刻生效；
 *   5. `play()` 返回 null、destroy 之后调用，都不能炸。
 *
 * 这里用一个假的 UISFXPlayer 记录调用，不碰 Web Audio。
 */

function createFakePlayer(options: { returnNull?: boolean } = {}) {
  const calls = {
    cues: [] as string[],
    plays: [] as Array<{ cue: string; options?: unknown }>,
    ops: [] as string[],
    unlock: 0,
    destroy: 0,
    stopped: 0,
  };
  /** `unlock()` 的结果：模拟 iOS 打断之后「非手势里 resume 不成功」。 */
  const state = { unlockOk: true };
  let enabled = true;
  let volume = 0.7;

  const player: UISFXPlayer = {
    async unlock() {
      calls.unlock += 1;
      calls.ops.push("unlock");
      return state.unlockOk;
    },
    play(cue, playOptions) {
      calls.cues.push(cue);
      calls.plays.push({ cue, options: playOptions });
      if (options.returnNull) return null;
      return {
        stop() {},
        ended: Promise.resolve(),
      } satisfies PlayingSFX;
    },
    async preload() {},
    setPack() {},
    getPack() {
      return SOUND_PACK;
    },
    setVolume(next) {
      volume = next;
      calls.ops.push(`volume:${next}`);
    },
    getVolume() {
      return volume;
    },
    setEnabled(next) {
      enabled = next;
      calls.ops.push(`enabled:${next}`);
    },
    isEnabled() {
      return enabled;
    },
    stopAll() {
      calls.stopped += 1;
      calls.ops.push("stopAll");
    },
    async destroy() {
      calls.destroy += 1;
      calls.ops.push("destroy");
    },
  };

  return { player, calls, state };
}

function createFakeTarget() {
  const listeners = new Map<string, EventListener>();
  const target: SoundGestureTarget = {
    addEventListener(type, listener) {
      listeners.set(type, listener as EventListener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  return {
    target,
    fire(type: string) {
      listeners.get(type)?.(new Event(type));
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

/**
 * 每个 service 都会往真实的 document / window 上挂「回到前台」监听。
 * 测试之间不清理就会互相串（A 的假播放器被 B 的事件戳到），所以统一收尾。
 */
const live: SoundService[] = [];

afterEach(async () => {
  while (live.length > 0) await live.pop()!.dispose();
  // 还原 visibilityState（测试里用 defineProperty 覆写过）
  delete (document as { visibilityState?: string }).visibilityState;
});

function setup(options: {
  enabled?: boolean;
  volume?: number;
  returnNull?: boolean;
} = {}) {
  const fake = createFakePlayer({ returnNull: options.returnNull });
  const prefs: SoundPreferences = {
    soundEnabled: options.enabled ?? true,
    soundVolume: options.volume ?? 0.7,
  };
  const createPlayer = vi.fn(() => fake.player);
  const service = createSoundService({
    getPreferences: () => prefs,
    createPlayer,
  });
  live.push(service);
  return { service, prefs, createPlayer, ...fake };
}

describe("语义事件 → cue", () => {
  it("每个 cue 都在 uisfx catalog 里，而且不是循环", () => {
    for (const [event, cue] of Object.entries(SOUND_CUES)) {
      expect(cueNames, `${event} 指向了不存在的 cue`).toContain(cue);
      expect(getPlaybackMode(cue), `${event} 用了循环 cue`).toBe("one-shot");
    }
  });

  it("每个 cue 都能被 minimal 包渲染出来（不是只存在于 catalog）", () => {
    for (const cue of Object.values(SOUND_CUES)) {
      const recipe = createRecipe(SOUND_PACK, cue);
      expect(recipe.duration, `${cue} 在 ${SOUND_PACK} 包里没有声音`).toBeGreaterThan(0);
      expect(recipe.notes.length).toBeGreaterThan(0);
    }
  });

  it("没有任何事件复用「按住不放」类的循环 cue", () => {
    const loops = new Set([
      "loading",
      "processing",
      "recording",
      "connecting",
      "scanning",
      "streaming",
    ]);
    for (const cue of Object.values(SOUND_CUES)) {
      expect(loops.has(cue)).toBe(false);
    }
  });
});

describe("手势解锁", () => {
  it("手势之前不创建播放器、也不出声", () => {
    const { service, createPlayer, calls } = setup();

    expect(service.play("answer-correct")).toBe(false);
    expect(createPlayer).not.toHaveBeenCalled();
    expect(calls.cues).toEqual([]);
  });

  it("第一次 pointerdown 解锁后，同一次交互就能出声", async () => {
    const { service, createPlayer, calls } = setup();
    const gesture = createFakeTarget();

    service.attachUnlockGesture(gesture.target);
    gesture.fire("pointerdown");

    expect(service.play("bank-switch")).toBe(true);
    expect(calls.cues).toEqual(["select"]);
    expect(calls.unlock).toBe(1);

    await Promise.resolve();
    // 播放器只创建一次，后续事件复用它
    expect(createPlayer).toHaveBeenCalledTimes(1);
    expect(createPlayer.mock.calls[0]?.[0]).toMatchObject({
      pack: SOUND_PACK,
      enabled: true,
      volume: 0.7,
    });
  });

  it("重复 attach 是幂等的，解绑后监听全部摘掉", () => {
    const { service } = setup();
    const gesture = createFakeTarget();

    const first = service.attachUnlockGesture(gesture.target);
    const second = service.attachUnlockGesture(gesture.target);
    expect(second).toBe(first);
    expect(gesture.listenerCount).toBe(3); // pointerdown / keydown / click

    first();
    expect(gesture.listenerCount).toBe(0);
  });

  it("没有 Web Audio / play 返回 null 时只是没声音，不抛错", () => {
    const { service, calls } = setup({ returnNull: true });
    const gesture = createFakeTarget();
    service.attachUnlockGesture(gesture.target);
    gesture.fire("click");

    expect(service.play("answer-wrong")).toBe(false);
    expect(calls.cues).toEqual(["error"]);
  });

  it("单次播放的声学选项原样交给播放器", () => {
    const { service, calls } = setup();
    const gesture = createFakeTarget();
    service.attachUnlockGesture(gesture.target);
    gesture.fire("pointerdown");

    expect(
      service.play("heatmap-hover", {
        cooldownMs: 55,
        retrigger: "restart",
      }),
    ).toBe(true);
    expect(calls.plays.at(-1)).toEqual({
      cue: "hover",
      options: { cooldownMs: 55, retrigger: "restart" },
    });
  });
});

describe("回到前台重新解锁（iOS 切后台后静音）", () => {
  function setVisibility(next: "visible" | "hidden"): void {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => next,
    });
  }

  /** 装好手势监听并完成第一次解锁（= 正常在用）。 */
  async function startPlaying() {
    const ctx = setup();
    const gesture = createFakeTarget();
    const detach = ctx.service.attachUnlockGesture(gesture.target);
    gesture.fire("pointerdown");
    await Promise.resolve();
    expect(ctx.calls.unlock).toBe(1);
    return { ...ctx, gesture, detach };
  }

  it("回到前台先顺手恢复一次，不用等用户点", async () => {
    const { calls } = await startPlaying();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(calls.unlock, "回到前台要重新 resume 一次").toBe(2);
  });

  it("前台自动恢复失败时，下一次手势必须再解一次", async () => {
    const { calls, gesture, state } = await startPlaying();
    // iOS 打断之后，不在手势里的 resume 往往不成功
    state.unlockOk = false;

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
    expect(calls.unlock, "先试一次").toBe(2);

    gesture.fire("pointerdown");
    await Promise.resolve();
    expect(calls.unlock, "resume 只在手势里被接受，必须再试").toBe(3);
  });

  it("还在后台（hidden）时不动解锁状态", async () => {
    const { calls } = await startPlaying();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(calls.unlock).toBe(1);
  });

  it("pageshow（从 bfcache 回来）同样重新解锁", async () => {
    const { calls } = await startPlaying();

    window.dispatchEvent(new Event("pageshow"));
    await Promise.resolve();

    expect(calls.unlock).toBe(2);
  });

  it("解绑之后回到前台不再解锁", async () => {
    const { calls, detach } = await startPlaying();
    detach();

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    await Promise.resolve();

    expect(calls.unlock).toBe(1);
  });

  it("还没播过东西时回到前台，不会凭空创建播放器", async () => {
    const { service, createPlayer } = setup();
    service.attachUnlockGesture(createFakeTarget().target);

    window.dispatchEvent(new Event("pageshow"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();

    expect(createPlayer).not.toHaveBeenCalled();
  });
});

describe("开关与音量", () => {
  it("关闭时先 stopAll 再 setEnabled(false)", () => {
    const { service, prefs, calls } = setup();
    const gesture = createFakeTarget();
    service.attachUnlockGesture(gesture.target);
    gesture.fire("pointerdown");

    expect(service.play("answer-correct")).toBe(true);
    calls.ops.length = 0;

    prefs.soundEnabled = false;
    service.applyPreferences(prefs);

    expect(calls.ops).toEqual(["stopAll", "enabled:false"]);
    expect(service.play("answer-correct")).toBe(false);
    expect(calls.cues).toEqual(["check"]);
  });

  it("音量变化会同步到播放器，并被钳到 0–1", () => {
    const { service, prefs, calls } = setup();
    const gesture = createFakeTarget();
    service.attachUnlockGesture(gesture.target);
    gesture.fire("pointerdown");
    service.play("answer-correct");

    prefs.soundVolume = 1.5;
    service.applyPreferences(prefs);
    expect(calls.ops.at(-1)).toBe("volume:1");

    prefs.soundVolume = -2;
    service.applyPreferences(prefs);
    expect(calls.ops.at(-1)).toBe("volume:0");
  });

  it("播放时读到的最新偏好会补同步（不依赖 App 的 effect）", () => {
    const { service, prefs, calls } = setup();
    const gesture = createFakeTarget();
    service.attachUnlockGesture(gesture.target);
    gesture.fire("pointerdown");

    prefs.soundVolume = 0.25;
    service.play("answer-correct");
    expect(calls.ops).toContain("volume:0.25");
  });
});

describe("释放", () => {
  it("dispose 会解绑手势、销毁播放器，之后不再出声", async () => {
    const { service, calls } = setup();
    const gesture = createFakeTarget();
    service.attachUnlockGesture(gesture.target);
    gesture.fire("pointerdown");
    service.play("answer-correct");

    await service.dispose();

    expect(calls.destroy).toBe(1);
    expect(gesture.listenerCount).toBe(0);
    expect(service.play("answer-correct")).toBe(false);
    expect(calls.cues).toEqual(["check"]);
  });

  it("dispose 可以重复调用", async () => {
    const { service, calls } = setup();
    await service.dispose();
    await service.dispose();
    expect(calls.destroy).toBe(0); // 没创建过播放器就没什么可销毁的
  });
});
