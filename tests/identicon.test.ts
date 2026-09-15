/**
 * identicon 组件（DiceBear「slice」）的渲染契约。
 *
 * 这一层盯的是几个容易悄悄坏掉的地方：
 *   - 颜色必须来自 learningProgress 那条色带（换主题、换配色不能跑成黑白色块）
 *   - 同一个 seed 稳定出同一张图，不同 seed 出不同形状
 *   - 一页上并排多张时 defs id 不能撞车（撞了 `<use>` 会互相串味）
 *   - 尺寸是写死的像素，写进 svg 的 width/height（曾被"撑满行高"的 CSS 坑过一次）
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { flushSync, mount, unmount } from "svelte";

import Identicon from "../src/components/Identicon.svelte";
import {
  identiconReady,
  preloadIdenticon,
  renderIdenticon,
} from "../src/lib/identicon";
import { getLearningColorPaletteHex } from "../src/features/quiz/learningProgress";

let target: HTMLElement;
const mounted: ReturnType<typeof mount>[] = [];

function render(seed: string, size?: number): HTMLElement {
  const host = document.createElement("div");
  target.appendChild(host);
  mounted.push(mount(Identicon, { target: host, props: { seed, size } }));
  flushSync();
  return host;
}

/** slice 风格自带的叠加色：白色高光、黑色阴影，以及我们设的透明底。 */
const STYLE_TINTS = new Set(["ffffff", "000000", "00000000"]);

/** 一张图用到的所有字面色值（不含 fill="none" / currentColor）。 */
function usedColors(host: HTMLElement): string[] {
  const colors = new Set<string>();
  for (const element of host.querySelectorAll("*")) {
    for (const name of ["fill", "color", "stroke"]) {
      const value = element.getAttribute(name);
      if (value?.startsWith("#")) colors.add(value.slice(1).toLowerCase());
    }
  }
  return [...colors];
}

function pathData(host: HTMLElement): string[] {
  return [...host.querySelectorAll("path")].map(
    (element) => element.getAttribute("d") ?? "",
  );
}

beforeAll(async () => {
  // 引擎（`@dicebear/core` + 样式）是**动态加载**的：主包不为它买单，
  // 触发点是「用户打开云同步」。这里先手动拉一次，后面的用例就都是同步渲染了。
  await preloadIdenticon();
});

beforeEach(() => {
  target = document.createElement("div");
  document.body.appendChild(target);
});

afterEach(() => {
  for (const app of mounted.splice(0)) unmount(app);
  target.remove();
});

describe("identicon", () => {
  test("画得出一张 100×100 的 svg，并且只是装饰", () => {
    const host = render("3yuenz83");
    const svg = host.querySelector("svg");

    expect(svg, "应该有 svg").not.toBeNull();
    expect(svg?.getAttribute("viewBox")).toBe("0 0 100 100");
    // 旁边两行文字已经把这条说清楚了，图不参与朗读
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    expect(host.innerHTML).not.toMatch(/NaN|undefined|Infinity/);
  });

  test("主体色只从学习色带里取", () => {
    const palette = new Set(
      getLearningColorPaletteHex(16, "light").map((color) =>
        color.slice(1).toLowerCase(),
      ),
    );
    const colors = usedColors(render("g1234567890"));

    for (const color of colors) {
      if (STYLE_TINTS.has(color)) continue;
      expect(palette, `#${color} 不在色带里`).toContain(color);
    }
    expect(
      colors.filter((color) => palette.has(color)),
      "至少要真的用上一个色带里的颜色",
    ).not.toHaveLength(0);
  });

  test("同一个 seed 稳定，不同 seed 换形状", () => {
    const first = pathData(render("same-seed"));
    const second = pathData(render("same-seed"));
    const other = pathData(render("other-seed"));

    expect(first.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(other).not.toEqual(first);
  });

  test("同一页上多张图，id 不能撞车", () => {
    for (const seed of ["a", "b", "c", "d"]) render(seed);

    const ids = [...target.querySelectorAll("[id]")].map(
      (element) => element.id,
    );
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);

    // 引用的 id 必须都能在页面上找到，否则形状会整块丢
    for (const reference of target.querySelectorAll("[clip-path], use")) {
      const raw =
        reference.getAttribute("clip-path") ??
        reference.getAttribute("href") ??
        "";
      if (!raw.startsWith("#")) continue;
      expect(
        target.querySelector(`[id="${raw.slice(1)}"]`),
        `${raw} 找不到对应元素`,
      ).not.toBeNull();
    }
  });

  test("引擎只加载一次：重复调用共用同一个 Promise，加载完就能同步画", async () => {
    expect(identiconReady()).toBe(true);

    const first = preloadIdenticon();
    const second = preloadIdenticon();
    expect(second, "不该重复下载").toBe(first);
    await first;

    expect(renderIdenticon({ seed: "x", size: 30, scheme: "light" })).toContain(
      "<svg",
    );
  });

  test("尺寸写进 svg 的 width/height，默认 30", () => {
    const fallback = render("3yuenz83").querySelector("svg");
    expect(fallback?.getAttribute("width")).toBe("30");
    expect(fallback?.getAttribute("height")).toBe("30");

    const custom = render("3yuenz83", 48).querySelector("svg");
    expect(custom?.getAttribute("width")).toBe("48");
    expect(custom?.getAttribute("height")).toBe("48");
  });
});
