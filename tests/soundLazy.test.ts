import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `appSound` 是**懒加载门面**：uisfx（合成器 + 配方）不在主包里，页面空闲后
 * 才 `import()`。这里守三条契约：
 *
 *   1. 引擎没加载时 `play()` 返回 false、不创建引擎（页面照常能用，只是没声）；
 *   2. 加载之后所有调用原样转给引擎，而且只创建一个；
 *   3. 页面空下来会自己加载，不用等业务调用。
 *
 * 真正的播放 / 解锁逻辑在 `tests/sound.test.ts`，这里只测路由。
 */

interface FakeService {
  play: ReturnType<typeof vi.fn>;
  applyPreferences: ReturnType<typeof vi.fn>;
  attachUnlockGesture: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

const created: FakeService[] = [];

vi.mock("../src/sound/service", () => ({
  createSoundService: vi.fn(() => {
    const service: FakeService = {
      play: vi.fn(() => true),
      applyPreferences: vi.fn(),
      attachUnlockGesture: vi.fn(() => () => {}),
      dispose: vi.fn(async () => {}),
    };
    created.push(service);
    return service;
  }),
}));

beforeEach(() => {
  // 模块顶层会排一个「页面空闲再加载」的定时器；没人驱动就不该自己跑，
  // 否则上一个用例的实例会飘到下一个用例的断言里。
  vi.useFakeTimers();
  created.length = 0;
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

async function loadFacade() {
  return import("../src/sound/app");
}

describe("音效引擎懒加载", () => {
  it("加载之前 play 返回 false，也不创建引擎", async () => {
    const { appSound } = await loadFacade();

    expect(appSound.play("answer-correct")).toBe(false);
    expect(created, "没有引擎可建：这一步必须零成本").toHaveLength(0);
  });

  it("页面空下来会自己加载（不用等业务调用）", async () => {
    const { appSound } = await loadFacade();
    expect(created).toHaveLength(0);

    // happy-dom 没有 requestIdleCallback，走的是 setTimeout 兜底
    await vi.advanceTimersByTimeAsync(200);

    expect(created, "空闲后应该已经把引擎拉起来了").toHaveLength(1);
    expect(appSound.play("answer-correct")).toBe(true);
  });

  it("加载之后转给引擎：事件、选项、偏好原样传下去", async () => {
    const { appSound, preloadSound } = await loadFacade();
    await preloadSound();

    const engine = created[0]!;
    expect(engine.attachUnlockGesture, "解锁监听随引擎一起装").toHaveBeenCalled();

    expect(appSound.play("heatmap-hover", { cooldownMs: 55 })).toBe(true);
    expect(engine.play).toHaveBeenCalledWith("heatmap-hover", {
      cooldownMs: 55,
    });

    const prefs = { soundEnabled: false, soundVolume: 0.4 };
    appSound.applyPreferences(prefs);
    expect(engine.applyPreferences).toHaveBeenCalledWith(prefs);
  });

  it("重复加载只建一个引擎（并发调用也共用同一个 Promise）", async () => {
    const { preloadSound } = await loadFacade();

    await Promise.all([preloadSound(), preloadSound()]);
    await preloadSound();

    expect(created).toHaveLength(1);
  });

  it("加载之前调 applyPreferences 不抛错（偏好由引擎创建时现读）", async () => {
    const { appSound } = await loadFacade();

    expect(() =>
      appSound.applyPreferences({ soundEnabled: true, soundVolume: 0.8 }),
    ).not.toThrow();
    expect(created).toHaveLength(0);
  });
});
