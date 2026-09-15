import { installLocalStoragePolyfill } from "./_localStoragePolyfill";

installLocalStoragePolyfill();

/**
 * happy-dom 没有实现 Web Animations API，而 Svelte 的 `transition:`（slide 等）
 * 走的是 `element.animate()`。组件测试里补一个「立刻结束」的替身就够了：
 * 我们不测动画，只测 DOM 结构。
 */
interface StubAnimation {
    onfinish: (() => void) | null;
    cancel: () => void;
    finish: () => void;
    addEventListener: (type: string, cb: () => void) => void;
    removeEventListener: () => void;
}

function installAnimationPolyfill(): void {
    if (typeof Element === "undefined") return;
    const proto = Element.prototype as unknown as {
        animate?: (keyframes: unknown, options?: unknown) => StubAnimation;
    };
    if (typeof proto.animate === "function") return;

    proto.animate = () => {
        const animation: StubAnimation = {
            onfinish: null,
            cancel() {},
            finish() {},
            addEventListener(type, cb) {
                if (type === "finish") queueMicrotask(cb);
            },
            removeEventListener() {},
        };
        queueMicrotask(() => animation.onfinish?.());
        return animation;
    };
}

installAnimationPolyfill();

/**
 * 过滤掉 bits-ui 弹窗拆毁时那条 Svelte dev 警告（`derived_inert`）。
 *
 * 现象：任何 Dialog **打开再关闭**（甚至完全不卸载组件）就会打一次
 * "Reading a derived belonging to a now-destroyed effect may result in stale values"。
 * 已经量过：只挂载 + 卸载、不开弹窗 → 0 条；开 + 关、不卸载 → 1 条。
 * 也就是说它出在 bits-ui 的 portal / layer 拆卸路径里，**不是我们的组件销毁后
 * 读了自己的 derived**；而且这是 dev 期检查，生产构建不会带上。
 * 一个 58 文件 / 1000+ 用例的套件里它能刷出几十行，把真正的告警淹掉，
 * 所以这里按消息精确匹配过滤。
 *
 * ⚠️ 如果哪天它开始出现在「没有打开任何弹窗」的用例里，那就说明是我们自己的
 * 代码在销毁后读了 derived —— 请立刻删掉这段过滤去查，别让它继续挡着。
 */
const INERT_WARNING = "Reading a derived belonging to a now-destroyed effect";

for (const method of ["warn", "error"] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
        if (typeof args[0] === "string" && args[0].includes(INERT_WARNING)) return;
        original(...args);
    };
}
