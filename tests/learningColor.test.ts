import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

import {
  LEARNING_COLOR_HEX,
  getLearningColorPaletteHex,
  mixLearningColorHex,
} from "../src/features/quiz/learningProgress";

// vitest 跑在项目根目录
const appCss = readFileSync(resolve("src/app.css"), "utf8");

/** 取样式表里某个变量按出现顺序的所有值（先浅色 :root，后深色媒体查询）。 */
function cssVarValues(name: string): string[] {
  return [...appCss.matchAll(new RegExp(`--${name}:\\s*([^;]+);`, "g"))].map(
    (match) => match[1].trim(),
  );
}

describe("学习色带", () => {
  test("app.css 里的端点没人偷偷改掉", () => {
    // 颜色链条：--learning-color-low/high → --success / --warning
    expect(cssVarValues("learning-color-low")).toEqual(["var(--success)"]);
    expect(cssVarValues("learning-color-high")).toEqual(["var(--warning)"]);

    const success = cssVarValues("success");
    const warning = cssVarValues("warning");
    expect(success.length).toBeGreaterThanOrEqual(2);
    expect(warning.length).toBeGreaterThanOrEqual(2);

    expect(LEARNING_COLOR_HEX.light.low).toBe(success[0]);
    expect(LEARNING_COLOR_HEX.light.high).toBe(warning[0]);
    // 第二条是暗色媒体查询里的值
    expect(LEARNING_COLOR_HEX.dark.low).toBe(success[1]);
    expect(LEARNING_COLOR_HEX.dark.high).toBe(warning[1]);
  });

  test("两端点就是 low / high（t 的方向和 mixLearningColor 一致）", () => {
    expect(mixLearningColorHex(0)).toBe(LEARNING_COLOR_HEX.light.low);
    expect(mixLearningColorHex(1)).toBe(LEARNING_COLOR_HEX.light.high);
    expect(mixLearningColorHex(0, LEARNING_COLOR_HEX.dark.high, LEARNING_COLOR_HEX.dark.low)).toBe(
      LEARNING_COLOR_HEX.dark.low,
    );
    expect(mixLearningColorHex(1, LEARNING_COLOR_HEX.dark.high, LEARNING_COLOR_HEX.dark.low)).toBe(
      LEARNING_COLOR_HEX.dark.high,
    );
    // t 越界按端点截断
    expect(mixLearningColorHex(-3)).toBe(LEARNING_COLOR_HEX.light.low);
    expect(mixLearningColorHex(9)).toBe(LEARNING_COLOR_HEX.light.high);
  });

  test("中间值就是 OKLCH 插值的结果", () => {
    // 期望值来自 colorjs.io 的 oklch 插值（与 color-mix 同一套规则）：
    // t 从 0 到 1 每 0.01 取一点，两边逐通道完全一致。
    // 等价于 color-mix(in oklch, #81912f 50%, #e59f41 50%)
    expect(mixLearningColorHex(0.25)).toBe("#9b9528");
    expect(mixLearningColorHex(0.5)).toBe("#b59927");
    expect(mixLearningColorHex(0.75)).toBe("#ce9c30");
    expect(
      mixLearningColorHex(0.5, LEARNING_COLOR_HEX.dark.high, LEARNING_COLOR_HEX.dark.low),
    ).toBe("#ccb848");
  });

  test("认不出的色值退回更重的一端，不抛错", () => {
    expect(mixLearningColorHex(0.9, "not-a-color", "#000000")).toBe("not-a-color");
    expect(mixLearningColorHex(0.1, "#ffffff", "rgb(0 0 0)")).toBe("rgb(0 0 0)");
  });

  test("调色板：16 个值，从浅到深两头对齐端点", () => {
    const palette = getLearningColorPaletteHex(16);
    expect(palette).toHaveLength(16);
    expect(palette[0]).toBe(LEARNING_COLOR_HEX.light.low);
    expect(palette[15]).toBe(LEARNING_COLOR_HEX.light.high);
    expect(new Set(palette).size).toBe(16);
    for (const color of palette) expect(color).toMatch(/^#[0-9a-f]{6}$/);

    const dark = getLearningColorPaletteHex(16, "dark");
    expect(dark[0]).toBe(LEARNING_COLOR_HEX.dark.low);
    expect(dark[15]).toBe(LEARNING_COLOR_HEX.dark.high);

    expect(getLearningColorPaletteHex(1)).toEqual([LEARNING_COLOR_HEX.light.low]);
    expect(getLearningColorPaletteHex(0)).toEqual([LEARNING_COLOR_HEX.light.low]);
  });

  test("调色板从头到尾单调变亮", () => {
    const luminance = (hex: string): number => {
      const channels = [1, 3, 5].map(
        (index) => parseInt(hex.slice(index, index + 2), 16) / 255,
      );
      const [r, g, b] = channels.map((channel) =>
        channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    for (const scheme of ["light", "dark"] as const) {
      const values = getLearningColorPaletteHex(16, scheme).map(luminance);
      for (let index = 1; index < values.length; index += 1) {
        expect(values[index]).toBeGreaterThan(values[index - 1]);
      }
    }
  });
});
