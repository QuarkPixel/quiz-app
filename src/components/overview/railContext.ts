import { getContext, setContext } from "svelte";
import type { RailScroll } from "./rail.svelte";

const RAIL_KEY = Symbol("overview-rail");

/**
 * 顶部 rail 的上下文。
 *
 * 热力图要用它做横向虚拟化（只渲染视口附近的列），而热力图嵌在 rail 的内容里，
 * 隔着一层 `OverviewDialog`，用 prop 传会污染中间那一层。没有 provider 时
 * （组件单测、或者以后把热力图放到别处）返回 `null`，调用方按「不虚拟化」处理。
 */
export function provideOverviewRail(rail: RailScroll): void {
    setContext(RAIL_KEY, rail);
}

export function useOverviewRail(): RailScroll | null {
    return getContext<RailScroll | null>(RAIL_KEY) ?? null;
}
