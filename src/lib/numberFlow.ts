/**
 * `@number-flow/svelte` 的唯一入口（动态加载）。
 *
 * ── 为什么是异步加载的 ─────────────────────────────────────────────────────
 *
 * 这个包约 78 kB（gzip 约 29 kB），而在整个应用里它只服务一件事：把进度条
 * 上方那三个数字从旧值**滚**到新值。首屏看到的那三个数字本身没有任何特殊之处
 * ——用一个 `<span>` 写出来长得一模一样。所以留在主包里，等于让首页和答题界面
 * 白背 29 kB gzip 去换一个用户还没触发过的动画。
 *
 * 做法与 `$lib/identicon.ts` 同构：`preloadNumberFlow()` 负责拉包，重复调用共用
 * 同一个 Promise；引擎没到时调用方用 `formatNumberFallback()` 先写纯文本
 * （数字立刻可见，只是不滚动），到了之后 `NumberFlow` 挂上去，此后的每一次
 * 变化照常动画。
 */

/** 引擎就绪后要给组件用的两样东西：组件本身 + `continuous` 插件。 */
export interface NumberFlowEngine {
    Component: (typeof import("@number-flow/svelte"))["default"];
    /** 数字跨位滚动（十位进位时整串一起动）。 */
    continuous: (typeof import("@number-flow/svelte"))["continuous"];
}

let loading: Promise<NumberFlowEngine> | null = null;

/**
 * 预热 / 加载引擎；重复调用共用同一个 Promise，不会拉第二次。
 *
 * 返回值直接喂给 `{#await}`，所以调用方不需要自己存状态。
 */
export function preloadNumberFlow(): Promise<NumberFlowEngine> {
    loading ??= import("@number-flow/svelte").then((module) => ({
        Component: module.default,
        continuous: module.continuous,
    }));
    return loading;
}

/**
 * 引擎未就绪时的纯文本兜底：与 `NumberFlow` 走同一套 `Intl` 格式化选项，
 * 保证先看到的 `12.34%` 和后补上的 `12.34%` 是同一个字符串（不会先跳个 `0.12`）。
 */
export function formatNumberFallback(
    value: number,
    format?: Intl.NumberFormatOptions,
): string {
    return new Intl.NumberFormat(undefined, format).format(value);
}
