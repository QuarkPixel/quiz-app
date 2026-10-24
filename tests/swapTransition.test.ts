import { describe, expect, it } from "vitest";
import { cubicOut } from "svelte/easing";
import {
    SWAP_LEAVING_ATTR,
    swapIn,
    swapOut,
} from "../src/lib/transitions/swap";

/**
 * 「换一屏」过渡（换题 / 换题库 / 记忆模式进出学习·复习，三处共用）。
 *
 * 这一对函数出过一个很不显眼的坑：Svelte 5 把过渡的 `css` 字符串转成 **Web
 * Animations 关键帧**（`element.animate`），而 WAAPI 只认可动画属性——写进 `css`
 * 的 `position` / `inset` / `pointer-events` 会被**静默丢掉**。于是退场层留在文档
 * 流里，新旧两层挤在一起各占一半高度，换屏时内容看着像「跳到左上 / 左下角」。
 *
 * 所以这里钉住三条约定：
 *   1. 退场层的定位由**内联样式**负责（不是 `css`）；
 *   2. `css` 里只有真正能动画的属性；
 *   3. 缓动是缓动，不是 Svelte 默认的 `linear`。
 */
describe("换屏过渡", () => {
    it("退场层用内联样式脱离文档流", () => {
        const node = document.createElement("div");

        swapOut(node);

        expect(node.style.position).toBe("absolute");
        expect(node.getAttribute(SWAP_LEAVING_ATTR)).toBe("true");
    });

    it("css 里只出现可动画属性", () => {
        const node = document.createElement("div");
        const config = swapOut(node);

        const css = config.css(0.5);

        expect(css).toContain("opacity:0.5");
        // 0.95 + 0.05 * 0.5
        expect(css).toContain("scale:0.975");
        // 这三个写进 css 会被 WAAPI 丢掉，必须留在内联样式里
        expect(css).not.toContain("position");
        expect(css).not.toContain("inset");
        expect(css).not.toContain("pointer-events");
    });

    it("进场清掉复用节点上的退场样式", () => {
        const node = document.createElement("div");

        swapOut(node);
        swapIn(node);

        expect(node.style.position).toBe("");
        expect(node.style.inset).toBe("");
    });

    it("两个方向都吃 cubicOut，而不是默认的线性", () => {
        const node = document.createElement("div");

        expect(swapIn(node).easing).toBe(cubicOut);
        expect(swapOut(node).easing).toBe(cubicOut);
    });

    it("默认时长取同一个常量", () => {
        const node = document.createElement("div");

        expect(swapIn(node).duration).toBe(swapOut(node).duration);
    });
});
