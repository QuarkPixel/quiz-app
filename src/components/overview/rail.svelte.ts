import { OVERVIEW_RAIL_MIN_OVERFLOW } from "@/config/overview";

/**
 * 两次 wheel 事件隔这么久，就算「新的一次手势」。
 *
 * 300ms 是「手停了一下」的量级：同一次触控板手势的事件间隔只有 8~17ms，
 * 鼠标滚轮一格与下一格也常在这个数以内；而人停下来想一想、或者换一只手去摸鼠标，
 * 间隔远大于 300ms。判定的意义见 `wheel`：换设备之后不会被上一次的认定卡住。
 */
const GESTURE_GAP_MS = 300;

/**
 * 顶部横向 rail 的控制器。
 *
 * 只做两件事：
 *   1. 记住滚动位置 / 视口宽度 / 内容宽度（热力图靠它做横向虚拟化）
 *   2. 把**鼠标滚轮**的纵向滚动映射成横向滚动
 *
 * 左右箭头（一次点击翻一段）已经删掉：它和滚轮抢同一件事，一次跳一大段在触控板上
 * 也很突兀。现在只剩「原生横向滚动」+「鼠标滚轮」两条路，`railMath.ts` 随之删除。
 */
export class RailScroll {
    /** 滚动容器（`overflow-x: auto` 的那一层） */
    el = $state<HTMLElement | null>(null);
    /** 内容层（`w-max` 的 flex 行）。热力图用它做坐标换算 */
    contentEl = $state<HTMLElement | null>(null);

    scrollLeft = $state(0);
    /** 由 `bind:clientWidth` 喂进来 */
    viewportWidth = $state(0);
    contentWidth = $state(0);

    /** 还能滚动的总距离（scrollWidth − clientWidth） */
    readonly maxScroll = $derived(
        Math.max(0, this.contentWidth - this.viewportWidth),
    );

    /** 超出几像素不算「能滚」——差一点点不值得亮渐变遮罩 */
    readonly overflowing = $derived(
        this.maxScroll > OVERVIEW_RAIL_MIN_OVERFLOW,
    );
    readonly canScrollLeft = $derived(this.overflowing && this.scrollLeft > 1);
    readonly canScrollRight = $derived(
        this.overflowing && this.scrollLeft < this.maxScroll - 1,
    );

    /** 从 DOM 读一遍（滚动、尺寸变化都走这里） */
    sync(): void {
        const el = this.el;
        if (!el) return;
        if (this.scrollLeft !== el.scrollLeft) this.scrollLeft = el.scrollLeft;
        if (this.viewportWidth !== el.clientWidth) {
            this.viewportWidth = el.clientWidth;
        }
        if (this.contentWidth !== el.scrollWidth) {
            this.contentWidth = el.scrollWidth;
        }
    }

    /**
     * 内容层测量：内容宽度跟着热力图的列数长，所以用 ResizeObserver 持续跟踪。
     */
    observeContent = (node: HTMLElement) => {
        const update = () => {
            if (this.contentWidth !== node.offsetWidth) {
                this.contentWidth = node.offsetWidth;
            }
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(node);
        return {
            destroy() {
                observer.disconnect();
            },
        };
    };

    /**
     * 鼠标滚轮 → 横向滚动。
     *
     * **只拦鼠标滚轮**，触控板 / 触屏一律放行给浏览器：
     *
     *   - `deltaX ≠ 0` 直接 return。这是「抽搐」的根因——触控板斜着滑时
     *     `deltaX` 与 `deltaY` 同时非零，浏览器按 `deltaX` 原生滚一次、我们又按
     *     `deltaY` 滚一次，两个量互相拉扯，画面就抖起来了。只要事件里带了横向
     *     分量，就交给原生（原生本来就按 `deltaX` 滚，很跟手）。
     *   - 纵向滑动是否要映射，看 `shouldScrollRail`：**同一次手势里**出现过斜滑
     *     就认定是触控板，这次手势剩下的纵向滑动不翻这一排（用户要的「屏蔽上下
     *     滑动翻滚」）；否则一律当鼠标滚轮，滚一格翻一格。
     *
     * 「认定」只活在一次手势里（两次事件间隔超过 `GESTURE_GAP_MS` 就重来）——
     * 触控板和鼠标经常来回换，认死一个设备名会让换回来的那个直接失效。
     *
     * 为什么不按 `deltaY` 的「整数 / 小数」去分辨设备：鼠标滚轮在 macOS 上给
     * 4.000000、触控板给 1.2000000476837158，看着能分——但**平滑滚动鼠标**给的
     * 也是小数，按那条规则会被当成触控板，滚轮直接失效（踩过一次）。
     *
     * 已经顶到头时也不拦，免得把事件吃掉却什么也没发生。
     */
    wheel = (node: HTMLElement) => {
        /**
         * 这次手势里见过斜滑没有。`deltaX` 与 `deltaY` 同时非零只可能是触控板 /
         * 触屏的两指手势——鼠标的横向滚轮（拨轮）只给 `deltaX`，`deltaY` 是 0，
         * 不会误判。
         */
        let sawDiagonal = false;
        let lastWheelAt = Number.NEGATIVE_INFINITY;

        const onWheel = (event: WheelEvent) => {
            const now = performance.now();
            // 手停过一阵 = 新的一次手势，把上一次的认定清掉
            if (now - lastWheelAt > GESTURE_GAP_MS) sawDiagonal = false;
            lastWheelAt = now;

            if (event.deltaX !== 0 && event.deltaY !== 0) sawDiagonal = true;
            if (!shouldScrollRail(event, sawDiagonal)) return;
            if (this.maxScroll <= 0) return;

            const delta = event.deltaY;

            const atStart = node.scrollLeft <= 0 && delta < 0;
            const atEnd =
                node.scrollLeft >= this.maxScroll - 1 && delta > 0;
            if (atStart || atEnd) return;

            // deltaMode 1 = 按行，2 = 按页
            const scale =
                event.deltaMode === 1
                    ? 16
                    : event.deltaMode === 2
                      ? node.clientWidth
                      : 1;

            event.preventDefault();
            node.scrollLeft = Math.min(
                this.maxScroll,
                Math.max(0, node.scrollLeft + delta * scale),
            );
        };

        node.addEventListener("wheel", onWheel, { passive: false });
        return {
            destroy() {
                node.removeEventListener("wheel", onWheel);
            },
        };
    };
}

/**
 * 这一下 wheel 该不该由我们接管（把纵向滚动映射成横向）。
 *
 * 三条，缺一不可：
 *   1. `ctrlKey` = 捏合缩放，谁也别拦
 *   2. `deltaX ≠ 0`：带横向分量就是触控板的横向手势（或鼠标拨轮），
 *      原生滚得比我们好，也避免两个逻辑同时滚同一根轴
 *   3. 这次手势里出现过斜滑，说明手在触控板上：纵向滑动不翻这一排
 *
 * 剩下的（纯纵向、且这次手势没出现过斜滑）当鼠标滚轮处理。
 */
export function shouldScrollRail(
    event: WheelEvent,
    sawDiagonal: boolean,
): boolean {
    if (event.ctrlKey) return false;
    if (event.deltaX !== 0) return false;
    if (sawDiagonal) return false;
    return event.deltaY !== 0;
}
