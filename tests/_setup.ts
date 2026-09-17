import { installLocalStoragePolyfill } from "./_localStoragePolyfill";

installLocalStoragePolyfill();

/**
 * 动画环境：组件测试不测动画，只测 DOM 结构，所以这里把 Web Animations API
 * 弄成「立刻结束 / 没有动画」。**两件事都要做，少一件都会让弹窗关不掉：**
 *
 * 1. `Element.prototype.animate` —— Svelte 的 `transition:`（slide、`in:expandLabel`…）
 *    走它。happy-dom 20.14 起自己带了实现，但那些动画没有时钟、永远不 finish，
 *    Svelte 拆 `out:` 过渡时 `animation.cancel()` 还会抛 `AbortError`（unhandled
 *    rejection，用例是过的、红字是满的）。所以**无条件覆盖**成「立刻 onfinish」。
 *
 * 2. `Element.prototype.getAnimations` —— bits-ui 的退场要问它
 *    （`internal/animations-complete.js`）：节点上**有**这个方法就 `requestAnimationFrame`
 *    等一帧、再 `await` 那些动画的 `finished`，**没有**就直接回调。happy-dom 20.14
 *    起它也有了，于是「关掉对话框」变成要等一帧，而用例里的 `settle()`（`flushSync` +
 *    `tick`，故意不碰计时器）等不到那一帧，节点就一直留在 DOM 里。
 *    这里把它抹掉，走的还是「没有 WAAPI → 不等待」那条路，跟这套用例一直以来的
 *    假设（`await tick()` 就够）一致，也不会把偶发失败引进来。
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
        getAnimations?: () => unknown[];
    };

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
    delete proto.getAnimations;
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
