import { SWAP_MS } from "@/config";
import { cubicOut } from "svelte/easing";

/**
 * 「换一屏」的过渡：旧的一层缩到 95% 淡出，新的一层从 95% 淡入。
 *
 * 应用里所有「同一块位置换内容」的地方共用这一对函数，时长也共用 `SWAP_MS`：
 *   - 换题（刷题 / 记忆）；
 *   - 换题库、记忆模式进出学习 / 复习。
 *
 * 时长刻意很短——它的作用不是「表演」，而是让眼睛知道「换了一屏」，所以短到
 * 几乎察觉不到，只是没有硬切的突兀。
 *
 * 两条曲线都吃同一个 `css`：t 在 `in` 里由 0→1、在 `out` 里由 1→0，
 * 同一段表达式就能同时表达「缩到 0.95 / 从 0.95 长回来」。
 *
 * 缓动统一 `cubicOut`：Svelte 过渡的默认缓动是 **linear**（不写就是匀速），
 * 匀速的淡出淡入看着又平又拖；`cubicOut` 前段快、末段收，同样的时长观感利落得多。
 */
const SCALE_FROM = 0.95;

/** 正在退场的那一层会被打上这个属性（换题时填空题靠它跳过旧输入框） */
export const SWAP_LEAVING_ATTR = "data-swap-leaving";

interface SwapParams {
  duration?: number;
}

/**
 * `css` 里**只能写真正可动画的属性**（`opacity`、`scale`）。
 *
 * Svelte 5 不把 `css` 当成内联样式：它把返回的字符串按 `;` 拆开、转成 camelCase，
 * 拼成 Web Animations 的关键帧数组交给 `element.animate()`（见
 * `svelte/src/internal/client/dom/elements/transitions.js` 的 `css_to_keyframe`）。
 * 而 WAAPI 只认可动画属性，`position` / `inset` / `pointer-events` 这类会被
 * **静默丢掉**——写了也没用，连警告都没有。
 *
 * 早期版本把 `position:absolute;inset:0` 写在这里，结果退场层压根没脱离文档流：
 * 新旧两层一起占位（`flex: 1 1 0%` 的兄弟各分到一半高度），换题库 / 进出复习时
 * 内容会先被挤成上下两半再弹回去，看着就是「定位崩坏、跑到左上 / 左下角」。
 * 所以退场层的定位改成在 `swapOut` 里直接写内联样式，见那里。
 */
function swapCss(t: number): string {
  return `opacity:${t};scale:${SCALE_FROM + (1 - SCALE_FROM) * t};`;
}

/** 新的一层进场：0 → 1，缩放 0.95 → 1 */
export function swapIn(node: Element, params: SwapParams = {}) {
  // 同一个 key 在过渡期间切回来时，Svelte 会**复用**正在退场的那一份 DOM
  // （`BranchManager` 的 resume），它身上还留着 `swapOut` 写的内联样式。
  // 进场先把这些清干净，否则复用回来的那一层会一直是绝对定位。
  clearOutroStyles(node);

  return {
    duration: params.duration ?? SWAP_MS,
    easing: cubicOut,
    css: swapCss,
  };
}

/**
 * 旧的一层退场：1 → 0，缩放 1 → 0.95。
 *
 * **退场的那一层要脱离文档流**（`position: absolute`）：换内容时新旧两层同时在
 * DOM 里（`{#key}` 的 out 过渡不会等它演完），如果都占着位置，容器高度会先变成
 * 两层之和再缩回去——那一下抖动比过渡本身还显眼。绝对定位之后，高度立刻由新内容
 * 决定，旧的那层只是浮在上面淡出。
 *
 * 定位只能写在这里（内联样式），不能写进 `css`——原因见 `swapCss` 上面的注释。
 * 写内联样式的时机是安全的：`{#key}` 的分支是先建新的、再提交旧的退场
 * （`BranchManager.#commit`），两步都在同一次 flush 里、**在浏览器绘制之前**，
 * 所以「两层挤在一起」的那一帧不会被看见。
 */
export function swapOut(node: Element, params: SwapParams = {}) {
  node.setAttribute(SWAP_LEAVING_ATTR, "true");

  const el = node as HTMLElement;
  el.style.position = "absolute";
  el.style.inset = "0";
  el.style.pointerEvents = "none";

  return {
    duration: params.duration ?? SWAP_MS,
    easing: cubicOut,
    css: swapCss,
  };
}

function clearOutroStyles(node: Element): void {
  const el = node as HTMLElement;
  if (el.style === undefined) return;

  el.style.position = "";
  el.style.inset = "";
  el.style.pointerEvents = "";
}
