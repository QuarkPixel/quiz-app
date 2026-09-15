/**
 * 版面常量：断点、层级。
 *
 * 这些值以前散在各组件里——两个视图各写一遍 `63.99rem` 的 matchMedia，
 * z-index 只在注释里约定「谁盖谁」。集中到这里之后：
 *
 *   - CSS 里的 `@media (min-width: …)` 与 JS 里的 `MediaQuery` 用同一个字符串，
 *     不会出现「CSS 改了、JS 没改」；
 *   - 浮层层级只在 `app.css` 的 `--z-*` 变量里定义一次，组件引用变量名。
 */

/**
 * 窄版面的上界（含）：答题区与底部工具栏改成上下堆叠。
 *
 * 用 `63.99rem` 而不是 `64rem`：`max-width` 与 `min-width` 在同一个断点上
 * 必须刚好错开，否则 1024px 那一档会两边都命中。
 */
export const COMPACT_LAYOUT_MAX_WIDTH = "63.99rem";

/** 宽版面的下界：与 `COMPACT_LAYOUT_MAX_WIDTH` 是同一个断点的两侧。 */
export const DESKTOP_LAYOUT_MIN_WIDTH = "64rem";

/**
 * 直接喂给 `matchMedia` / Svelte 的 `MediaQuery` 的查询串。
 *
 * 用法：`const compact = new MediaQuery(COMPACT_LAYOUT_QUERY)`——
 * 别再自己写 `addEventListener("change", …)` 那一套。
 */
export const COMPACT_LAYOUT_QUERY = `(max-width: ${COMPACT_LAYOUT_MAX_WIDTH})`;

/**
 * 浮层层级（对应 `app.css` 里的 `--z-*` 变量）。
 *
 * Tailwind 里用 `z-(--z-dialog)` 这种写法引用，改这里就等于全局改层级。
 * 数值之间的空隙是留给第三方浮层的（bits-ui 的 Select / Popover 默认 `z-50`，
 * 必须落在 Dialog 之下、内容之上）。
 */
export const Z_LAYER = {
  /** 视图内固定在顶部 / 底部的渐变遮罩与工具条 */
  contentChrome: "--z-content-chrome",
  /** shadcn Dialog（设置 / 总览） */
  dialog: "--z-dialog",
  /** 说明抽屉：要盖住 Dialog，但低于 Toast */
  drawer: "--z-drawer",
  /** Tooltip 与 Toast */
  tooltip: "--z-tooltip",
  toast: "--z-toast",
  /** 侧边栏拖拽 / 导入时的全屏遮罩 */
  blocker: "--z-blocker",
  /** 答题对错的整屏闪烁：永远在最上面 */
  flash: "--z-flash",
} as const;
