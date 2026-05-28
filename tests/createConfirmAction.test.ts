import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createConfirmAction } from "../src/lib/hooks/createConfirmAction.svelte";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createConfirmAction", () => {
  it("初始 confirming=false", () => {
    const action = createConfirmAction(() => {});
    expect(action.confirming).toBe(false);
  });

  it("第一次 trigger 进入 confirming，不调用 onConfirm", () => {
    const onConfirm = vi.fn();
    const action = createConfirmAction(onConfirm);
    action.trigger();
    expect(action.confirming).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("第二次 trigger 调用 onConfirm，并复位", () => {
    const onConfirm = vi.fn();
    const action = createConfirmAction(onConfirm);
    action.trigger();
    action.trigger();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(action.confirming).toBe(false);
  });

  it("超时后自动复位 confirming，不调用 onConfirm", () => {
    const onConfirm = vi.fn();
    const action = createConfirmAction(onConfirm, { timeoutMs: 1000 });
    action.trigger();
    vi.advanceTimersByTime(1000);
    expect(action.confirming).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("超时后再 trigger 仍走「第一次」流程", () => {
    const onConfirm = vi.fn();
    const action = createConfirmAction(onConfirm, { timeoutMs: 500 });
    action.trigger();
    vi.advanceTimersByTime(500);
    // 已复位
    action.trigger();
    expect(action.confirming).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reset() 立即清 confirming 且不调用 onConfirm", () => {
    const onConfirm = vi.fn();
    const action = createConfirmAction(onConfirm);
    action.trigger();
    action.reset();
    expect(action.confirming).toBe(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reset 后再 trigger 第二次也需要先到 confirming 才会执行", () => {
    const onConfirm = vi.fn();
    const action = createConfirmAction(onConfirm);
    action.trigger();
    action.reset();
    action.trigger(); // 第一次（reset 之后）
    expect(action.confirming).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
    action.trigger(); // 第二次
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("默认 timeoutMs = CONFIRM_TIMEOUT_MS (3000)", () => {
    const onConfirm = vi.fn();
    const action = createConfirmAction(onConfirm);
    action.trigger();
    vi.advanceTimersByTime(2999);
    expect(action.confirming).toBe(true);
    vi.advanceTimersByTime(1);
    expect(action.confirming).toBe(false);
  });
});
