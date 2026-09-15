import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  APP_SHORTCUTS,
  LISTED_SHORTCUTS,
  SHORTCUT_IDS,
  UNLISTED_SHORTCUTS,
  Z_LAYER,
} from "../src/config";

/**
 * 配置层的护栏。
 *
 * 这些常量本身没有逻辑，但它们**必须和别处的真源对得上**：
 *   - 快捷键注册表 ↔ `features/appShortcuts.ts` 的分发表（那边靠 `Record<ShortcutId, …>`
 *     在编译期约束，这里补上「说明表有没有漏」这一半）
 *   - 层级名表 ↔ `app.css` 里的 `--z-*` 实际取值（改了名字没改 CSS 就会渲染错层）
 *
 * 有了这两条，新增一个快捷键 / 一层浮层时不会再出现「一边加了、另一边忘了」。
 */

describe("快捷键注册表", () => {
  test("每个快捷键都登记了展示用的按键与说明", () => {
    for (const id of SHORTCUT_IDS) {
      const meta = APP_SHORTCUTS[id];
      expect(meta, `${id} 缺少 APP_SHORTCUTS 条目`).toBeDefined();
      expect(meta.kbd.length, `${id} 的 kbd 为空`).toBeGreaterThan(0);
      expect(meta.label.length, `${id} 的说明为空`).toBeGreaterThan(0);
    }
  });

  test("说明面板的清单既不漏也不重", () => {
    const listed = [...LISTED_SHORTCUTS];
    expect(new Set(listed).size, "LISTED_SHORTCUTS 里有重复项").toBe(
      listed.length,
    );

    const union = [...listed, ...UNLISTED_SHORTCUTS].sort();
    expect(
      union,
      "新增了快捷键却没决定要不要在设置面板里列出（LISTED / UNLISTED 二选一）",
    ).toEqual([...SHORTCUT_IDS].sort());
  });
});

describe("浮层层级阶梯", () => {
  /**
   * 从 app.css 里把 `--z-xxx: <数字>` 全部抠出来（按出现顺序）。
   *
   * 不能用「`@media` 之前那段就是 :root」这种切法：文件第 3 行的
   * `@custom-variant dark (@media …)` 会先撞上。
   */
  function cssLayerValues(): Record<string, number[]> {
    // vitest 跑在项目根目录（与 `tests/learningColor.test.ts` 同一做法）
    const css = readFileSync(resolve("src/app.css"), "utf8");
    const layers: Record<string, number[]> = {};
    for (const match of css.matchAll(/(--z-[a-z-]+):\s*(\d+)/g)) {
      (layers[match[1]] ??= []).push(Number(match[2]));
    }
    return layers;
  }

  test("名字表里的每一层都在 app.css 里有取值，且只定义一次", () => {
    const layers = cssLayerValues();
    for (const name of Object.values(Z_LAYER)) {
      expect(layers[name], `app.css 里缺少 ${name}`).toBeDefined();
      // 层级是结构性的，不该跟着深浅色主题各写一份（写两份迟早只改一处）
      expect(layers[name].length, `${name} 被定义了多次`).toBe(1);
    }
  });

  test("层级严格递增：内容 < Dialog < 抽屉 < Tooltip/Toast < 遮罩 < 闪烁", () => {
    const layers = cssLayerValues();
    const ladder = [
      Z_LAYER.contentChrome,
      Z_LAYER.dialog,
      Z_LAYER.drawer,
      Z_LAYER.tooltip,
      Z_LAYER.blocker,
      Z_LAYER.flash,
    ];
    for (let i = 1; i < ladder.length; i++) {
      expect(
        layers[ladder[i]][0],
        `${ladder[i]} 必须高于 ${ladder[i - 1]}`,
      ).toBeGreaterThan(layers[ladder[i - 1]][0]);
    }
  });

  test("Tooltip 与 Toast 同层（Toast 在 Tooltip 之上由 DOM 顺序保证，不靠数值）", () => {
    const layers = cssLayerValues();
    expect(layers[Z_LAYER.toast][0]).toBe(layers[Z_LAYER.tooltip][0]);
  });

  test("组件里不再有裸的 z-[数字]：浮层一律引用层级变量", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".svelte")) continue;
        const source = readFileSync(full, "utf8");
        for (const match of source.matchAll(/z-\[(\d+)\]/g)) {
          offenders.push(`${full}: z-[${match[1]}]`);
        }
      }
    };
    walk(resolve("src"));

    expect(
      offenders,
      "这些地方写死了层级：改用 `z-(--z-…)`（见 src/app.css 的阶梯）",
    ).toEqual([]);
  });
});
