import { describe, expect, it } from "vitest";
import { shouldScrollRail } from "../src/components/overview/rail.svelte";
import {
    OVERVIEW_CELL_ROWS,
    OVERVIEW_HEATMAP_HEIGHT,
    OVERVIEW_RAIL_HEIGHT,
} from "../src/config/overview";

/**
 * 顶部横向 rail：滚轮接管规则 + 版面常量自洽。
 *
 * 翻页数学（`railMath.ts`）已随左右箭头一起删掉，这里不再有那部分。
 */

/** `shouldScrollRail` 只读 ctrlKey / deltaX / deltaY，不需要真的构造 DOM 事件 */
function wheel(deltaX: number, deltaY: number, ctrlKey = false): WheelEvent {
    return { deltaX, deltaY, ctrlKey } as unknown as WheelEvent;
}

describe("shouldScrollRail", () => {
    it("鼠标滚轮：纯纵向就接管（不管增量是整数还是小数）", () => {
        expect(shouldScrollRail(wheel(0, 100), false)).toBe(true);
        expect(shouldScrollRail(wheel(0, -4), false)).toBe(true);
        // 平滑滚动鼠标给的是小数，也要接管——按「整数 / 小数」分辨设备会把它漏掉
        expect(shouldScrollRail(wheel(0, 1.5), false)).toBe(true);
    });

    it("带横向分量：交给原生（两个逻辑同时滚同一根轴会抽搐）", () => {
        expect(shouldScrollRail(wheel(12, 0), false)).toBe(false);
        expect(shouldScrollRail(wheel(12, 8), false)).toBe(false);
    });

    it("见过斜滑之后：纵向滑动不再翻这一排", () => {
        expect(shouldScrollRail(wheel(0, 100), true)).toBe(false);
    });

    it("捏合缩放（ctrlKey）不拦", () => {
        expect(shouldScrollRail(wheel(0, 100, true), false)).toBe(false);
    });

    it("增量为 0 不接管", () => {
        expect(shouldScrollRail(wheel(0, 0), false)).toBe(false);
    });
});

describe("热力图版面常量自洽", () => {
    it("每列的格子装得进 rail 高度（改高度 / 格子尺寸时必须重算行数）", () => {
        // 卡片上下内边距 12×2、标题行 16、标题与格子的间距 8 —— 与 HeatmapCard 一致
        const available = OVERVIEW_RAIL_HEIGHT - 12 * 2 - 16 - 8;
        expect(
            OVERVIEW_HEATMAP_HEIGHT,
            `${OVERVIEW_CELL_ROWS} 行需要 ${OVERVIEW_HEATMAP_HEIGHT}px，只剩 ${available}px`,
        ).toBeLessThanOrEqual(available);
    });

    it("每列至少 3 格，否则热力图会胖得离谱", () => {
        expect(OVERVIEW_CELL_ROWS).toBeGreaterThanOrEqual(3);
    });
});
