/**
 * DiceBear「slice」identicon 的唯一入口。
 *
 * ── 为什么是异步加载的 ─────────────────────────────────────────────────────
 *
 * `@dicebear/core` + 样式定义合起来约 190 kB（gzip 约 28 kB），而头像只出现在
 * **云同步面板**里（目标仓库卡片 + 候选片段列表）。留在主包里等于让首页和刷题
 * 界面白背这 28 kB。所以这里改成动态 import：
 *
 *   - `preloadIdenticon()` 负责拉引擎，**触发点是「用户打开云同步」**
 *     （`SyncSettings` 一露出来就预热）；
 *   - 真要用而引擎还没到时，组件先画一个同尺寸的占位块，加载完再补上。
 *
 * 其余部分照旧：样式定义仍然只校验 + 深拷贝一次（`new Style()` 实测 ~2.7ms，
 * 列表里逐行构造会白烧主线程）。颜色不走 CSS 变量——SVG 属性只认字面色值——
 * 用的是 learningProgress 里那套与 `color-mix(in oklch, …)` 等价的插值算出来的
 * 色带，于是头像和学习进度条是同一族颜色。
 */

import {
    getLearningColorPaletteHex,
    type LearningColorScheme,
} from "@/features/quiz/learningProgress";

/** 色带取几级：够 slice 每次随机挑出不一样的颜色就行。 */
const PALETTE_SIZE = 16;

const palettes: Record<LearningColorScheme, string[]> = {
    light: getLearningColorPaletteHex(PALETTE_SIZE, "light"),
    dark: getLearningColorPaletteHex(PALETTE_SIZE, "dark"),
};

/**
 * 加载好的引擎。
 *
 * 类型写成 `import(...)`：这两个包只在运行时动态拉，类型要在编译期拿得到，
 * 但**不能**因此变成静态 import（那就白拆了）。
 */
interface IdenticonEngine {
    Avatar: typeof import("@dicebear/core").Avatar;
    style: InstanceType<typeof import("@dicebear/core").Style>;
}

let engine: IdenticonEngine | null = null;
let loading: Promise<void> | null = null;

export interface IdenticonOptions {
    /** 决定画出哪一张；同一个 seed 结果稳定。 */
    seed: string;
    /** 边长（px）：直接写进 svg 的 width/height。 */
    size: number;
    /** 跟随系统深浅色：两套端点色不同，色带也不一样。 */
    scheme: LearningColorScheme;
}

/** 引擎就绪了没有（组件靠它决定画图还是先占位）。 */
export function identiconReady(): boolean {
    return engine !== null;
}

/**
 * 预热 / 加载引擎；重复调用共用同一个 Promise，不会拉第二次。
 *
 * 调用方在想画头像之前调一次就够——最自然的时机就是「云同步这一块露出来了」。
 */
export function preloadIdenticon(): Promise<void> {
    loading ??= (async () => {
        const [core, slice] = await Promise.all([
            import("@dicebear/core"),
            import("@dicebear/styles/slice.json"),
        ]);
        engine = { Avatar: core.Avatar, style: new core.Style(slice.default) };
    })();
    return loading;
}

/**
 * 渲染成一段 `<svg>` 字符串（不带头尾的 span）。
 *
 * 引擎还没加载好时返回 `null`——**不在这里等**：这是同步函数，调用方（组件的
 * `$derived`）没法等 Promise；要等的部分由 `preloadIdenticon()` 负责。
 */
export function renderIdenticon({
    seed,
    size,
    scheme,
}: IdenticonOptions): string | null {
    if (engine === null) return null;

    return new engine.Avatar(engine.style, {
        seed,
        size,
        // 一页上会并排好几张（列表里每行一张），id 必须各论各的：
        // 默认的 defs id 只跟"第几个变体"有关，不随机就会串味。
        idRandomization: true,
        // 底色透明，让面板自己的背景透出来
        backgroundColor: ["00000000"],
        bodyColor: palettes[scheme],
    }).toString();
}
