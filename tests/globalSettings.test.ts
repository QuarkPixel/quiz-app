import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createDefaultGlobalSettings,
  sanitizeGlobalSettings,
} from "../src/globalSettings";
import { globalSettingsStore } from "../src/features/globalSettings.svelte";
import { STORAGE_KEY_GENERAL } from "../src/config";

beforeEach(() => {
  localStorage.clear();
  globalSettingsStore.reload();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  globalSettingsStore.reload();
});

describe("sanitizeGlobalSettings", () => {
  it("缺失 / 非对象时回落到代码默认值", () => {
    expect(sanitizeGlobalSettings(undefined)).toEqual(
      createDefaultGlobalSettings(),
    );
    expect(sanitizeGlobalSettings(null)).toEqual(createDefaultGlobalSettings());
    expect(sanitizeGlobalSettings("nope")).toEqual(
      createDefaultGlobalSettings(),
    );
  });

  it("只接受 boolean，其他值回退默认", () => {
    expect(
      sanitizeGlobalSettings({
        soundEnabled: true,
        autoSubmitOnSelection: false,
        autoNextOnCorrect: true,
      }),
    ).toEqual({
      soundEnabled: true,
      autoSubmitOnSelection: false,
      autoNextOnCorrect: true,
    });

    const defaults = createDefaultGlobalSettings();
    expect(
      sanitizeGlobalSettings({
        soundEnabled: 1,
        autoSubmitOnSelection: "yes",
        autoNextOnCorrect: 0,
      }),
    ).toEqual(defaults);
  });
});

describe("globalSettingsStore", () => {
  it("update 会合并并写回 general 配置的 globalSettings", () => {
    globalSettingsStore.update({ autoNextOnCorrect: true });

    expect(globalSettingsStore.value.autoNextOnCorrect).toBe(true);
    const general = JSON.parse(
      localStorage.getItem(STORAGE_KEY_GENERAL) ?? "{}",
    );
    expect(general.globalSettings.autoNextOnCorrect).toBe(true);
  });

  it("reload 会读取 external 写入的 general 配置", () => {
    localStorage.setItem(
      STORAGE_KEY_GENERAL,
      JSON.stringify({
        globalSettings: {
          soundEnabled: true,
          autoSubmitOnSelection: false,
          autoNextOnCorrect: true,
        },
      }),
    );

    globalSettingsStore.reload();

    expect(globalSettingsStore.value).toEqual({
      soundEnabled: true,
      autoSubmitOnSelection: false,
      autoNextOnCorrect: true,
    });
  });

  it("配额异常时不抛错", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceeded");
      });

    expect(() =>
      globalSettingsStore.update({ soundEnabled: true }),
    ).not.toThrow();
    expect(warn).toHaveBeenCalled();
    setItem.mockRestore();
  });
});
